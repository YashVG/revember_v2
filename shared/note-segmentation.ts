export type NoteSourceBlockKind = "heading" | "list-item" | "paragraph" | "whitespace";

export interface NoteSegmentationOptions {
  /**
   * Maximum size of an atomic source block before prose is split at a sentence
   * or whitespace boundary.
   */
  maxSourceBlockChars?: number;
  /** Preferred size of a reader-facing chunk. */
  targetChunkChars?: number;
  /** Soft lower bound used before starting another reader-facing chunk. */
  minChunkChars?: number;
  /** Maximum reader-facing chunk size when source-block boundaries allow it. */
  maxChunkChars?: number;
}

export interface NoteSourceBlock {
  /** Content-derived and deterministic for the same source block. */
  id: string;
  index: number;
  kind: NoteSourceBlockKind;
  /** UTF-16 offsets into the original JavaScript string. */
  start: number;
  end: number;
  /** Exact source slice, including its original whitespace. */
  text: string;
}

export interface NoteReadingChunk {
  /** Content-derived and deterministic for the same ordered source blocks. */
  id: string;
  index: number;
  /** UTF-16 offsets spanning the chunk in the original JavaScript string. */
  start: number;
  end: number;
  sourceBlockIDs: string[];
  /** Exact concatenation of the referenced source blocks. */
  text: string;
}

export interface DeterministicNoteSegmentation {
  sourceLength: number;
  blocks: NoteSourceBlock[];
  chunks: NoteReadingChunk[];
}

export const DEFAULT_MAX_SOURCE_BLOCK_CHARS = 1_200;
export const DEFAULT_TARGET_CHUNK_CHARS = 1_000;
export const DEFAULT_MIN_CHUNK_CHARS = 400;
export const DEFAULT_MAX_CHUNK_CHARS = 1_500;

interface LineSpan {
  start: number;
  end: number;
  body: string;
}

interface SourceRange {
  start: number;
  end: number;
  kind: NoteSourceBlockKind;
}

/**
 * Produces exact, deterministic source blocks without depending on Electron,
 * Node APIs, or a model. Joining block.text always reconstructs sourceText.
 */
export function splitNoteIntoSourceBlocks(
  sourceText: string,
  options: Pick<NoteSegmentationOptions, "maxSourceBlockChars"> = {}
): NoteSourceBlock[] {
  if (typeof sourceText !== "string") throw new TypeError("sourceText must be a string.");
  if (!sourceText.length) return [];

  const maxSourceBlockChars = positiveInteger(
    options.maxSourceBlockChars,
    DEFAULT_MAX_SOURCE_BLOCK_CHARS,
    "maxSourceBlockChars"
  );
  const structuralRanges = structuralSourceRanges(sourceText);
  const readableRanges = structuralRanges.flatMap((range) =>
    splitLongRange(sourceText, range, maxSourceBlockChars)
  );
  const occurrences = new Map<string, number>();

  return readableRanges.map((range, index) => {
    const text = sourceText.slice(range.start, range.end);
    const fingerprint = stableFingerprint(`${range.kind}\u0000${text}`);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return {
      id: `source-${fingerprint}-${occurrence}`,
      index,
      kind: range.kind,
      start: range.start,
      end: range.end,
      text
    };
  });
}

/**
 * Groups contiguous source blocks into reader-sized chunks. Source blocks are
 * never rewritten, reordered, duplicated, or omitted.
 */
export function groupSourceBlocksIntoChunks(
  blocks: readonly NoteSourceBlock[],
  options: Pick<
    NoteSegmentationOptions,
    "targetChunkChars" | "minChunkChars" | "maxChunkChars"
  > = {}
): NoteReadingChunk[] {
  if (!blocks.length) return [];
  assertContiguousBlocks(blocks);

  const targetChunkChars = positiveInteger(
    options.targetChunkChars,
    DEFAULT_TARGET_CHUNK_CHARS,
    "targetChunkChars"
  );
  const minChunkChars = Math.min(
    positiveInteger(options.minChunkChars, DEFAULT_MIN_CHUNK_CHARS, "minChunkChars"),
    targetChunkChars
  );
  const maxChunkChars = Math.max(
    positiveInteger(options.maxChunkChars, DEFAULT_MAX_CHUNK_CHARS, "maxChunkChars"),
    targetChunkChars
  );

  const groups: NoteSourceBlock[][] = [];
  let current: NoteSourceBlock[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (!current.length) return;
    groups.push(current);
    current = [];
    currentLength = 0;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    const currentHasContent = current.some((candidate) => candidate.kind !== "whitespace");
    const startsNewSection = block.kind === "heading" && currentHasContent;
    const exceedsMaximum = current.length > 0
      && currentLength >= minChunkChars
      && currentLength + block.text.length > maxChunkChars;

    if (startsNewSection || exceedsMaximum) flush();

    current.push(block);
    currentLength += block.text.length;

    const nextStartsSection = next?.kind === "heading";
    const nextWouldExceedMaximum = next
      ? currentLength + next.text.length > maxChunkChars
      : false;
    if (
      currentLength >= targetChunkChars
      && (!next || nextStartsSection || nextWouldExceedMaximum)
    ) {
      flush();
    }
  }
  flush();

  const occurrences = new Map<string, number>();
  return groups.map((group, index) => {
    const blockKey = group.map((block) => block.id).join("\u0000");
    const fingerprint = stableFingerprint(blockKey);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return {
      id: `chunk-${fingerprint}-${occurrence}`,
      index,
      start: group[0].start,
      end: group[group.length - 1].end,
      sourceBlockIDs: group.map((block) => block.id),
      text: group.map((block) => block.text).join("")
    };
  });
}

export function segmentNoteDeterministically(
  sourceText: string,
  options: NoteSegmentationOptions = {}
): DeterministicNoteSegmentation {
  const blocks = splitNoteIntoSourceBlocks(sourceText, options);
  return {
    sourceLength: sourceText.length,
    blocks,
    chunks: groupSourceBlocksIntoChunks(blocks, options)
  };
}

export function reconstructNoteFromBlocks(blocks: readonly NoteSourceBlock[]): string {
  return blocks.map((block) => block.text).join("");
}

export function reconstructNoteFromChunks(chunks: readonly NoteReadingChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}

function structuralSourceRanges(sourceText: string): SourceRange[] {
  const lines = scanLines(sourceText);
  const boundaries = new Set<number>([0, sourceText.length]);
  let inList = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = lines[index - 1];
    const previousWasBlank = previous ? isBlankLine(previous.body) : false;

    if (isBlankLine(line.body)) {
      inList = false;
      continue;
    }

    if (previousWasBlank) boundaries.add(line.start);

    if (isAtxHeading(line.body)) {
      boundaries.add(line.start);
      boundaries.add(line.end);
      inList = false;
      continue;
    }

    if (isSetextUnderline(line.body) && previous && !isBlankLine(previous.body)) {
      boundaries.add(previous.start);
      boundaries.add(line.end);
      inList = false;
      continue;
    }

    if (isListItem(line.body)) {
      boundaries.add(line.start);
      inList = true;
      continue;
    }

    if (inList && !isIndentedContinuation(line.body)) {
      boundaries.add(line.start);
      inList = false;
    }
  }

  const sorted = [...boundaries].sort((left, right) => left - right);
  const ranges: SourceRange[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end <= start) continue;
    ranges.push({
      start,
      end,
      kind: classifySourceText(sourceText.slice(start, end))
    });
  }
  return ranges;
}

function splitLongRange(
  sourceText: string,
  range: SourceRange,
  maxSourceBlockChars: number
): SourceRange[] {
  if (
    range.end - range.start <= maxSourceBlockChars
    || range.kind === "heading"
    || range.kind === "whitespace"
  ) {
    return [range];
  }

  const text = sourceText.slice(range.start, range.end);
  const sentenceBreaks = sentenceBoundaryOffsets(text);
  const ranges: SourceRange[] = [];
  let cursor = 0;

  while (text.length - cursor > maxSourceBlockChars) {
    const next = chooseReadableBoundary(text, cursor, maxSourceBlockChars, sentenceBreaks);
    ranges.push({
      start: range.start + cursor,
      end: range.start + next,
      kind: range.kind
    });
    cursor = next;
  }

  if (cursor < text.length) {
    ranges.push({
      start: range.start + cursor,
      end: range.end,
      kind: range.kind
    });
  }
  return ranges;
}

function chooseReadableBoundary(
  text: string,
  start: number,
  maximum: number,
  sentenceBreaks: readonly number[]
): number {
  const lower = start + Math.max(1, Math.floor(maximum * 0.5));
  const target = start + Math.floor(maximum * 0.8);
  const upper = Math.min(text.length, start + maximum);
  const candidates = sentenceBreaks.filter((boundary) => boundary >= lower && boundary <= upper);
  if (candidates.length) {
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
    );
  }

  for (let index = upper; index >= lower; index -= 1) {
    if (isWhitespaceCodeUnit(text.charCodeAt(index - 1))) return safeCodePointBoundary(text, index);
  }
  return safeCodePointBoundary(text, upper);
}

function sentenceBoundaryOffsets(text: string): number[] {
  const boundaries: number[] = [];
  const pattern = /[.!?…。！？]+(?:["'”’»)\]}]+)?(?:[ \t]+|(?=\r\n|\n|\r|$))/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (pattern.lastIndex > 0 && pattern.lastIndex < text.length) boundaries.push(pattern.lastIndex);
  }
  return boundaries;
}

function scanLines(sourceText: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let start = 0;
  while (start < sourceText.length) {
    let bodyEnd = start;
    while (
      bodyEnd < sourceText.length
      && sourceText[bodyEnd] !== "\n"
      && sourceText[bodyEnd] !== "\r"
    ) {
      bodyEnd += 1;
    }
    let end = bodyEnd;
    if (sourceText[end] === "\r" && sourceText[end + 1] === "\n") end += 2;
    else if (sourceText[end] === "\r" || sourceText[end] === "\n") end += 1;
    lines.push({ start, end, body: sourceText.slice(start, bodyEnd) });
    start = end;
  }
  return lines;
}

function classifySourceText(text: string): NoteSourceBlockKind {
  if (!text.trim()) return "whitespace";
  const lines = scanLines(text);
  const firstContentIndex = lines.findIndex((line) => !isBlankLine(line.body));
  const firstContent = lines[firstContentIndex]?.body ?? "";
  if (
    isAtxHeading(firstContent)
    || (
      firstContentIndex >= 0
      && lines[firstContentIndex + 1]
      && isSetextUnderline(lines[firstContentIndex + 1].body)
    )
  ) {
    return "heading";
  }
  if (isListItem(firstContent)) return "list-item";
  return "paragraph";
}

function isBlankLine(body: string): boolean {
  return /^[\t ]*$/u.test(body);
}

function isAtxHeading(body: string): boolean {
  return /^[\t ]{0,3}#{1,6}(?:[\t ]+|$)/u.test(body);
}

function isSetextUnderline(body: string): boolean {
  return /^[\t ]{0,3}(?:=+|-+)[\t ]*$/u.test(body);
}

function isListItem(body: string): boolean {
  return /^[\t ]*(?:[-+*]|\d{1,9}[.)])[\t ]+/u.test(body);
}

function isIndentedContinuation(body: string): boolean {
  return /^(?:\t| {2,})/u.test(body);
}

function isWhitespaceCodeUnit(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

function safeCodePointBoundary(text: string, boundary: number): number {
  if (
    boundary > 0
    && boundary < text.length
    && isHighSurrogate(text.charCodeAt(boundary - 1))
    && isLowSurrogate(text.charCodeAt(boundary))
  ) {
    return boundary - 1;
  }
  return boundary;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertContiguousBlocks(blocks: readonly NoteSourceBlock[]): void {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.end - block.start !== block.text.length) {
      throw new Error(`Source block ${block.id} does not match its source offsets.`);
    }
    if (index > 0 && blocks[index - 1].end !== block.start) {
      throw new Error(`Source block ${block.id} is not contiguous with the preceding block.`);
    }
  }
}

/** Small browser-safe FNV-1a fingerprint; this is an ID, not a security hash. */
function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
