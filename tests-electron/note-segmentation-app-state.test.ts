import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import { CaptureStore } from "../electron/capture-store";
import { NoteSegmentationStore } from "../electron/note-segmentation-store";
import {
  OllamaResponseError,
  type GeneratedNoteSegmentation,
  type LocalNoteModel,
  type SegmentNoteModelInput
} from "../electron/ollama-note-model";
import { splitNoteIntoSourceBlocks } from "../shared/note-segmentation";
import type {
  CaptureReadingChunk,
  LearnerCapture
} from "../shared/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true
  })));
});

async function fixture(): Promise<{
  root: string;
  settingsPath: string;
  progressPath: string;
}> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-note-segmentation-app-state-"));
  roots.push(root);
  const settingsPath = path.join(root, "app-data", "settings.json");
  const progressPath = path.join(root, "app-data", "progress.json");
  await fs.mkdir(path.join(root, "topics"), { recursive: true });
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(path.join(root, "topics", "bits.json"), `${JSON.stringify({
    schemaVersion: 2,
    revision: 1,
    id: "bits",
    title: "Bits",
    summary: "Binary foundations",
    sources: [],
    relationships: [],
    concepts: [],
    gaps: [],
    questions: []
  }, null, 2)}\n`);
  await fs.writeFile(settingsPath, `${JSON.stringify({
    knowledgeRootPath: root,
    progressPath,
    notificationsEnabled: false
  }, null, 2)}\n`);
  return { root, settingsPath, progressPath };
}

function longNote(label = "Lecture"): string {
  return Array.from({ length: 10 }, (_, index) => {
    const section = index + 1;
    return [
      `## ${label} ${section}`,
      "",
      `${label} paragraph ${section} keeps the learner's exact wording and spacing. `.repeat(18),
      "",
      `- ${label} detail ${section}.1`,
      `- ${label} detail ${section}.2`,
      ""
    ].join("\n");
  }).join("\n");
}

function semanticChunks(input: SegmentNoteModelInput): GeneratedNoteSegmentation {
  const midpoint = Math.max(1, Math.floor(input.sourceBlocks.length / 2));
  const groups = [
    input.sourceBlocks.slice(0, midpoint),
    input.sourceBlocks.slice(midpoint)
  ].filter((group) => group.length > 0);
  return {
    chunks: groups.map((group, index) => ({
      title: `Reading section ${index + 1}`,
      sourceBlockIDs: group.map(({ id }) => id)
    }))
  };
}

function modelWith(
  segmentNote: NonNullable<LocalNoteModel["segmentNote"]>
): LocalNoteModel {
  return {
    segmentNote
  };
}

function createState(
  paths: Awaited<ReturnType<typeof fixture>>,
  model: LocalNoteModel
): RevemberState {
  return new RevemberState({
    settingsPath: paths.settingsPath,
    bundledKnowledgeRoot: paths.root,
    legacyProgressPath: paths.progressPath
  }, model);
}

async function waitFor<T>(
  read: () => T | undefined,
  accept: (value: T) => boolean,
  timeoutMilliseconds = 3_000
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    const value = read();
    if (value !== undefined && accept(value)) return value;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for note-segmentation state.");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function textFromChunks(
  rawText: string,
  chunks: readonly CaptureReadingChunk[]
): string {
  const textByID = new Map(
    splitNoteIntoSourceBlocks(rawText).map(({ id, text }) => [id, text])
  );
  return chunks
    .flatMap(({ sourceBlockIDs }) => sourceBlockIDs)
    .map((id) => {
      const text = textByID.get(id);
      if (text === undefined) throw new Error(`Unknown source block ${id}.`);
      return text;
    })
    .join("");
}

function saveDraft(state: RevemberState, rawText: string, title = "Lecture"): LearnerCapture {
  return state.saveCapture({
    expectedRevision: 0,
    topicID: "bits",
    title,
    rawText,
    status: "draft"
  });
}

describe("RevemberState note-segmentation lifecycle", () => {
  it("schedules segmentation when finishing a note without mutating its raw text", async () => {
    const paths = await fixture();
    const calls: SegmentNoteModelInput[] = [];
    const state = createState(paths, modelWith(async (input) => {
      calls.push(input);
      return semanticChunks(input);
    }));
    const rawText = longNote("Finished");

    try {
      const draft = saveDraft(state, rawText);
      const ready = state.finishCapture(draft.id, draft.revision);
      const persisted = await waitFor(
        () => new NoteSegmentationStore(paths.root).get(ready.id, ready.revision),
        (segmentation) => segmentation.status === "ready"
      );

      expect(ready).toMatchObject({
        id: draft.id,
        revision: draft.revision + 1,
        status: "ready",
        rawText
      });
      expect(calls).toHaveLength(1);
      expect(persisted.chunks).toHaveLength(2);
      expect(textFromChunks(rawText, persisted.chunks ?? [])).toBe(rawText);
      expect(state.getCapture(ready.id).rawText).toBe(rawText);
    } finally {
      state.dispose();
    }
  });

  it("returns exact deterministic fallback chunks while semantic work is running and queued", async () => {
    const paths = await fixture();
    const startedInputs: SegmentNoteModelInput[] = [];
    const model = modelWith(async (input, signal) => {
      startedInputs.push(input);
      return await new Promise<GeneratedNoteSegmentation>((_resolve, reject) => {
        const abort = () => reject(new OllamaResponseError("cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      });
    });
    const state = createState(paths, model);
    const firstText = longNote("Running");
    const secondText = longNote("Queued");

    try {
      const firstDraft = saveDraft(state, firstText, "Running lecture");
      const first = state.finishCapture(firstDraft.id, firstDraft.revision);
      await waitFor(
        () => new NoteSegmentationStore(paths.root).get(first.id, first.revision),
        (segmentation) => segmentation.status === "running"
      );

      const secondDraft = saveDraft(state, secondText, "Queued lecture");
      const second = state.finishCapture(secondDraft.id, secondDraft.revision);
      await waitFor(
        () => new NoteSegmentationStore(paths.root).get(second.id, second.revision),
        (segmentation) => segmentation.status === "queued"
      );

      const running = state.getCaptureSegmentation(first.id, first.revision);
      const queued = state.getCaptureSegmentation(second.id, second.revision);

      expect(running?.status).toBe("running");
      expect(textFromChunks(firstText, running?.chunks ?? [])).toBe(firstText);
      expect(queued?.status).toBe("queued");
      expect(textFromChunks(secondText, queued?.chunks ?? [])).toBe(secondText);
      expect(startedInputs).toHaveLength(1);
    } finally {
      state.dispose();
    }
  });

  it("rejects retries for stale revisions and captures that are not ready", async () => {
    const paths = await fixture();
    const state = createState(paths, modelWith(async (input) => semanticChunks(input)));

    try {
      const draft = saveDraft(state, longNote("Draft"));
      expect(() => state.retryCaptureSegmentation(draft.id, draft.revision))
        .toThrow(/only a ready note/i);

      const current = state.saveCapture({
        id: draft.id,
        expectedRevision: draft.revision,
        topicID: draft.topicID,
        title: draft.title,
        rawText: `${draft.rawText}\nA newer revision.\n`,
        status: "ready"
      });
      expect(() => state.retryCaptureSegmentation(draft.id, draft.revision))
        .toThrow(/note changed.*current revision/i);
      expect(state.getCapture(draft.id)).toMatchObject({
        revision: current.revision,
        rawText: current.rawText
      });
    } finally {
      state.dispose();
    }
  });

  it("allows ready AI-origin notes to receive semantic reading sections", async () => {
    const paths = await fixture();
    const calls: SegmentNoteModelInput[] = [];
    const state = createState(paths, modelWith(async (input) => {
      calls.push(input);
      return semanticChunks(input);
    }));
    const rawText = longNote("AI generated");

    try {
      const generated = new CaptureStore(paths.root).createOllamaGenerated({
        topicID: "bits",
        title: "Generated lecture",
        rawText
      });
      const immediate = state.getCaptureSegmentation(generated.id, generated.revision);
      const persisted = await waitFor(
        () => new NoteSegmentationStore(paths.root).get(generated.id, generated.revision),
        (segmentation) => segmentation.status === "ready"
      );

      expect(immediate?.status).toMatch(/queued|running/);
      expect(textFromChunks(rawText, immediate?.chunks ?? [])).toBe(rawText);
      expect(calls).toHaveLength(1);
      expect(textFromChunks(rawText, persisted.chunks ?? [])).toBe(rawText);
      expect(state.getCapture(generated.id)).toMatchObject({
        origin: "ollama",
        status: "ready",
        rawText
      });
    } finally {
      state.dispose();
    }
  });

  it("aborts active background segmentation when the state is disposed", async () => {
    const paths = await fixture();
    let activeSignal: AbortSignal | undefined;
    let resolveStarted!: () => void;
    let resolveAborted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const aborted = new Promise<void>((resolve) => { resolveAborted = resolve; });
    const state = createState(paths, modelWith(async (_input, signal) => {
      activeSignal = signal;
      resolveStarted();
      return await new Promise<GeneratedNoteSegmentation>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          resolveAborted();
          reject(new OllamaResponseError("cancelled"));
        }, { once: true });
      });
    }));
    const rawText = longNote("Dispose");
    let disposed = false;

    try {
      const draft = saveDraft(state, rawText);
      const ready = state.finishCapture(draft.id, draft.revision);
      await started;
      expect(activeSignal?.aborted).toBe(false);

      state.dispose();
      disposed = true;
      await aborted;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(activeSignal?.aborted).toBe(true);
      expect(state.getCapture(ready.id).rawText).toBe(rawText);
      expect(new NoteSegmentationStore(paths.root).get(ready.id, ready.revision)?.status)
        .toBe("running");
    } finally {
      if (!disposed) state.dispose();
    }
  });
});
