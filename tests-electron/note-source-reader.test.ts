import { describe, expect, it } from "vitest";
import {
  segmentNoteDeterministically,
  type DeterministicNoteSegmentation
} from "../shared/note-segmentation";
import type { CaptureReadingChunk } from "../shared/types";
import { materializeReadingSections } from "../src/renderer/src/components/NotesPage";

const source = [
  "# Signals\r\n",
  "A bit is represented by a distinguishable physical state.\r\n",
  "\r\n",
  "## Bytes\r\n",
  "Eight bits make one byte, including values such as café and λ.\r\n",
  "\r\n",
  "- Protocols assign meaning to patterns.\r\n",
  "- Receivers apply the same rules.\r\n",
  "\r\n",
  "## Transfer\r\n",
  "The exact whitespace and Unicode must survive regrouping.\r\n"
].join("");

function deterministic(): DeterministicNoteSegmentation {
  return segmentNoteDeterministically(source, {
    targetChunkChars: 80,
    minChunkChars: 20,
    maxChunkChars: 120
  });
}

function semanticChunks(
  segmentation: DeterministicNoteSegmentation,
  splitAfter: number
): CaptureReadingChunk[] {
  return [
    {
      id: "semantic-foundations",
      title: "Foundations",
      sourceBlockIDs: segmentation.blocks.slice(0, splitAfter).map((block) => block.id)
    },
    {
      id: "semantic-transfer",
      title: "Transfer",
      sourceBlockIDs: segmentation.blocks.slice(splitAfter).map((block) => block.id)
    }
  ];
}

describe("paged note source materialization", () => {
  it("reconstructs the exact original source from valid semantic chunks", () => {
    const segmentation = deterministic();
    const chunks = semanticChunks(segmentation, Math.ceil(segmentation.blocks.length / 2));

    const sections = materializeReadingSections(
      segmentation.blocks,
      segmentation.chunks,
      chunks
    );

    expect(sections.map((section) => section.text).join("")).toBe(source);
    expect(sections.flatMap((section) => section.sourceBlockIDs)).toEqual(
      segmentation.blocks.map((block) => block.id)
    );
    expect(sections.map((section) => section.title)).toEqual(["Foundations", "Transfer"]);
  });

  it.each([
    ["omitted", (ids: string[]) => ids.slice(0, -1)],
    ["duplicated", (ids: string[]) => [...ids.slice(0, 2), ids[1], ...ids.slice(2)]],
    ["reordered", (ids: string[]) => [ids[1], ids[0], ...ids.slice(2)]]
  ])("falls back to deterministic sections when semantic block IDs are %s", (_case, mutate) => {
    const segmentation = deterministic();
    const expected = materializeReadingSections(
      segmentation.blocks,
      segmentation.chunks,
      undefined
    );
    const invalid: CaptureReadingChunk[] = [{
      id: "invalid-semantic",
      title: "Invalid",
      sourceBlockIDs: mutate(segmentation.blocks.map((block) => block.id))
    }];

    expect(materializeReadingSections(
      segmentation.blocks,
      segmentation.chunks,
      invalid
    )).toEqual(expected);
  });

  it("keeps the active fallback source-block anchor inside one semantic section", () => {
    const segmentation = deterministic();
    const fallback = materializeReadingSections(
      segmentation.blocks,
      segmentation.chunks,
      undefined
    );
    expect(fallback.length).toBeGreaterThan(1);

    const activeBlockID = fallback[1].sourceBlockIDs[0];
    const activeBlockIndex = segmentation.blocks.findIndex((block) => block.id === activeBlockID);
    expect(activeBlockIndex).toBeGreaterThan(0);

    const splitAfter = Math.min(activeBlockIndex + 1, segmentation.blocks.length - 1);
    const semantic = materializeReadingSections(
      segmentation.blocks,
      segmentation.chunks,
      semanticChunks(segmentation, splitAfter)
    );
    const containingSections = semantic.filter((section) =>
      section.sourceBlockIDs.includes(activeBlockID)
    );

    expect(containingSections).toHaveLength(1);
    expect(containingSections[0].text).toContain(segmentation.blocks[activeBlockIndex].text);
    expect(semantic.map((section) => section.text).join("")).toBe(source);
  });
});
