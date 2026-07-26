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

/** Runs one local model request at a time and writes each revision's result separately. */
export class NoteEnrichmentCoordinator {
  private readonly queuedKeys = new Set<string>();
  private readonly queue: QueueEntry[] = [];
  private readonly idleResolvers = new Set<() => void>();
  private running = false;
  private disposed = false;
  private activeAbort?: AbortController;

  constructor(
    private readonly model: LocalNoteModel = new OllamaNoteModel()
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
    const existing = store.get(capture.id, capture.revision);
    if (this.queuedKeys.has(key)) return existing ?? queuedRecord(capture, new Date());

    if (existing?.status === "ready") return existing;
    if ((existing?.status === "failed" || existing?.status === "unavailable") && !replaceTerminalResult) return existing;

    const now = new Date();
    const queued = queuedRecord(capture, now, existing?.createdAt);
    store.write(queued);
    this.queue.push({ capture, rootPath: normalizedRootPath });
    this.queuedKeys.add(key);
    void this.drain();
    return queued;
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      for (;;) {
        const entry = this.queue.shift();
        if (!entry || this.disposed) return;
        const key = enrichmentKey(entry.capture, entry.rootPath);
        try {
          await this.enrich(entry);
        } finally {
          this.queuedKeys.delete(key);
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length > 0 && !this.disposed) void this.drain();
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

    this.activeAbort = new AbortController();
    try {
      const modelSource = truncateNoteSource(entry.capture.rawText);
      const result = await this.model.enrich({
        title: entry.capture.title,
        rawText: modelSource
      }, this.activeAbort.signal);
      if (this.disposed) return;
      const validated = validateResult(result, modelSource);
      store.write({
        ...running,
        status: "ready",
        result: validated,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      if (this.disposed) return;
      const unavailable = error instanceof OllamaUnavailableError;
      const message = unavailable
        ? "Ollama or llama3 is unavailable. Start Ollama and install the model, then retry."
        : error instanceof OllamaResponseError
          ? error.message
          : "The local model returned an unusable study response. Retry it.";
      store.write(failedRecord(running, message, unavailable ? "unavailable" : "failed"));
    } finally {
      this.activeAbort = undefined;
    }
  }

  private resolveIdle(): void {
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }
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

function validateResult(value: unknown, source: string): CaptureEnrichmentResult {
  const result = record(value, "study response");
  requireOnlyKeys(result, ["summary", "takeaways", "openQuestions"], "study response");
  const suppliedSummary = boundedText(result.summary, "summary", captureEnrichmentLimits.maxSummaryLength);
  const rawTakeaways = array(result.takeaways, "takeaways");
  const rawQuestions = array(result.openQuestions, "open questions");
  if (rawTakeaways.length === 0 || rawTakeaways.length > captureEnrichmentLimits.maxTakeaways) {
    throw new OllamaResponseError(
      `The local model must return between 1 and ${captureEnrichmentLimits.maxTakeaways} takeaways.`
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
