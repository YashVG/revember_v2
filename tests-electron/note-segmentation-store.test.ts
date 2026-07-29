import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureSegmentation } from "../shared/types";
import {
  NoteSegmentationStore,
  normalizeCaptureSegmentation
} from "../electron/note-segmentation-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-note-segmentation-"));
  roots.push(root);
  return root;
}

function segmentation(
  overrides: Partial<CaptureSegmentation> = {}
): CaptureSegmentation {
  return {
    schemaVersion: 1,
    captureID: "capture-one",
    captureRevision: 3,
    status: "ready",
    chunks: [
      {
        id: "chunk-1",
        title: "First idea",
        sourceBlockIDs: ["S0001", "S0002"]
      },
      {
        id: "chunk-2",
        sourceBlockIDs: ["S0003"]
      }
    ],
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:01.000Z",
    ...overrides
  };
}

describe("NoteSegmentationStore", () => {
  it("stores revision-keyed segmentation atomically with private permissions", async () => {
    const root = await fixture();
    const store = new NoteSegmentationStore(root);
    const input = segmentation();

    const written = store.write(input);
    const storedPath = path.join(
      root,
      "capture-segmentations",
      "capture-one-3.json"
    );

    expect(written).toEqual(input);
    expect(store.get("capture-one", 3)).toEqual(input);
    expect(store.get("capture-one", 2)).toBeUndefined();
    expect((await fs.stat(storedPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(storedPath))).mode & 0o777).toBe(0o700);
    expect(
      (await fs.readdir(path.dirname(storedPath))).filter((name) => name.includes(".tmp-")),
    ).toEqual([]);
  });

  it("returns structured clones from writes and reads", async () => {
    const root = await fixture();
    const store = new NoteSegmentationStore(root);
    const input = segmentation();

    const written = store.write(input);
    written.chunks![0].sourceBlockIDs[0] = "changed-written";
    const firstRead = store.get(input.captureID, input.captureRevision)!;
    firstRead.chunks![0].sourceBlockIDs[0] = "changed-read";

    expect(
      store.get(input.captureID, input.captureRevision)!.chunks![0].sourceBlockIDs[0]
    ).toBe("S0001");
  });

  it("validates status-specific chunks and errors", () => {
    expect(
      () => normalizeCaptureSegmentation(segmentation({ status: "ready", chunks: undefined }))
    ).toThrow(/ready capture segmentation needs chunks/i);
    expect(
      () => normalizeCaptureSegmentation(segmentation({ status: "queued" }))
    ).toThrow(/only a ready capture segmentation can include chunks/i);
    expect(
      () => normalizeCaptureSegmentation(
        segmentation({ status: "failed", chunks: undefined })
      )
    ).toThrow(/needs an error message/i);
    expect(
      () => normalizeCaptureSegmentation(
        segmentation({
          status: "running",
          chunks: undefined,
          errorMessage: "not allowed"
        })
      )
    ).toThrow(/only a failed or unavailable capture segmentation/i);
    expect(
      normalizeCaptureSegmentation(
        segmentation({
          status: "unavailable",
          chunks: undefined,
          errorMessage: "Ollama is unavailable."
        })
      )
    ).toEqual(
      segmentation({
        status: "unavailable",
        chunks: undefined,
        errorMessage: "Ollama is unavailable."
      })
    );
  });

  it("rejects malformed and ambiguous chunks", () => {
    expect(
      () => normalizeCaptureSegmentation(segmentation({ chunks: [] }))
    ).toThrow(/between 1 and 1000 chunks/i);
    expect(
      () => normalizeCaptureSegmentation(segmentation({
        chunks: [
          { id: "chunk-1", sourceBlockIDs: ["S0001"] },
          { id: "chunk-1", sourceBlockIDs: ["S0002"] }
        ]
      }))
    ).toThrow(/chunk id chunk-1 is duplicated/i);
    expect(
      () => normalizeCaptureSegmentation(segmentation({
        chunks: [
          { id: "chunk-1", sourceBlockIDs: ["S0001"] },
          { id: "chunk-2", sourceBlockIDs: ["S0001"] }
        ]
      }))
    ).toThrow(/source block id S0001 is duplicated/i);
    expect(
      () => normalizeCaptureSegmentation(segmentation({
        chunks: [{ id: "chunk-1", sourceBlockIDs: [] }]
      }))
    ).toThrow(/between 1 and 1000 source block ids/i);
    expect(
      () => normalizeCaptureSegmentation(segmentation({
        chunks: [{ id: "../escape", sourceBlockIDs: ["S0001"] }]
      }))
    ).toThrow(/invalid/i);
  });

  it("rejects unsafe identifiers and revision values before touching disk", async () => {
    const root = await fixture();
    const store = new NoteSegmentationStore(root);

    expect(() => store.get("../capture-one", 1)).toThrow(/invalid/i);
    expect(() => store.get("capture-one", 0)).toThrow(/positive integer/i);
    await expect(
      fs.access(path.join(root, "capture-segmentations"))
    ).rejects.toThrow(/ENOENT/);
  });

  it("rejects a symlinked storage directory", async () => {
    const root = await fixture();
    const outside = await fixture();
    await fs.symlink(outside, path.join(root, "capture-segmentations"));

    expect(
      () => new NoteSegmentationStore(root).write(segmentation())
    ).toThrow(/must be a real directory/i);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("quarantines unsafe entries and malformed persisted records", async () => {
    const root = await fixture();
    const directory = path.join(root, "capture-segmentations");
    const filePath = path.join(directory, "capture-one-3.json");
    const outsideFile = path.join(root, "outside.json");
    await fs.mkdir(directory);
    await fs.writeFile(outsideFile, "{}\n");
    await fs.symlink(outsideFile, filePath);

    expect(
      () => new NoteSegmentationStore(root).get("capture-one", 3)
    ).toThrow(/not a safe regular file/i);
    expect(
      (await fs.readdir(directory)).some((name) =>
        /^capture-one-3\.corrupt-\d+-[a-f0-9-]+\.json$/.test(name)
      )
    ).toBe(true);

    await fs.writeFile(
      filePath,
      JSON.stringify(segmentation({ captureRevision: 4 }))
    );
    expect(
      () => new NoteSegmentationStore(root).get("capture-one", 3)
    ).toThrow(/identity must match its file name/i);
    expect(
      (await fs.readdir(directory)).filter((name) =>
        name.startsWith("capture-one-3.corrupt-")
      ).length
    ).toBe(2);
  });
});
