import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { CaptureSegmentation } from "../shared/types";
import {
  array,
  nonEmptyExactString,
  oneOf,
  positiveInteger,
  record,
  strictIdentifier
} from "./input-validation";

type CaptureSegmentationStatus = CaptureSegmentation["status"];
type CaptureSegmentationChunk = NonNullable<CaptureSegmentation["chunks"]>[number];

const statuses = new Set<CaptureSegmentationStatus>([
  "queued",
  "running",
  "ready",
  "failed",
  "unavailable"
]);

export const captureSegmentationLimits = Object.freeze({
  maxChunks: 1_000,
  maxChunkTitleLength: 200,
  maxSourceBlockIDsPerChunk: 1_000,
  maxErrorMessageLength: 1_000
});

/** Stores derived note organization independently so the source note remains authoritative. */
export class NoteSegmentationStore {
  readonly directoryPath: string;
  private readonly rootPath: string;

  constructor(knowledgeRootPath: string) {
    this.rootPath = path.resolve(knowledgeRootPath);
    this.directoryPath = path.join(this.rootPath, "capture-segmentations");
  }

  get(rawCaptureID: unknown, rawRevision: unknown): CaptureSegmentation | undefined {
    const captureID = strictIdentifier(rawCaptureID, "capture id");
    const captureRevision = positiveInteger(rawRevision, "capture revision");
    if (!existsSync(this.directoryPath)) return undefined;
    this.assertSafeDirectory(false);
    const filePath = this.filePath(captureID, captureRevision);
    if (!existsSync(filePath)) return undefined;
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      this.quarantineUnsafeEntry(filePath);
      throw new Error(
        `Capture segmentation ${captureID} revision ${captureRevision} is not a safe regular file.`
      );
    }
    try {
      const segmentation = normalizeCaptureSegmentation(JSON.parse(readFileSync(filePath, "utf8")));
      if (
        segmentation.captureID !== captureID
        || segmentation.captureRevision !== captureRevision
      ) {
        throw new Error("Capture segmentation identity must match its file name.");
      }
      return structuredClone(segmentation);
    } catch (error) {
      if (existsSync(filePath)) this.quarantineUnsafeEntry(filePath);
      throw new Error(
        `Capture segmentation ${captureID} revision ${captureRevision} was unreadable and quarantined: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  write(value: CaptureSegmentation): CaptureSegmentation {
    const segmentation = normalizeCaptureSegmentation(value);
    this.assertSafeDirectory(true);
    const filePath = this.filePath(segmentation.captureID, segmentation.captureRevision);
    if (existsSync(filePath)) {
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(
          `Capture segmentation ${segmentation.captureID} revision ${segmentation.captureRevision} is not a safe regular file.`
        );
      }
    }
    const temporaryPath = path.join(
      this.directoryPath,
      `.${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`
    );
    try {
      writeFileSync(temporaryPath, JSON.stringify(segmentation, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      renameSync(temporaryPath, filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
    return structuredClone(segmentation);
  }

  private filePath(captureID: string, captureRevision: number): string {
    const candidate = path.join(
      this.directoryPath,
      `${strictIdentifier(captureID, "capture id")}-${positiveInteger(captureRevision, "capture revision")}.json`
    );
    assertContained(this.directoryPath, candidate);
    return candidate;
  }

  private assertSafeDirectory(create: boolean): void {
    if (!existsSync(this.directoryPath)) {
      if (!create) return;
      mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 });
    }
    const stat = lstatSync(this.directoryPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        "The capture segmentations path must be a real directory inside the active knowledge root."
      );
    }
    assertContained(realpathSync(this.rootPath), realpathSync(this.directoryPath));
  }

  private quarantineUnsafeEntry(filePath: string): void {
    const parsed = path.parse(filePath);
    const quarantinePath = path.join(
      parsed.dir,
      `${parsed.name}.corrupt-${Date.now()}-${randomUUID()}${parsed.ext}`
    );
    assertContained(this.directoryPath, quarantinePath);
    renameSync(filePath, quarantinePath);
  }
}

export function normalizeCaptureSegmentation(value: unknown): CaptureSegmentation {
  const raw = record(value, "Capture segmentation");
  if (raw.schemaVersion !== 1) {
    throw new Error(
      `Unsupported capture segmentation schemaVersion ${String(raw.schemaVersion)}.`
    );
  }

  const status = oneOf(raw.status, statuses, "capture segmentation status");
  const chunks = raw.chunks === undefined ? undefined : normalizeChunks(raw.chunks);
  const errorMessage = raw.errorMessage === undefined
    ? undefined
    : boundedText(
        raw.errorMessage,
        "capture segmentation error message",
        captureSegmentationLimits.maxErrorMessageLength
      );

  if (status === "ready" && !chunks) {
    throw new Error("A ready capture segmentation needs chunks.");
  }
  if (status !== "ready" && chunks) {
    throw new Error("Only a ready capture segmentation can include chunks.");
  }
  if ((status === "failed" || status === "unavailable") && !errorMessage) {
    throw new Error("A failed or unavailable capture segmentation needs an error message.");
  }
  if (status !== "failed" && status !== "unavailable" && errorMessage) {
    throw new Error(
      "Only a failed or unavailable capture segmentation can include an error message."
    );
  }

  return {
    schemaVersion: 1,
    captureID: strictIdentifier(raw.captureID, "capture segmentation captureID"),
    captureRevision: positiveInteger(
      raw.captureRevision,
      "capture segmentation captureRevision"
    ),
    status,
    ...(chunks ? { chunks } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    createdAt: isoString(raw.createdAt, "capture segmentation createdAt"),
    updatedAt: isoString(raw.updatedAt, "capture segmentation updatedAt")
  };
}

function normalizeChunks(value: unknown): CaptureSegmentationChunk[] {
  const rawChunks = array(value, "capture segmentation chunks");
  if (rawChunks.length < 1 || rawChunks.length > captureSegmentationLimits.maxChunks) {
    throw new Error(
      `A ready capture segmentation must have between 1 and ${captureSegmentationLimits.maxChunks} chunks.`
    );
  }

  const chunkIDs = new Set<string>();
  const sourceBlockIDs = new Set<string>();
  return rawChunks.map((item, chunkIndex): CaptureSegmentationChunk => {
    const rawChunk = record(item, `capture segmentation chunks[${chunkIndex}]`);
    const id = strictIdentifier(
      rawChunk.id,
      `capture segmentation chunks[${chunkIndex}].id`
    );
    if (chunkIDs.has(id)) {
      throw new Error(`Capture segmentation chunk id ${id} is duplicated.`);
    }
    chunkIDs.add(id);

    const rawSourceBlockIDs = array(
      rawChunk.sourceBlockIDs,
      `capture segmentation chunks[${chunkIndex}].sourceBlockIDs`
    );
    if (
      rawSourceBlockIDs.length < 1
      || rawSourceBlockIDs.length > captureSegmentationLimits.maxSourceBlockIDsPerChunk
    ) {
      throw new Error(
        `Capture segmentation chunks[${chunkIndex}] must have between 1 and ${captureSegmentationLimits.maxSourceBlockIDsPerChunk} source block IDs.`
      );
    }
    const normalizedSourceBlockIDs = rawSourceBlockIDs.map((sourceBlockID, sourceIndex) => {
      const normalized = strictIdentifier(
        sourceBlockID,
        `capture segmentation chunks[${chunkIndex}].sourceBlockIDs[${sourceIndex}]`
      );
      if (sourceBlockIDs.has(normalized)) {
        throw new Error(`Capture segmentation source block id ${normalized} is duplicated.`);
      }
      sourceBlockIDs.add(normalized);
      return normalized;
    });

    const title = rawChunk.title === undefined
      ? undefined
      : boundedText(
          rawChunk.title,
          `capture segmentation chunks[${chunkIndex}].title`,
          captureSegmentationLimits.maxChunkTitleLength
        );

    return {
      id,
      ...(title ? { title } : {}),
      sourceBlockIDs: normalizedSourceBlockIDs
    };
  });
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const text = nonEmptyExactString(value, label);
  if (text.length > maximum) {
    throw new Error(`${label} exceeds ${maximum} characters.`);
  }
  return text;
}

function isoString(value: unknown, label: string): string {
  const text = nonEmptyExactString(value, label);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return text;
}

function assertContained(parentPath: string, childPath: string): void {
  const relative = path.relative(parentPath, childPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error("Capture segmentation path escapes the active knowledge root.");
}
