import path from "node:path";
import {
  groupSourceBlocksIntoChunks,
  splitNoteIntoSourceBlocks,
  type NoteSourceBlock
} from "../shared/note-segmentation";
import type {
  CaptureReadingChunk,
  CaptureSegmentation,
  LearnerCapture
} from "../shared/types";
import { CaptureStore } from "./capture-store";
import { NoteSegmentationStore } from "./note-segmentation-store";
import {
  OllamaNoteModel,
  OllamaResponseError,
  OllamaUnavailableError,
  type LocalNoteModel
} from "./ollama-note-model";

interface QueueEntry {
  capture: LearnerCapture;
  rootPath: string;
}

/** Keeps semantic organization best-effort while exact deterministic chunks stay immediately available. */
export class NoteSegmentationCoordinator {
  private readonly queuedKeys = new Set<string>();
  private readonly queue: QueueEntry[] = [];
  private readonly latestPendingByCapture = new Map<string, { key: string; revision: number }>();
  private running = false;
  private disposed = false;
  private activeAbort?: AbortController;
  private activeCaptureKey?: string;
  private activeSegmentationKey?: string;

  constructor(
    private readonly model: LocalNoteModel = new OllamaNoteModel(),
    private readonly onBackgroundError?: (message: string) => void
  ) {}

  enqueue(capture: LearnerCapture, rootPath: string): CaptureSegmentation {
    return this.schedule(capture, rootPath, false);
  }

  retry(capture: LearnerCapture, rootPath: string): CaptureSegmentation {
    return this.schedule(capture, rootPath, true);
  }

  resume(capture: LearnerCapture, rootPath: string): CaptureSegmentation | undefined {
    const existing = this.get(capture.id, capture.revision, rootPath);
    if (existing?.status === "ready") return existing;
    if (existing?.status === "failed" || existing?.status === "unavailable") {
      return withDeterministicFallback(existing, capture);
    }
    return this.schedule(capture, rootPath, false);
  }

  get(captureID: string, captureRevision: number, rootPath: string): CaptureSegmentation | undefined {
    return new NoteSegmentationStore(rootPath).get(captureID, captureRevision);
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.queuedKeys.clear();
    this.latestPendingByCapture.clear();
    this.activeAbort?.abort();
  }

  private schedule(
    capture: LearnerCapture,
    rootPath: string,
    replaceTerminalResult: boolean
  ): CaptureSegmentation {
    if (capture.status !== "ready") {
      throw new Error("Only the current ready note revision can be organized semantically.");
    }
    const normalizedRootPath = path.resolve(rootPath);
    const store = new NoteSegmentationStore(normalizedRootPath);
    const key = segmentationKey(capture, normalizedRootPath);
    const captureKey = captureQueueKey(capture, normalizedRootPath);
    const existing = store.get(capture.id, capture.revision);
    if (this.queuedKeys.has(key)) {
      return withDeterministicFallback(existing ?? queuedRecord(capture, new Date()), capture);
    }
    if (existing?.status === "ready" && !replaceTerminalResult) return existing;
    if (
      (existing?.status === "failed" || existing?.status === "unavailable")
      && !replaceTerminalResult
    ) {
      return withDeterministicFallback(existing, capture);
    }

    const latestPending = this.latestPendingByCapture.get(captureKey);
    if (latestPending && latestPending.revision > capture.revision) {
      throw new Error("A newer revision of this note is already being organized.");
    }

    const now = new Date();
    const queued = queuedRecord(capture, now, existing?.createdAt);
    store.write(queued);
    const fallbackChunks = deterministicChunks(capture.rawText);
    if (!this.model.segmentNote && fallbackChunks.length > 0) {
      return store.write({
        ...queued,
        status: "ready",
        chunks: fallbackChunks,
        updatedAt: new Date().toISOString()
      });
    }
    if (fallbackChunks.length === 0) {
      const failed = failedRecord(
        queued,
        "Add note text before organizing it into reading sections.",
        "failed"
      );
      store.write(failed);
      return { ...failed, chunks: fallbackChunks };
    }

    this.supersedeOlderQueuedEntries(capture, captureKey);
    this.latestPendingByCapture.set(captureKey, { key, revision: capture.revision });
    if (this.activeCaptureKey === captureKey && this.activeSegmentationKey !== key) {
      this.activeAbort?.abort();
    }
    this.queue.push({ capture, rootPath: normalizedRootPath });
    this.queuedKeys.add(key);
    this.startDrain();
    return { ...queued, chunks: fallbackChunks };
  }

  private startDrain(): void {
    void this.drain().catch((error) => {
      this.running = false;
      this.reportBackgroundFailure(error);
      if (this.queue.length > 0 && !this.disposed) this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      for (;;) {
        const entry = this.queue.shift();
        if (!entry || this.disposed) return;
        const key = segmentationKey(entry.capture, entry.rootPath);
        const captureKey = captureQueueKey(entry.capture, entry.rootPath);
        try {
          await this.segment(entry);
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
    }
  }

  private async segment(entry: QueueEntry): Promise<void> {
    const segmentNote = this.model.segmentNote;
    if (!segmentNote) return;
    const store = new NoteSegmentationStore(entry.rootPath);
    const current = store.get(entry.capture.id, entry.capture.revision);
    if (!current || current.status !== "queued") return;
    const running: CaptureSegmentation = {
      ...current,
      status: "running",
      updatedAt: new Date().toISOString()
    };
    store.write(running);

    const persistedCapture = new CaptureStore(entry.rootPath).get(entry.capture.id);
    if (
      persistedCapture.revision !== entry.capture.revision
      || persistedCapture.status !== "ready"
    ) {
      store.write(supersededRecord(running));
      return;
    }
    const sourceBlocks = splitNoteIntoSourceBlocks(persistedCapture.rawText);
    if (sourceBlocks.length === 0) {
      store.write({ ...running, status: "ready", updatedAt: new Date().toISOString() });
      return;
    }

    const key = segmentationKey(entry.capture, entry.rootPath);
    const captureKey = captureQueueKey(entry.capture, entry.rootPath);
    const controller = new AbortController();
    this.activeAbort = controller;
    this.activeCaptureKey = captureKey;
    this.activeSegmentationKey = key;
    try {
      const result = await segmentNote.call(
        this.model,
        {
          title: persistedCapture.title,
          sourceBlocks: sourceBlocks.map(({ id, text }) => ({ id, text }))
        },
        controller.signal
      );
      if (this.disposed) return;
      if (this.latestPendingByCapture.get(captureKey)?.key !== key) {
        store.write(supersededRecord(running));
        return;
      }
      const latestCapture = new CaptureStore(entry.rootPath).get(entry.capture.id);
      if (
        latestCapture.revision !== entry.capture.revision
        || latestCapture.status !== "ready"
        || latestCapture.rawText !== persistedCapture.rawText
      ) {
        store.write(supersededRecord(running));
        return;
      }
      store.write({
        ...running,
        status: "ready",
        chunks: validateSemanticChunks(result.chunks, sourceBlocks),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      if (this.disposed) return;
      if (this.latestPendingByCapture.get(captureKey)?.key !== key) {
        store.write(supersededRecord(running));
        return;
      }
      const unavailable = error instanceof OllamaUnavailableError;
      const message = unavailable
        ? "Ollama or the local segmentation model is unavailable. Deterministic sections remain available."
        : error instanceof OllamaResponseError
          ? error.message
          : "The local model could not improve these sections. Deterministic sections remain available.";
      store.write(failedRecord(running, message, unavailable ? "unavailable" : "failed"));
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = undefined;
        this.activeCaptureKey = undefined;
        this.activeSegmentationKey = undefined;
      }
    }
  }

  private supersedeOlderQueuedEntries(capture: LearnerCapture, captureKey: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index];
      if (
        captureQueueKey(queued.capture, queued.rootPath) !== captureKey
        || queued.capture.revision >= capture.revision
      ) {
        continue;
      }
      this.queue.splice(index, 1);
      const key = segmentationKey(queued.capture, queued.rootPath);
      this.queuedKeys.delete(key);
      try {
        const store = new NoteSegmentationStore(queued.rootPath);
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
      const store = new NoteSegmentationStore(entry.rootPath);
      const current = store.get(entry.capture.id, entry.capture.revision)
        ?? queuedRecord(entry.capture, new Date());
      if (current.status === "ready" || current.status === "failed" || current.status === "unavailable") {
        return;
      }
      store.write(failedRecord(
        current,
        "Section organization could not be saved. Deterministic sections remain available.",
        "failed"
      ));
    } catch {
      // The global warning remains available if even the fallback cannot persist.
    }
  }

  private reportBackgroundFailure(error: unknown): void {
    try {
      this.onBackgroundError?.(noteSegmentationStorageFailureMessage(error));
    } catch {
      // A warning callback must never reject the background queue.
    }
  }
}

export function noteSegmentationStorageFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Note section storage failed. The saved note is unchanged. ${detail}`;
}

function queuedRecord(
  capture: LearnerCapture,
  now: Date,
  createdAt = now.toISOString()
): CaptureSegmentation {
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
  current: CaptureSegmentation,
  errorMessage: string,
  status: "failed" | "unavailable"
): CaptureSegmentation {
  const { chunks: _chunks, ...withoutChunks } = current;
  return {
    ...withoutChunks,
    status,
    errorMessage,
    updatedAt: new Date().toISOString()
  };
}

function supersededRecord(current: CaptureSegmentation): CaptureSegmentation {
  return failedRecord(current, "A newer note revision replaced this section request.", "failed");
}

function validateSemanticChunks(value: unknown, sourceBlocks: readonly NoteSourceBlock[]): CaptureReadingChunk[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OllamaResponseError("The local model returned no note sections.");
  }
  const knownIDs = new Set(sourceBlocks.map(({ id }) => id));
  const expectedOrder = sourceBlocks.map(({ id }) => id);
  const seenIDs: string[] = [];
  const chunks = value.map((candidate, index): CaptureReadingChunk => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new OllamaResponseError(`The local model returned an invalid section ${index + 1}.`);
    }
    const raw = candidate as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title || title.length > 120) {
      throw new OllamaResponseError(`The local model returned an invalid title for section ${index + 1}.`);
    }
    if (!Array.isArray(raw.sourceBlockIDs) || raw.sourceBlockIDs.length === 0) {
      throw new OllamaResponseError(`The local model returned no source blocks for section ${index + 1}.`);
    }
    const sourceBlockIDs = raw.sourceBlockIDs.map((id) => {
      if (typeof id !== "string" || !knownIDs.has(id)) {
        throw new OllamaResponseError(`The local model referenced an unknown source block in section ${index + 1}.`);
      }
      seenIDs.push(id);
      return id;
    });
    const id = `section-${String(index + 1).padStart(4, "0")}`;
    return { id, title, sourceBlockIDs };
  });
  if (
    seenIDs.length !== expectedOrder.length
    || seenIDs.some((id, index) => id !== expectedOrder[index])
  ) {
    throw new OllamaResponseError(
      "The local model must include every source block exactly once and keep the original order."
    );
  }
  return chunks;
}

function deterministicChunks(rawText: string): CaptureReadingChunk[] {
  return groupSourceBlocksIntoChunks(splitNoteIntoSourceBlocks(rawText)).map((chunk) => ({
    id: chunk.id,
    sourceBlockIDs: chunk.sourceBlockIDs
  }));
}

function withDeterministicFallback(
  segmentation: CaptureSegmentation,
  capture: LearnerCapture
): CaptureSegmentation {
  return segmentation.chunks
    ? segmentation
    : { ...segmentation, chunks: deterministicChunks(capture.rawText) };
}

function segmentationKey(capture: LearnerCapture, rootPath: string): string {
  return `${captureQueueKey(capture, rootPath)}:${capture.revision}`;
}

function captureQueueKey(capture: LearnerCapture, rootPath: string): string {
  return `${path.resolve(rootPath)}:${capture.id}`;
}
