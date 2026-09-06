import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import { CaptureStore } from "../electron/capture-store";
import { NoteSegmentationCoordinator } from "../electron/note-segmentation-coordinator";
import { NoteSegmentationStore } from "../electron/note-segmentation-store";
import type {
  GeneratedNoteSegmentation,
  LocalNoteModel,
  SegmentNoteModelInput
} from "../electron/ollama-note-model";
import { splitNoteIntoSourceBlocks } from "../shared/note-segmentation";
import type { CaptureReadingChunk, LearnerCapture } from "../shared/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function fixture(prefix = "revember-note-segmentation-security-"): Promise<string> {
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
  await fs.writeFile(path.join(root, "topics", "security.json"), `${JSON.stringify({
    schemaVersion: 2,
    revision: 1,
    id: "security",
    title: "Security",
    summary: "Trust-boundary fixtures",
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

function readyCapture(root: string, rawText: string): LearnerCapture {
  return new CaptureStore(root).save({
    expectedRevision: 0,
    topicID: "security",
    title: "Authoritative note",
    rawText,
    status: "ready"
  }, new Date("2026-07-28T10:00:00.000Z"));
}

function localModel(
  segmentNote: NonNullable<LocalNoteModel["segmentNote"]>
): LocalNoteModel {
  return {
    segmentNote
  };
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
    if (Date.now() >= deadline) throw new Error("Timed out waiting for segmentation.");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function sourceTextForChunks(
  rawText: string,
  chunks: readonly CaptureReadingChunk[]
): string {
  const blocks = splitNoteIntoSourceBlocks(rawText);
  const textByID = new Map(blocks.map(({ id, text }) => [id, text]));
  return chunks
    .flatMap(({ sourceBlockIDs }) => sourceBlockIDs)
    .map((id) => {
      const text = textByID.get(id);
      if (text === undefined) throw new Error(`Unknown source block ${id}.`);
      return text;
    })
    .join("");
}

describe("note-segmentation trust boundary", () => {
  it("exposes only capture ID and revision through renderer IPC", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const [preloadSource, mainSource] = await Promise.all([
      fs.readFile(path.join(repositoryRoot, "electron", "preload.ts"), "utf8"),
      fs.readFile(path.join(repositoryRoot, "electron", "main.ts"), "utf8")
    ]);

    for (const method of ["getCaptureSegmentation", "retryCaptureSegmentation"]) {
      const preloadLines = preloadSource
        .split("\n")
        .filter((line) => line.includes(`${method}:`));
      expect(preloadLines).toHaveLength(1);
      expect(preloadLines[0]).toContain("(captureID: string, captureRevision: number)");
      expect(preloadLines[0]).toContain("captureID, captureRevision");
      expect(preloadLines[0]).not.toMatch(
        /\b(rawText|rootPath|knowledgeRootPath|filePath)\b/
      );
    }

    for (const method of ["getCaptureSegmentation", "retryCaptureSegmentation"]) {
      const handlerLines = mainSource
        .split("\n")
        .filter((line) => line.includes(`handleState(ipcChannels.${method}`));
      expect(handlerLines).toHaveLength(1);
      expect(handlerLines[0]).toContain("captureID: string, captureRevision: number");
      expect(handlerLines[0]).toContain("captureID, captureRevision");
      expect(handlerLines[0]).not.toMatch(
        /\b(rawText|rootPath|knowledgeRootPath|filePath)\b/
      );
    }
    expect(mainSource).toContain("handleTrusted(channel, async (_event, ...args: TArguments) => {");
    expect(mainSource).toContain("accountVaults.requireActive(cloudAuth.state.user?.id)");
  });

  it("reloads authoritative capture text in main state and ignores extra caller arguments", async () => {
    const { root, settingsPath, progressPath } = await stateFixture();
    const rawText = [
      "# Stored source",
      "",
      "This exact text belongs to the capture store.",
      "",
      "A second paragraph must also remain authoritative."
    ].join("\n");
    const capture = readyCapture(root, rawText);
    let receivedInput: SegmentNoteModelInput | undefined;
    const model = localModel(async (input) => {
      receivedInput = input;
      return {
        chunks: [{
          title: "Stored source",
          sourceBlockIDs: input.sourceBlocks.map(({ id }) => id)
        }]
      };
    });
    const state = new RevemberState({
      settingsPath,
      bundledKnowledgeRoot: root,
      legacyProgressPath: progressPath
    }, model);

    try {
      const invokeLikeRenderer = state.getCaptureSegmentation.bind(state) as unknown as (
        captureID: unknown,
        captureRevision: unknown,
        forgedRawText?: unknown,
        forgedPath?: unknown
      ) => unknown;
      invokeLikeRenderer(
        capture.id,
        capture.revision,
        "FORGED MODEL INPUT",
        "/tmp/forged-capture.json"
      );
      await waitFor(
        () => receivedInput,
        (input) => input.sourceBlocks.length > 0
      );

      expect(receivedInput?.sourceBlocks).toEqual(
        splitNoteIntoSourceBlocks(rawText).map(({ id, text }) => ({ id, text }))
      );
      expect(receivedInput?.sourceBlocks.map(({ text }) => text).join("")).toBe(rawText);
      expect(receivedInput?.sourceBlocks.map(({ text }) => text).join(""))
        .not.toContain("FORGED MODEL INPUT");
    } finally {
      state.dispose();
    }
  });

  it("rejects traversal identifiers and quarantines a symlinked result file", async () => {
    const root = await fixture();
    const store = new NoteSegmentationStore(root);

    expect(() => store.get("../outside", 1)).toThrow(/capture id is invalid/i);
    expect(() => store.get("capture/escape", 1)).toThrow(/capture id is invalid/i);
    expect(() => store.get("capture-one", 0)).toThrow(/positive integer/i);
    expect(() => store.write({
      schemaVersion: 1,
      captureID: "../outside",
      captureRevision: 1,
      status: "queued",
      createdAt: "2026-07-28T10:00:00.000Z",
      updatedAt: "2026-07-28T10:00:00.000Z"
    })).toThrow(/capture segmentation captureID is invalid/i);

    await fs.mkdir(store.directoryPath, { recursive: true });
    const outsideTarget = path.join(root, "outside-target.json");
    const unsafePath = path.join(
      store.directoryPath,
      "capture-one-1.json"
    );
    await fs.writeFile(outsideTarget, "outside target remains untouched\n");
    await fs.symlink(outsideTarget, unsafePath);

    expect(() => store.get("capture-one", 1)).toThrow(/not a safe regular file/i);
    await expect(fs.readFile(outsideTarget, "utf8"))
      .resolves.toBe("outside target remains untouched\n");
    await expect(fs.lstat(unsafePath)).rejects.toMatchObject({ code: "ENOENT" });

    const quarantined = (await fs.readdir(store.directoryPath))
      .filter((name) => /^capture-one-1\.corrupt-.+\.json$/.test(name));
    expect(quarantined).toHaveLength(1);
    expect((await fs.lstat(path.join(store.directoryPath, quarantined[0]))).isSymbolicLink())
      .toBe(true);
  });

  it("cannot persist model-authored replacement text through a chunk response", async () => {
    const root = await fixture();
    const rawText = [
      "## Exact source",
      "",
      "Original paragraph one.",
      "",
      "Original paragraph two."
    ].join("\n");
    const capture = readyCapture(root, rawText);
    const injectedText = "MODEL REWROTE THE NOTE";
    const coordinator = new NoteSegmentationCoordinator(localModel(async (input) => ({
      chunks: [{
        title: "Exact source",
        sourceBlockIDs: input.sourceBlocks.map(({ id }) => id),
        text: injectedText,
        rawText: injectedText
      }]
    } as unknown as GeneratedNoteSegmentation)));

    try {
      coordinator.enqueue(capture, root);
      const stored = await waitFor(
        () => new NoteSegmentationStore(root).get(capture.id, capture.revision),
        (segmentation) => segmentation.status === "ready"
      );
      const storedPath = path.join(
        root,
        "capture-segmentations",
        `${capture.id}-${capture.revision}.json`
      );

      expect(stored.chunks).toEqual([{
        id: "section-0001",
        title: "Exact source",
        sourceBlockIDs: splitNoteIntoSourceBlocks(rawText).map(({ id }) => id)
      }]);
      expect(sourceTextForChunks(rawText, stored.chunks ?? [])).toBe(rawText);
      expect(await fs.readFile(storedPath, "utf8")).not.toContain(injectedText);
      expect(new CaptureStore(root).get(capture.id).rawText).toBe(rawText);
    } finally {
      coordinator.dispose();
    }
  });
});
