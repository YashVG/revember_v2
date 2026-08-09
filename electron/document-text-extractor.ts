import { OfficeParser, type OfficeChunk } from "officeparser";
import type { DocumentLabFileKind } from "../shared/types";

const MAX_EXTRACTED_CHARACTERS = 250_000;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;
const MAX_STRUCTURED_BLOCK_CHARACTERS = 1_800;

export interface ExtractedDocumentSourceBlock {
  id: string;
  text: string;
}

export type DocumentTextExtraction =
  | {
    status: "extracted";
    text: string;
    truncated: boolean;
    sourceBlocks?: ExtractedDocumentSourceBlock[];
  }
  | { status: "blocked"; message: string };

export class DocumentTextExtractor {
  async extract(
    sourceBytes: Buffer,
    kind: DocumentLabFileKind,
    signal: AbortSignal
  ): Promise<DocumentTextExtraction> {
    if (signal.aborted) return { status: "blocked", message: "Cancelled." };
    if (kind === "text" || kind === "markdown") return extractUTF8(sourceBytes);

    try {
      const ast = await OfficeParser.parseOffice(new Uint8Array(sourceBytes), {
        fileType: officeFileType(kind),
        abortSignal: signal,
        extractAttachments: false,
        includeRawContent: false,
        ocr: false,
        ignoreComments: true,
        ignoreHeadersAndFooters: true,
        ignoreSlideMasters: true,
        ignoreInternalLinks: true,
        outputErrorToConsole: false,
        decompressionLimits: {
          maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
          maxZipEntries: MAX_ZIP_ENTRIES
        }
      });
      if (kind === "pdf" || kind === "slides") {
        const chunks = await ast.to("chunks", {
          chunksConfig: {
            strategy: "document-structure",
            splitBy: kind === "pdf" ? "page" : "slide",
            maxChunkSize: 2_000,
            includeMetadata: true,
            stripWhitespace: true
          }
        });
        const sourceBlocks = groupLocatedText(chunks.value, kind);
        if (sourceBlocks.length > 0) return boundedStructuredText(sourceBlocks);
      }
      const rendered = await ast.to("text", {
        includeImages: false,
        textConfig: {
          preserveLayout: false,
          renderNotes: true
        }
      });
      if (typeof rendered.value !== "string") {
        return { status: "blocked", message: "No text found." };
      }
      return boundedText(rendered.value);
    } catch (error) {
      if (signal.aborted) return { status: "blocked", message: "Cancelled." };
      return {
        status: "blocked",
        message: extractionErrorMessage(error)
      };
    }
  }
}

function groupLocatedText(
  chunks: readonly OfficeChunk[],
  kind: "pdf" | "slides"
): ExtractedDocumentSourceBlock[] {
  const groups: Array<{ location: number | undefined; text: string[] }> = [];
  let currentLocation: number | undefined;
  let current: string[] = [];

  const flush = (): void => {
    if (current.length > 0) groups.push({ location: currentLocation, text: current });
    current = [];
  };

  for (const chunk of chunks) {
    const text = chunk.text.replace(/\r\n?/g, "\n").trim();
    if (!text) continue;
    const location = kind === "pdf"
      ? chunk.metadata.pageNumber
      : chunk.metadata.slideNumber;
    if (current.length > 0 && location !== currentLocation) flush();
    currentLocation = location;
    current.push(text);
  }
  flush();
  const label = kind === "pdf" ? "page" : "slide";
  return groups.flatMap((group, groupIndex) => {
    const baseID = `${label}-${group.location ?? groupIndex + 1}`;
    return splitStructuredBlock(group.text.join("\n"), baseID);
  });
}

function splitStructuredBlock(text: string, baseID: string): ExtractedDocumentSourceBlock[] {
  const blocks: ExtractedDocumentSourceBlock[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= MAX_STRUCTURED_BLOCK_CHARACTERS) {
      blocks.push({
        id: blocks.length === 0 ? baseID : `${baseID}-part-${blocks.length + 1}`,
        text: remaining
      });
      break;
    }
    const search = remaining.slice(0, MAX_STRUCTURED_BLOCK_CHARACTERS + 1);
    const newline = search.lastIndexOf("\n");
    const whitespace = search.lastIndexOf(" ");
    const splitAt = Math.max(newline, whitespace, 1);
    blocks.push({
      id: blocks.length === 0 ? baseID : `${baseID}-part-${blocks.length + 1}`,
      text: remaining.slice(0, splitAt).trim()
    });
    remaining = remaining.slice(splitAt).trim();
  }
  return blocks;
}

function boundedStructuredText(
  sourceBlocks: readonly ExtractedDocumentSourceBlock[]
): DocumentTextExtraction {
  const boundedBlocks: ExtractedDocumentSourceBlock[] = [];
  let usedCharacters = 0;
  let truncated = false;

  for (const block of sourceBlocks) {
    const separatorLength = boundedBlocks.length > 0 ? 2 : 0;
    const available = MAX_EXTRACTED_CHARACTERS - usedCharacters - separatorLength;
    if (available <= 0) {
      truncated = true;
      break;
    }
    const text = block.text.slice(0, available).trim();
    if (text) boundedBlocks.push({ ...block, text });
    usedCharacters += separatorLength + text.length;
    if (text.length < block.text.length) {
      truncated = true;
      break;
    }
  }
  if (boundedBlocks.length === 0) return { status: "blocked", message: "No text found." };
  return {
    status: "extracted",
    text: boundedBlocks.map(({ text }) => text).join("\n\n"),
    truncated,
    sourceBlocks: boundedBlocks
  };
}

function extractUTF8(sourceBytes: Buffer): DocumentTextExtraction {
  if (sourceBytes.includes(0)) {
    return { status: "blocked", message: "Binary text file." };
  }
  try {
    return boundedText(new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes));
  } catch {
    return { status: "blocked", message: "UTF-8 required." };
  }
}

function boundedText(value: string): DocumentTextExtraction {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) return { status: "blocked", message: "No text found." };
  return {
    status: "extracted",
    text: normalized.slice(0, MAX_EXTRACTED_CHARACTERS),
    truncated: normalized.length > MAX_EXTRACTED_CHARACTERS
  };
}

function officeFileType(kind: Exclude<DocumentLabFileKind, "text" | "markdown">): "pdf" | "docx" | "pptx" {
  if (kind === "word") return "docx";
  if (kind === "slides") return "pptx";
  return "pdf";
}

function extractionErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  if (detail.includes("password")) return "Password-protected file.";
  if (detail.includes("decompress") || detail.includes("zip") || detail.includes("limit")) {
    return "File exceeds extraction limits.";
  }
  return "Text extraction failed.";
}
