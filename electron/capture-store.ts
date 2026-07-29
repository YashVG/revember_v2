import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type {
  CaptureOrigin,
  CaptureStatus,
  CaptureSummary,
  LearnerCapture,
  SaveCaptureInput
} from "../shared/types";
import {
  nonEmptyExactString,
  nonNegativeInteger,
  oneOf,
  positiveInteger,
  record,
  strictIdentifier
} from "./input-validation";

const captureFileName = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.json$/;
const editableStatuses = new Set<CaptureStatus>(["draft", "ready"]);
const storedStatuses = new Set<CaptureStatus>(["draft", "ready", "archived"]);

export class CaptureRevisionConflictError extends Error {
  readonly code = "CAPTURE_REVISION_CONFLICT" as const;

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Capture revision conflict: expected ${expectedRevision}, found ${actualRevision}. Refresh and retry.`);
    this.name = "CaptureRevisionConflictError";
  }
}

/**
 * CaptureStore methods are synchronous by design. Electron's main process runs
 * each operation to completion, which serializes capture mutations inside the
 * app without exposing a second writer or holding locks across UI work.
 */
export class CaptureStore {
  readonly directoryPath: string;
  private readonly rootPath: string;

  constructor(knowledgeRootPath: string) {
    this.rootPath = path.resolve(knowledgeRootPath);
    this.directoryPath = path.join(this.rootPath, "captures");
  }

  listSummaries(): CaptureSummary[] {
    if (!existsSync(this.directoryPath)) return [];
    this.assertSafeDirectory(false);
    const summaries: CaptureSummary[] = [];
    for (const entry of readdirSync(this.directoryPath, { withFileTypes: true })) {
      const match = captureFileName.exec(entry.name);
      if (!match) continue;
      const filePath = path.join(this.directoryPath, entry.name);
      if (!entry.isFile()) {
        if (entry.isSymbolicLink()) this.quarantineUnsafeEntry(filePath);
        continue;
      }
      try {
        summaries.push(toSummary(this.readCapture(match[1], true)));
      } catch {
        // readCapture quarantines invalid records. One bad private capture must
        // not prevent healthy captures or the rest of app state from loading.
      }
    }
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  get(rawID: unknown): LearnerCapture {
    return structuredClone(this.readCapture(strictIdentifier(rawID, "capture id"), true));
  }

  save(rawInput: unknown, now = new Date(), validateTopicID?: (topicID: string) => void): LearnerCapture {
    const input = parseSaveInput(rawInput);
    const timestamp = isoTimestamp(now, "Capture update timestamp");
    validateTopicID?.(input.topicID);
    this.assertSafeDirectory(true);

    if (input.id === undefined) {
      if (input.expectedRevision !== 0) {
        throw new CaptureRevisionConflictError(input.expectedRevision, 0);
      }
      const capture: LearnerCapture = {
        schemaVersion: 1,
        id: this.newCaptureID(),
        revision: 1,
        topicID: input.topicID,
        title: input.title,
        rawText: input.rawText,
        origin: "user",
        status: input.status,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.write(capture);
      return structuredClone(capture);
    }

    const existing = this.readCapture(input.id, true);
    assertExpectedRevision(input.expectedRevision, existing.revision);
    if (existing.status === "archived") throw new Error(`Capture ${existing.id} is archived and cannot be edited.`);
    const capture: LearnerCapture = {
      schemaVersion: 1,
      id: existing.id,
      revision: existing.revision + 1,
      topicID: input.topicID,
      title: input.title,
      rawText: input.rawText,
      origin: existing.origin,
      status: input.status,
      createdAt: existing.createdAt,
      updatedAt: timestamp
    };
    this.write(capture);
    return structuredClone(capture);
  }

  /**
   * Writes a completed local-AI draft. This is intentionally separate from
   * save(): renderer input can never claim to be AI-generated.
   */
  createOllamaGenerated(input: {
    topicID: string;
    title: string;
    rawText: string;
  }, now = new Date(), validateTopicID?: (topicID: string) => void): LearnerCapture {
    const topicID = strictIdentifier(input.topicID, "topicID");
    const title = nonEmptyExactString(input.title, "title");
    const rawText = nonEmptyExactString(input.rawText, "rawText");
    validateTopicID?.(topicID);
    const timestamp = isoTimestamp(now, "Capture creation timestamp");
    this.assertSafeDirectory(true);
    const capture: LearnerCapture = {
      schemaVersion: 1,
      id: this.newCaptureID(),
      revision: 1,
      topicID,
      title,
      rawText,
      origin: "ollama",
      status: "ready",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.write(capture);
    return structuredClone(capture);
  }

  archive(rawID: unknown, rawExpectedRevision: unknown, now = new Date()): LearnerCapture {
    const id = strictIdentifier(rawID, "capture id");
    const expectedRevision = nonNegativeInteger(rawExpectedRevision, "expectedRevision");
    const timestamp = isoTimestamp(now, "Capture archive timestamp");
    const existing = this.readCapture(id, true);
    assertExpectedRevision(expectedRevision, existing.revision);
    if (existing.status === "archived") throw new Error(`Capture ${id} is already archived.`);
    const capture: LearnerCapture = {
      ...existing,
      revision: existing.revision + 1,
      status: "archived",
      updatedAt: timestamp
    };
    this.write(capture);
    return structuredClone(capture);
  }

  private readCapture(id: string, quarantineInvalid: boolean): LearnerCapture {
    this.assertSafeDirectory(false);
    const filePath = this.filePath(id);
    if (!existsSync(filePath)) throw new Error(`Capture ${id} does not exist.`);
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      if (quarantineInvalid) this.quarantineUnsafeEntry(filePath);
      throw new Error(`Capture ${id} is a symbolic link and was not opened.`);
    }
    if (!stat.isFile()) throw new Error(`Capture ${id} is not a regular file.`);
    try {
      const capture = normalizeCapture(JSON.parse(readFileSync(filePath, "utf8")));
      if (capture.id !== id) throw new Error(`Capture id ${capture.id} must match its file name ${id}.`);
      return capture;
    } catch (error) {
      if (quarantineInvalid && existsSync(filePath)) this.quarantineUnsafeEntry(filePath);
      throw new Error(`Capture ${id} was unreadable and quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(capture: LearnerCapture): void {
    this.assertSafeDirectory(true);
    const filePath = this.filePath(capture.id);
    if (existsSync(filePath)) {
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Capture ${capture.id} is not a safe regular file.`);
    }
    const temporaryPath = path.join(this.directoryPath, `.${capture.id}.tmp-${process.pid}-${randomUUID()}`);
    try {
      writeFileSync(temporaryPath, JSON.stringify(capture, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      renameSync(temporaryPath, filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private newCaptureID(): string {
    for (;;) {
      const id = `capture-${randomUUID()}`;
      if (!existsSync(this.filePath(id))) return id;
    }
  }

  private filePath(id: string): string {
    const safe = strictIdentifier(id, "capture id");
    const candidate = path.join(this.directoryPath, `${safe}.json`);
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
      throw new Error("The captures path must be a real directory inside the active knowledge root.");
    }
    const actualRoot = realpathSync(this.rootPath);
    const actualDirectory = realpathSync(this.directoryPath);
    assertContained(actualRoot, actualDirectory);
  }

  private quarantineUnsafeEntry(filePath: string): void {
    const parsed = path.parse(filePath);
    const quarantinePath = path.join(parsed.dir, `${parsed.name}.corrupt-${Date.now()}-${randomUUID()}${parsed.ext}`);
    assertContained(this.directoryPath, quarantinePath);
    renameSync(filePath, quarantinePath);
  }
}

export function normalizeCapture(value: unknown): LearnerCapture {
  const raw = record(value, "Capture");
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported capture schemaVersion ${String(raw.schemaVersion)}.`);
  return {
    schemaVersion: 1,
    id: strictIdentifier(raw.id, "capture id"),
    revision: positiveInteger(raw.revision, "capture revision"),
    topicID: strictIdentifier(raw.topicID, "capture topicID"),
    title: nonEmptyExactString(raw.title, "capture title"),
    rawText: stringValue(raw.rawText, "capture rawText"),
    origin: normalizeOrigin(raw.origin),
    status: oneOf(raw.status, storedStatuses, "capture status"),
    createdAt: isoString(raw.createdAt, "capture createdAt"),
    updatedAt: isoString(raw.updatedAt, "capture updatedAt")
  };
}

function parseSaveInput(value: unknown): SaveCaptureInput {
  const raw = record(value, "Save capture input");
  return {
    ...(raw.id === undefined ? {} : { id: strictIdentifier(raw.id, "capture id") }),
    expectedRevision: nonNegativeInteger(raw.expectedRevision, "expectedRevision"),
    topicID: strictIdentifier(raw.topicID, "topicID"),
    title: nonEmptyExactString(raw.title, "title"),
    rawText: stringValue(raw.rawText, "rawText"),
    status: oneOf(raw.status, editableStatuses, "status") as SaveCaptureInput["status"]
  };
}

function toSummary(capture: LearnerCapture): CaptureSummary {
  return {
    id: capture.id,
    revision: capture.revision,
    topicID: capture.topicID,
    title: capture.title,
    origin: capture.origin,
    status: capture.status,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt
  };
}

function normalizeOrigin(value: unknown): CaptureOrigin {
  return value === undefined ? "user" : oneOf(value, new Set<CaptureOrigin>(["user", "ollama"]), "capture origin") as CaptureOrigin;
}

function assertExpectedRevision(expected: number, actual: number): void {
  if (expected !== actual) throw new CaptureRevisionConflictError(expected, actual);
}

function assertContained(parentPath: string, childPath: string): void {
  const relative = path.relative(parentPath, childPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error("Capture path escapes the active knowledge root.");
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function isoString(value: unknown, label: string): string {
  const text = nonEmptyExactString(value, label);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) throw new Error(`${label} must be an ISO timestamp.`);
  return text;
}

function isoTimestamp(value: Date, label: string): string {
  if (Number.isNaN(value.getTime())) throw new Error(`${label} is invalid.`);
  return value.toISOString();
}
