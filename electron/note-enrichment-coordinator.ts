import path from "node:path";
import type { CaptureEnrichment, CaptureEnrichmentResult, LearnerCapture } from "../shared/types";
import { captureEnrichmentLimits, NoteEnrichmentStore } from "./note-enrichment-store";
import {
  OllamaNoteModel,
  OllamaResponseError,
  OllamaUnavailableError,
  summarizeExtractiveTakeaways,
  truncateNoteSource,
  type LocalNoteModel
} from "./ollama-note-model";

interface QueueEntry {
  capture: LearnerCapture;
  rootPath: string;
}

class NoteEnrichmentPersistenceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NoteEnrichmentPersistenceError";
  }
}

/** Runs one local request at a time while keeping only the latest pending revision per note. */
export class NoteEnrichmentCoordinator {
  private readonly queuedKeys = new Set<string>();
  private readonly queue: QueueEntry[] = [];
  private readonly latestPendingByCapture = new Map<string, { key: string; revision: number }>();
  private readonly idleResolvers = new Set<() => void>();
  private running = false;
  private disposed = false;
  private activeAbort?: AbortController;
  private activeCaptureKey?: string;
  private activeEnrichmentKey?: string;

  constructor(
    private readonly model: LocalNoteModel = new OllamaNoteModel(),
    private readonly onBackgroundError?: (message: string) => void
  ) {}

  enqueue(capture: LearnerCapture, rootPath: string): CaptureEnrichment {
    return this.schedule(capture, rootPath, false);
  }

  retry(capture: LearnerCapture, rootPath: string): CaptureEnrichment {
    return this.schedule(capture, rootPath, true);
  }

  resume(capture: LearnerCapture, rootPath: string): CaptureEnrichment | undefined {
    const existing = this.get(capture.id, capture.revision, rootPath);
    if (existing?.status !== "queued" && existing?.status !== "running") return existing;
    return this.schedule(capture, rootPath, false);
  }

  get(captureID: string, captureRevision: number, rootPath: string): CaptureEnrichment | undefined {
    return new NoteEnrichmentStore(rootPath).get(captureID, captureRevision);
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.queuedKeys.clear();
    this.latestPendingByCapture.clear();
    this.activeAbort?.abort();
    this.resolveIdle();
  }

  async waitForIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.add(resolve));
  }

  private schedule(capture: LearnerCapture, rootPath: string, replaceTerminalResult: boolean): CaptureEnrichment {
    if (capture.status === "archived") throw new Error("Archived notes cannot be enriched.");
    const normalizedRootPath = path.resolve(rootPath);
    const store = new NoteEnrichmentStore(normalizedRootPath);
    const key = enrichmentKey(capture, normalizedRootPath);
    const captureKey = captureQueueKey(capture, normalizedRootPath);
    const existing = store.get(capture.id, capture.revision);
    if (this.queuedKeys.has(key)) return existing ?? queuedRecord(capture, new Date());

    if (existing?.status === "ready") return existing;
    if ((existing?.status === "failed" || existing?.status === "unavailable") && !replaceTerminalResult) return existing;
    const latestPending = this.latestPendingByCapture.get(captureKey);
    if (latestPending && latestPending.revision > capture.revision) {
      throw new Error("A newer revision of this note is already being prepared.");
    }

    const now = new Date();
    const queued = queuedRecord(capture, now, existing?.createdAt);
    store.write(queued);
    this.supersedeOlderQueuedEntries(capture, captureKey);
    this.latestPendingByCapture.set(captureKey, { key, revision: capture.revision });
    if (this.activeCaptureKey === captureKey && this.activeEnrichmentKey !== key) {
      this.activeAbort?.abort();
    }
    this.queue.push({ capture, rootPath: normalizedRootPath });
    this.queuedKeys.add(key);
    this.startDrain();
    return queued;
  }

  private startDrain(): void {
    void this.drain().catch((error) => {
      this.running = false;
      this.reportBackgroundFailure(error);
      if (this.queue.length > 0 && !this.disposed) this.startDrain();
      else this.resolveIdle();
    });
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      for (;;) {
        const entry = this.queue.shift();
        if (!entry || this.disposed) return;
        const key = enrichmentKey(entry.capture, entry.rootPath);
        const captureKey = captureQueueKey(entry.capture, entry.rootPath);
        try {
          await this.enrich(entry);
        } catch (error) {
          this.recoverEntryFailure(entry, error);
        } finally {
          this.queuedKeys.delete(key);
          if (this.latestPendingByCapture.get(captureKey)?.key === key) {
            this.latestPendingByCapture.delete(captureKey);
          }
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length > 0 && !this.disposed) this.startDrain();
      else this.resolveIdle();
    }
  }

  private async enrich(entry: QueueEntry): Promise<void> {
    const store = new NoteEnrichmentStore(entry.rootPath);
    const current = store.get(entry.capture.id, entry.capture.revision);
    if (!current || current.status !== "queued") return;
    const running = { ...current, status: "running" as const, updatedAt: new Date().toISOString() };
    store.write(running);

    if (!entry.capture.rawText.trim()) {
      store.write(failedRecord(running, "Add note text before requesting a local study response.", "failed"));
      return;
    }

    const key = enrichmentKey(entry.capture, entry.rootPath);
    const captureKey = captureQueueKey(entry.capture, entry.rootPath);
    const controller = new AbortController();
    this.activeAbort = controller;
    this.activeCaptureKey = captureKey;
    this.activeEnrichmentKey = key;
    try {
      const modelSource = truncateNoteSource(entry.capture.rawText);
      const result = await this.model.enrich({
        title: entry.capture.title,
        rawText: modelSource
      }, controller.signal);
      if (this.disposed) return;
      if (this.latestPendingByCapture.get(captureKey)?.key !== key) {
        store.write(supersededRecord(running));
        return;
      }
      const validated = validateResult(result, modelSource);
      try {
        store.write({
          ...running,
          status: "ready",
          result: validated,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        throw new NoteEnrichmentPersistenceError(error);
      }
    } catch (error) {
      if (this.disposed) return;
      if (this.latestPendingByCapture.get(captureKey)?.key !== key) {
        store.write(supersededRecord(running));
        return;
      }
      const persistenceFailure = error instanceof NoteEnrichmentPersistenceError;
      if (persistenceFailure) this.reportBackgroundFailure(error);
      const unavailable = error instanceof OllamaUnavailableError;
      const message = persistenceFailure
        ? "The local study response could not be saved. Check knowledge-folder access, then retry."
        : unavailable
        ? "Ollama or llama3 is unavailable. Start Ollama and install the model, then retry."
        : error instanceof OllamaResponseError
          ? error.message
          : "The local model returned an unusable study response. Retry it.";
      store.write(failedRecord(running, message, unavailable ? "unavailable" : "failed"));
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = undefined;
        this.activeCaptureKey = undefined;
        this.activeEnrichmentKey = undefined;
      }
    }
  }

  private supersedeOlderQueuedEntries(
    capture: LearnerCapture,
    captureKey: string
  ): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index];
      if (
        captureQueueKey(queued.capture, queued.rootPath) !== captureKey
        || queued.capture.revision >= capture.revision
      ) continue;
      this.queue.splice(index, 1);
      const key = enrichmentKey(queued.capture, queued.rootPath);
      this.queuedKeys.delete(key);
      try {
        const store = new NoteEnrichmentStore(queued.rootPath);
        const record = store.get(queued.capture.id, queued.capture.revision);
        if (record?.status === "queued") store.write(supersededRecord(record));
      } catch (error) {
        this.reportBackgroundFailure(error);
      }
    }
  }

  private recoverEntryFailure(entry: QueueEntry, error: unknown): void {
    this.reportBackgroundFailure(error);
    try {
      const store = new NoteEnrichmentStore(entry.rootPath);
      const current = store.get(entry.capture.id, entry.capture.revision)
        ?? queuedRecord(entry.capture, new Date());
      if (current.status === "ready" || current.status === "failed" || current.status === "unavailable") return;
      store.write(failedRecord(
        current,
        "The local study response could not be saved. Check knowledge-folder access, then retry.",
        "failed"
      ));
    } catch {
      // The global snapshot warning remains available when the store itself
      // cannot persist a terminal result.
    }
  }

  private reportBackgroundFailure(error: unknown): void {
    try {
      this.onBackgroundError?.(noteEnrichmentStorageFailureMessage(error));
    } catch {
      // Reporting must never turn a contained background failure into a
      // rejected drain promise.
    }
  }

  private resolveIdle(): void {
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }
}

export function noteEnrichmentStorageFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Local study response storage failed. Check knowledge-folder access, then retry. ${detail}`;
}

function queuedRecord(capture: LearnerCapture, now: Date, createdAt = now.toISOString()): CaptureEnrichment {
  return {
    schemaVersion: 1,
    captureID: capture.id,
    captureRevision: capture.revision,
    status: "queued",
    createdAt,
    updatedAt: now.toISOString()
  };
}

function failedRecord(
  current: CaptureEnrichment,
  errorMessage: string,
  status: "failed" | "unavailable"
): CaptureEnrichment {
  return {
    ...current,
    status,
    errorMessage,
    updatedAt: new Date().toISOString()
  };
}

function supersededRecord(current: CaptureEnrichment): CaptureEnrichment {
  return failedRecord(current, "A newer note revision replaced this local study request.", "failed");
}

function validateResult(value: unknown, source: string): CaptureEnrichmentResult {
  const result = record(value, "study response");
  requireOnlyKeys(result, ["summary", "takeaways", "openQuestions"], "study response");
  const suppliedSummary = boundedText(result.summary, "summary", captureEnrichmentLimits.maxSummaryLength);
  const rawTakeaways = array(result.takeaways, "takeaways");
  const rawQuestions = array(result.openQuestions, "open questions");
  if (
    rawTakeaways.length < captureEnrichmentLimits.minTakeaways
    || rawTakeaways.length > captureEnrichmentLimits.maxTakeaways
  ) {
    throw new OllamaResponseError(
      `The local model must return between ${captureEnrichmentLimits.minTakeaways} and ${captureEnrichmentLimits.maxTakeaways} takeaways.`
    );
  }
  if (rawQuestions.length > captureEnrichmentLimits.maxQuestions) {
    throw new OllamaResponseError(
      `The local model returned more than ${captureEnrichmentLimits.maxQuestions} open questions.`
    );
  }
  const takeaways = rawTakeaways.map((value, index) => {
    const takeaway = record(value, `takeaway ${index + 1}`);
    requireOnlyKeys(takeaway, ["text", "evidence"], `takeaway ${index + 1}`);
    const text = boundedText(takeaway.text, `takeaway ${index + 1}`, captureEnrichmentLimits.maxTakeawayLength);
    const evidence = boundedText(
      takeaway.evidence,
      `takeaway evidence ${index + 1}`,
      captureEnrichmentLimits.maxTakeawayLength
    );
    if (!source.includes(text)) throw new OllamaResponseError(`Takeaway ${index + 1} does not appear in the saved note.`);
    if (!source.includes(evidence)) throw new OllamaResponseError(`Takeaway evidence ${index + 1} does not appear in the saved note.`);
    return { text, evidence };
  });
  if (new Set(takeaways.map(({ evidence }) => evidence)).size !== takeaways.length) {
    throw new OllamaResponseError("The local model returned duplicate takeaway evidence.");
  }
  const openQuestions = rawQuestions.map((question, index) =>
    boundedText(question, `open question ${index + 1}`, captureEnrichmentLimits.maxQuestionLength)
  );
  for (const [index, question] of openQuestions.entries()) {
    if (!source.includes(question)) throw new OllamaResponseError(`Open question ${index + 1} does not appear in the saved note.`);
  }
  const summary = summarizeExtractiveTakeaways(takeaways);
  if (suppliedSummary !== summary) throw new OllamaResponseError("The local model returned an invalid summary.");
  return { summary, takeaways, openQuestions };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OllamaResponseError(`The local model returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new OllamaResponseError(`The local model returned invalid ${label}.`);
  return value;
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new OllamaResponseError(`The local model returned an invalid ${label}.`);
  }
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new OllamaResponseError(`The local model returned an invalid ${label}.`);
  }
  return value;
}

function enrichmentKey(capture: LearnerCapture, rootPath: string): string {
  return `${path.resolve(rootPath)}:${capture.id}:${capture.revision}`;
}

function captureQueueKey(capture: LearnerCapture, rootPath: string): string {
  return `${path.resolve(rootPath)}:${capture.id}`;
}
