import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import { CaptureStore } from "../electron/capture-store";
import { NoteSegmentationCoordinator } from "../electron/note-segmentation-coordinator";
import { NoteSegmentationStore } from "../electron/note-segmentation-store";
import {
  OllamaResponseError,
  OllamaUnavailableError,
  type GeneratedNoteSegmentation,
  type LocalNoteModel,
  type SegmentNoteModelInput
} from "../electron/ollama-note-model";
import {
  splitNoteIntoSourceBlocks,
  type NoteSourceBlock
} from "../shared/note-segmentation";
import type {
  CaptureReadingChunk,
  CaptureSegmentation,
  LearnerCapture
} from "../shared/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true
  })));
});

async function fixture(prefix = "revember-note-segmentation-integration-"): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function stateFixture(): Promise<{
  root: string;
  settingsPath: string;
  progressPath: string;
}> {
  const root = await fixture();
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

function longNote(label = "Long note"): string {
  return Array.from({ length: 12 }, (_, index) => {
    const section = index + 1;
    const sentence = `${label} section ${section} preserves exact text, whitespace, and order. `;
    return `## ${label} ${section}\n\n${sentence.repeat(24)}\n\n- Detail ${section}.1\n- Detail ${section}.2\n\n`;
  }).join("");
}

function saveReadyCapture(root: string, rawText: string): LearnerCapture {
  return new CaptureStore(root).save({
    expectedRevision: 0,
    topicID: "bits",
    title: "Long-form lecture",
    rawText,
    concisePoints: [],
    status: "ready"
  }, new Date("2026-07-28T10:00:00.000Z"));
}

function testModel(
  segmentNote: NonNullable<LocalNoteModel["segmentNote"]>
): LocalNoteModel {
  return {
    enrich: async () => ({
      summary: "Unused in segmentation integration tests.",
      takeaways: [],
      openQuestions: []
    }),
    segmentNote
  };
}

function semanticChunks(
  input: SegmentNoteModelInput,
  titles = ["Foundations", "Applications"]
): GeneratedNoteSegmentation {
  const midpoint = Math.max(1, Math.floor(input.sourceBlocks.length / 2));
  const groups = [
    input.sourceBlocks.slice(0, midpoint),
    input.sourceBlocks.slice(midpoint)
  ].filter((group) => group.length > 0);
  return {
    chunks: groups.map((group, index) => ({
      title: titles[index] ?? `Section ${index + 1}`,
      sourceBlockIDs: group.map(({ id }) => id)
    }))
  };
}

function sourceTextForChunks(
  rawText: string,
  chunks: readonly CaptureReadingChunk[]
): string {
  const blocks = splitNoteIntoSourceBlocks(rawText);
  const byID = new Map(blocks.map((block) => [block.id, block.text]));
  return chunks
    .flatMap(({ sourceBlockIDs }) => sourceBlockIDs)
    .map((id) => {
      const text = byID.get(id);
      if (text === undefined) throw new Error(`Unknown source block ${id}.`);
      return text;
    })
    .join("");
}

async function waitForStoredSegmentation(
  root: string,
  captureID: string,
  captureRevision: number,
  acceptedStatuses: readonly CaptureSegmentation["status"][],
  timeoutMilliseconds = 3_000
): Promise<CaptureSegmentation> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    const segmentation = new NoteSegmentationStore(root).get(captureID, captureRevision);
    if (segmentation && acceptedStatuses.includes(segmentation.status)) return segmentation;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${captureID} revision ${captureRevision} to reach ${acceptedStatuses.join(" or ")}.`
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("long-note segmentation integration", () => {
  it("returns exact deterministic sections immediately, then persists exact ordered semantic sections", async () => {
    const root = await fixture();
    const rawText = longNote();
    const capture = saveReadyCapture(root, rawText);
    const semanticResult = deferred<GeneratedNoteSegmentation>();
    let receivedInput: SegmentNoteModelInput | undefined;
    const coordinator = new NoteSegmentationCoordinator(testModel(async (input, signal) => {
      receivedInput = input;
      return await new Promise<GeneratedNoteSegmentation>((resolve, reject) => {
        const abort = () => reject(new OllamaResponseError("cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        semanticResult.promise.then(resolve, reject).finally(() => {
          signal.removeEventListener("abort", abort);
        });
      });
    }));

    try {
      const immediate = coordinator.enqueue(capture, root);

      expect(immediate.status).toBe("queued");
      expect(immediate.chunks?.length).toBeGreaterThan(1);
      expect(sourceTextForChunks(rawText, immediate.chunks ?? [])).toBe(rawText);
      expect(new NoteSegmentationStore(root).get(capture.id, capture.revision)?.status)
        .toMatch(/queued|running/);

      expect(receivedInput).toBeDefined();
      semanticResult.resolve(semanticChunks(receivedInput!));
      const persisted = await waitForStoredSegmentation(
        root,
        capture.id,
        capture.revision,
        ["ready"]
      );
      const expectedIDs = splitNoteIntoSourceBlocks(rawText).map(({ id }) => id);

      expect(persisted.chunks?.map(({ title }) => title))
        .toEqual(["Foundations", "Applications"]);
      expect(persisted.chunks?.flatMap(({ sourceBlockIDs }) => sourceBlockIDs))
        .toEqual(expectedIDs);
      expect(sourceTextForChunks(rawText, persisted.chunks ?? [])).toBe(rawText);
      expect(new CaptureStore(root).get(capture.id).rawText).toBe(rawText);
    } finally {
      coordinator.dispose();
    }
  });

  it.each([
    {
      name: "an unknown source-block ID",
      response: (blocks: readonly NoteSourceBlock[]) => [{
        title: "Invented",
        sourceBlockIDs: [...blocks.slice(0, -1).map(({ id }) => id), "source-invented-1"]
      }]
    },
    {
      name: "source-block IDs in a different order",
      response: (blocks: readonly NoteSourceBlock[]) => [{
        title: "Reordered",
        sourceBlockIDs: blocks.map(({ id }) => id).reverse()
      }]
    }
  ])("rejects $name, preserves raw text, and keeps deterministic fallback available", async ({
    response
  }) => {
    const root = await fixture();
    const rawText = longNote("Validation");
    const capture = saveReadyCapture(root, rawText);
    const capturePath = path.join(root, "captures", `${capture.id}.json`);
    const bytesBefore = await fs.readFile(capturePath);
    const coordinator = new NoteSegmentationCoordinator(testModel(async (input) => ({
      chunks: response(splitNoteIntoSourceBlocks(
        input.sourceBlocks.map(({ text }) => text).join("")
      ))
    })));

    try {
      const immediate = coordinator.enqueue(capture, root);
      expect(sourceTextForChunks(rawText, immediate.chunks ?? [])).toBe(rawText);

      const failed = await waitForStoredSegmentation(
        root,
        capture.id,
        capture.revision,
        ["failed"]
      );
      expect(failed.errorMessage).toMatch(/unknown source block|exactly once|original order/i);
      expect(failed.chunks).toBeUndefined();

      const fallback = coordinator.resume(capture, root);
      expect(fallback?.status).toBe("failed");
      expect(sourceTextForChunks(rawText, fallback?.chunks ?? [])).toBe(rawText);
      expect(await fs.readFile(capturePath)).toEqual(bytesBefore);
      expect(new CaptureStore(root).get(capture.id).rawText).toBe(rawText);
    } finally {
      coordinator.dispose();
    }
  });

  it("keeps deterministic sections available when Ollama is unavailable", async () => {
    const root = await fixture();
    const rawText = longNote("Offline");
    const capture = saveReadyCapture(root, rawText);
    const coordinator = new NoteSegmentationCoordinator(testModel(async () => {
      throw new OllamaUnavailableError();
    }));

    try {
      const immediate = coordinator.enqueue(capture, root);
      expect(sourceTextForChunks(rawText, immediate.chunks ?? [])).toBe(rawText);

      const unavailable = await waitForStoredSegmentation(
        root,
        capture.id,
        capture.revision,
        ["unavailable"]
      );
      expect(unavailable.errorMessage).toMatch(/unavailable/i);
      expect(unavailable.chunks).toBeUndefined();

      const fallback = coordinator.resume(capture, root);
      expect(fallback?.status).toBe("unavailable");
      expect(sourceTextForChunks(rawText, fallback?.chunks ?? [])).toBe(rawText);
      expect(new CaptureStore(root).get(capture.id).rawText).toBe(rawText);
    } finally {
      coordinator.dispose();
    }
  });

  it("supersedes an active old revision and persists only the current revision's semantic result", async () => {
    const root = await fixture();
    const firstRawText = longNote("Old");
    const first = saveReadyCapture(root, firstRawText);
    const firstStarted = deferred<void>();
    let firstAborted = false;
    const calls: string[][] = [];
    const coordinator = new NoteSegmentationCoordinator(testModel(async (input, signal) => {
      calls.push(input.sourceBlocks.map(({ id }) => id));
      if (calls.length === 1) {
        firstStarted.resolve();
        return await new Promise<GeneratedNoteSegmentation>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            firstAborted = true;
            reject(new OllamaResponseError("cancelled"));
          }, { once: true });
        });
      }
      return semanticChunks(input, ["Current foundations", "Current applications"]);
    }));

    try {
      coordinator.enqueue(first, root);
      await firstStarted.promise;

      const latestRawText = longNote("Current");
      const latest = new CaptureStore(root).save({
        id: first.id,
        expectedRevision: first.revision,
        topicID: first.topicID,
        title: first.title,
        rawText: latestRawText,
        concisePoints: [],
        status: "ready"
      }, new Date("2026-07-28T10:01:00.000Z"));
      const immediateLatest = coordinator.enqueue(latest, root);

      expect(sourceTextForChunks(latestRawText, immediateLatest.chunks ?? []))
        .toBe(latestRawText);
      const superseded = await waitForStoredSegmentation(
        root,
        first.id,
        first.revision,
        ["failed"]
      );
      const persistedLatest = await waitForStoredSegmentation(
        root,
        latest.id,
        latest.revision,
        ["ready"]
      );

      expect(firstAborted).toBe(true);
      expect(calls).toHaveLength(2);
      expect(superseded.errorMessage).toMatch(/newer note revision/i);
      expect(sourceTextForChunks(latestRawText, persistedLatest.chunks ?? []))
        .toBe(latestRawText);
      expect(new CaptureStore(root).get(latest.id)).toMatchObject({
        revision: latest.revision,
        rawText: latestRawText
      });
    } finally {
      coordinator.dispose();
    }
  });

  it("schedules semantic work through RevemberState only for ready revisions", async () => {
    const { root, settingsPath, progressPath } = await stateFixture();
    const calls: SegmentNoteModelInput[] = [];
    const state = new RevemberState({
      settingsPath,
      bundledKnowledgeRoot: root,
      legacyProgressPath: progressPath
    }, testModel(async (input) => {
      calls.push(input);
      return semanticChunks(input);
    }));

    try {
      const draft = state.saveCapture({
        expectedRevision: 0,
        topicID: "bits",
        title: "Draft lecture",
        rawText: longNote("Draft"),
        concisePoints: [],
        status: "draft"
      });
      expect(state.getCaptureSegmentation(draft.id, draft.revision)).toBeUndefined();
      expect(calls).toEqual([]);

      const ready = state.saveCapture({
        id: draft.id,
        expectedRevision: draft.revision,
        topicID: draft.topicID,
        title: draft.title,
        rawText: draft.rawText,
        concisePoints: [],
        status: "ready"
      });
      const immediate = state.getCaptureSegmentation(ready.id, ready.revision);
      expect(immediate?.status).toBe("queued");
      expect(sourceTextForChunks(ready.rawText, immediate?.chunks ?? [])).toBe(ready.rawText);

      await waitForStoredSegmentation(root, ready.id, ready.revision, ["ready"]);
      expect(calls).toHaveLength(1);

      const archived = state.archiveCapture(ready.id, ready.revision);
      expect(state.getCaptureSegmentation(archived.id, archived.revision)).toBeUndefined();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(calls).toHaveLength(1);
    } finally {
      state.dispose();
    }
  });

  it("allows ready Ollama-origin notes to receive semantic reading sections", async () => {
    const { root, settingsPath, progressPath } = await stateFixture();
    const calls: SegmentNoteModelInput[] = [];
    const state = new RevemberState({
      settingsPath,
      bundledKnowledgeRoot: root,
      legacyProgressPath: progressPath
    }, testModel(async (input) => {
      calls.push(input);
      return semanticChunks(input, ["AI foundations", "AI applications"]);
    }));

    try {
      const generated = new CaptureStore(root).createOllamaGenerated({
        topicID: "bits",
        title: "Generated long note",
        rawText: longNote("Generated"),
        concisePoints: ["Generated notes remain eligible for reading organization."]
      }, new Date("2026-07-28T10:00:00.000Z"));

      const immediate = state.getCaptureSegmentation(generated.id, generated.revision);
      expect(immediate?.status).toBe("queued");
      expect(sourceTextForChunks(generated.rawText, immediate?.chunks ?? []))
        .toBe(generated.rawText);

      const persisted = await waitForStoredSegmentation(
        root,
        generated.id,
        generated.revision,
        ["ready"]
      );
      expect(calls).toHaveLength(1);
      expect(persisted.chunks?.map(({ title }) => title))
        .toEqual(["AI foundations", "AI applications"]);
      expect(new CaptureStore(root).get(generated.id)).toMatchObject({
        origin: "ollama",
        status: "ready",
        rawText: generated.rawText
      });
    } finally {
      state.dispose();
    }
  });
});
