import { describe, expect, it } from "vitest";
import {
  groupSourceBlocksIntoChunks,
  reconstructNoteFromBlocks,
  reconstructNoteFromChunks,
  segmentNoteDeterministically,
  splitNoteIntoSourceBlocks
} from "../shared/note-segmentation";

describe("deterministic note segmentation", () => {
  it("preserves CRLF, blank lines, surrounding whitespace, and Unicode as exact raw slices", () => {
    const source = [
      "\t \r\n  # Café 🧠",
      "",
      "\tIndented paragraph keeps its spaces.  ",
      "",
      "- First item",
      "- ثاني عنصر",
      "",
      "Trailing text.\t ",
      "  "
    ].join("\r\n");
    const first = splitNoteIntoSourceBlocks(source);
    const second = splitNoteIntoSourceBlocks(source);
    const segmentation = segmentNoteDeterministically(source, {
      minChunkChars: 30,
      targetChunkChars: 60,
      maxChunkChars: 100
    });

    expectExactSourceCoverage(source, first);
    expectExactSourceCoverage(source, segmentation.chunks);
    expect(reconstructNoteFromBlocks(first)).toBe(source);
    expect(reconstructNoteFromChunks(segmentation.chunks)).toBe(source);
    expect(first.map((block) => block.id)).toEqual(second.map((block) => block.id));
    expect(first.map((block) => block.index)).toEqual(first.map((_, index) => index));
    expect(first.some((block) => block.text.includes("\r\n\r\n"))).toBe(true);
    expect(first[0].text).toBe("\t \r\n");
    expect(first.at(-1)?.text.endsWith("  ")).toBe(true);
  });

  it("keeps Unicode exact and never splits a surrogate pair", () => {
    const source = [
      "Résumé naïve café — العربية हिन्दी.",
      "Emoji stay intact 🧠🚀✨. 日本語の文です。 中文句子也保持完整！",
      "Καλημέρα κόσμε. Привет, мир."
    ].join(" ").repeat(12);
    const blocks = splitNoteIntoSourceBlocks(source, { maxSourceBlockChars: 96 });

    expectExactSourceCoverage(source, blocks);
    expect(reconstructNoteFromBlocks(blocks)).toBe(source);
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) {
      expect(block.text.includes("\uFFFD")).toBe(false);
      const finalCodeUnit = block.text.charCodeAt(block.text.length - 1);
      expect(finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff).toBe(false);
    }
  });

  it("splits long uninterrupted prose at sentence boundaries into readable blocks", () => {
    const sentence = "A deterministic segment keeps authored text unchanged while making a long note easier to read. ";
    const source = sentence.repeat(30);
    const blocks = splitNoteIntoSourceBlocks(source, { maxSourceBlockChars: 240 });

    expectExactSourceCoverage(source, blocks);
    expect(reconstructNoteFromBlocks(blocks)).toBe(source);
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    expect(blocks.every((block) => block.text.length <= 240)).toBe(true);
    expect(blocks.slice(0, -1).every((block) => /[.!?…。！？]\s*$/u.test(block.text))).toBe(true);
  });

  it("recognizes Markdown headings and creates a block for every list item", () => {
    const source = [
      "# Radio fundamentals",
      "",
      "A packet carries structured bytes.",
      "",
      "- Advertising announces availability.",
      "  This continuation belongs to the advertising item.",
      "- Connections support repeated exchange.",
      "1. Discover a device.",
      "2. Subscribe to a characteristic.",
      "",
      "Transport",
      "---------",
      "",
      "The application interprets the payload."
    ].join("\n");
    const blocks = splitNoteIntoSourceBlocks(source);

    expectExactSourceCoverage(source, blocks);
    expect(reconstructNoteFromBlocks(blocks)).toBe(source);
    expect(blocks.filter((block) => block.kind === "heading")).toHaveLength(2);
    expect(blocks.filter((block) => block.kind === "list-item")).toHaveLength(4);
    expect(blocks.some((block) => block.text.includes("This continuation belongs"))).toBe(true);
    expect(blocks.some((block) => block.kind === "heading" && block.text.includes("Transport"))).toBe(true);
  });

  it("groups blocks into exact, ordered reader chunks near the requested size", () => {
    const source = [
      "# One\n\n",
      "First section sentence. ".repeat(18),
      "\n\n# Two\n\n",
      "Second section sentence. ".repeat(18),
      "\n\n# Three\n\n",
      "Third section sentence. ".repeat(18)
    ].join("");
    const blocks = splitNoteIntoSourceBlocks(source, { maxSourceBlockChars: 180 });
    const chunks = groupSourceBlocksIntoChunks(blocks, {
      minChunkChars: 160,
      targetChunkChars: 260,
      maxChunkChars: 360
    });

    expectExactSourceCoverage(source, chunks);
    expect(reconstructNoteFromChunks(chunks)).toBe(source);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(
      chunks.flatMap((chunk) => chunk.sourceBlockIDs),
    ).toEqual(blocks.map((block) => block.id));
    expect(chunks.every((chunk) => chunk.text.length <= 360)).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
  });

  it("keeps source positions usable when the same blocks are regrouped", () => {
    const source = [
      "# Position tracking\n\n",
      "The first paragraph establishes context. ".repeat(8),
      "\n\n",
      "The second paragraph contains the reader position marker. ".repeat(8)
    ].join("");
    const blocks = splitNoteIntoSourceBlocks(source, { maxSourceBlockChars: 150 });
    const compactChunks = groupSourceBlocksIntoChunks(blocks, {
      minChunkChars: 80,
      targetChunkChars: 140,
      maxChunkChars: 220
    });
    const wideChunks = groupSourceBlocksIntoChunks(blocks, {
      minChunkChars: 180,
      targetChunkChars: 320,
      maxChunkChars: 450
    });
    const sourceOffset = source.indexOf("reader position marker") + 7;
    const compact = compactChunks.find((chunk) => chunk.start <= sourceOffset && sourceOffset < chunk.end);
    const wide = wideChunks.find((chunk) => chunk.start <= sourceOffset && sourceOffset < chunk.end);

    expect(compact).toBeDefined();
    expect(wide).toBeDefined();
    expect(compact?.text[sourceOffset - compact.start]).toBe(source[sourceOffset]);
    expect(wide?.text[sourceOffset - wide.start]).toBe(source[sourceOffset]);
    expectExactSourceCoverage(source, compactChunks);
    expectExactSourceCoverage(source, wideChunks);
  });

  it("returns a complete empty segmentation for an empty note", () => {
    expect(segmentNoteDeterministically("")).toEqual({
      sourceLength: 0,
      blocks: [],
      chunks: []
    });
  });
});

function expectExactSourceCoverage(
  source: string,
  segments: readonly { start: number; end: number; text: string }[]
): void {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0].start).toBe(0);
  expect(segments.at(-1)?.end).toBe(source.length);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    expect(segment.start).toBe(index === 0 ? 0 : segments[index - 1].end);
    expect(segment.end - segment.start).toBe(segment.text.length);
    expect(segment.text).toBe(source.slice(segment.start, segment.end));
  }
  expect(segments.map((segment) => segment.text).join("")).toBe(source);
}
