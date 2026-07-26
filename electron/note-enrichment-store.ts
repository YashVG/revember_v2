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
import type {
  CaptureEnrichment,
  CaptureEnrichmentResult,
  CaptureEnrichmentStatus,
  CaptureEnrichmentTakeaway
} from "../shared/types";
import { array, nonEmptyExactString, oneOf, positiveInteger, record, strictIdentifier } from "./input-validation";

const statuses = new Set<CaptureEnrichmentStatus>(["queued", "running", "ready", "failed", "unavailable"]);
export const captureEnrichmentLimits = Object.freeze({
  minTakeaways: 1,
  maxSummaryLength: 2_000,
  maxTakeaways: 4,
  maxTakeawayLength: 600,
  maxQuestions: 3,
  maxQuestionLength: 500
});

/** Stores model output independently so a failed request can never damage a note. */
export class NoteEnrichmentStore {
  readonly directoryPath: string;
  private readonly rootPath: string;

  constructor(knowledgeRootPath: string) {
    this.rootPath = path.resolve(knowledgeRootPath);
    this.directoryPath = path.join(this.rootPath, "capture-enrichments");
  }

  get(rawCaptureID: unknown, rawRevision: unknown): CaptureEnrichment | undefined {
    const captureID = strictIdentifier(rawCaptureID, "capture id");
    const captureRevision = positiveInteger(rawRevision, "capture revision");
    if (!existsSync(this.directoryPath)) return undefined;
    this.assertSafeDirectory(false);
    const filePath = this.filePath(captureID, captureRevision);
    if (!existsSync(filePath)) return undefined;
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      this.quarantineUnsafeEntry(filePath);
      throw new Error(`Capture enrichment ${captureID} revision ${captureRevision} is not a safe regular file.`);
    }
    try {
      const enrichment = normalizeCaptureEnrichment(JSON.parse(readFileSync(filePath, "utf8")));
      if (enrichment.captureID !== captureID || enrichment.captureRevision !== captureRevision) {
        throw new Error("Capture enrichment identity must match its file name.");
      }
      return structuredClone(enrichment);
    } catch (error) {
      if (existsSync(filePath)) this.quarantineUnsafeEntry(filePath);
      throw new Error(`Capture enrichment ${captureID} revision ${captureRevision} was unreadable and quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  write(value: CaptureEnrichment): CaptureEnrichment {
    const enrichment = normalizeCaptureEnrichment(value);
    this.assertSafeDirectory(true);
    const filePath = this.filePath(enrichment.captureID, enrichment.captureRevision);
    if (existsSync(filePath)) {
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Capture enrichment ${enrichment.captureID} revision ${enrichment.captureRevision} is not a safe regular file.`);
      }
    }
    const temporaryPath = path.join(this.directoryPath, `.${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`);
    try {
      writeFileSync(temporaryPath, JSON.stringify(enrichment, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      renameSync(temporaryPath, filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
    return structuredClone(enrichment);
  }

  private filePath(captureID: string, captureRevision: number): string {
    const candidate = path.join(this.directoryPath, `${strictIdentifier(captureID, "capture id")}-${positiveInteger(captureRevision, "capture revision")}.json`);
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
      throw new Error("The capture enrichments path must be a real directory inside the active knowledge root.");
    }
    assertContained(realpathSync(this.rootPath), realpathSync(this.directoryPath));
  }

  private quarantineUnsafeEntry(filePath: string): void {
    const parsed = path.parse(filePath);
    const quarantinePath = path.join(parsed.dir, `${parsed.name}.corrupt-${Date.now()}-${randomUUID()}${parsed.ext}`);
    assertContained(this.directoryPath, quarantinePath);
    renameSync(filePath, quarantinePath);
  }
}

export function normalizeCaptureEnrichment(value: unknown): CaptureEnrichment {
  const raw = record(value, "Capture enrichment");
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported capture enrichment schemaVersion ${String(raw.schemaVersion)}.`);
  const status = oneOf(raw.status, statuses, "capture enrichment status");
  const result = raw.result === undefined ? undefined : normalizeResult(raw.result);
  const errorMessage = raw.errorMessage === undefined
    ? undefined
    : boundedText(raw.errorMessage, "capture enrichment error message", captureEnrichmentLimits.maxQuestionLength);

  if (status === "ready" && !result) throw new Error("A ready capture enrichment needs a result.");
  if (status !== "ready" && result) throw new Error("Only a ready capture enrichment can include a result.");
  if ((status === "failed" || status === "unavailable") && !errorMessage) {
    throw new Error("A failed capture enrichment needs an error message.");
  }
  if (status !== "failed" && status !== "unavailable" && errorMessage) {
    throw new Error("Only a failed capture enrichment can include an error message.");
  }

  return {
    schemaVersion: 1,
    captureID: strictIdentifier(raw.captureID, "capture enrichment captureID"),
    captureRevision: positiveInteger(raw.captureRevision, "capture enrichment captureRevision"),
    status,
    ...(result ? { result } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    createdAt: isoString(raw.createdAt, "capture enrichment createdAt"),
    updatedAt: isoString(raw.updatedAt, "capture enrichment updatedAt")
  };
}

function normalizeResult(value: unknown): CaptureEnrichmentResult {
  const raw = record(value, "capture enrichment result");
  const takeaways = array(raw.takeaways, "capture enrichment takeaways").map((item, index): CaptureEnrichmentTakeaway => {
    const takeaway = record(item, `capture enrichment takeaways[${index}]`);
    return {
      text: boundedText(takeaway.text, `capture enrichment takeaways[${index}].text`, captureEnrichmentLimits.maxTakeawayLength),
      evidence: boundedText(takeaway.evidence, `capture enrichment takeaways[${index}].evidence`, captureEnrichmentLimits.maxTakeawayLength)
    };
  });
  const openQuestions = array(raw.openQuestions, "capture enrichment openQuestions")
    .map((question, index) => boundedText(question, `capture enrichment openQuestions[${index}]`, captureEnrichmentLimits.maxQuestionLength));
  if (
    takeaways.length < captureEnrichmentLimits.minTakeaways
    || takeaways.length > captureEnrichmentLimits.maxTakeaways
  ) {
    throw new Error(
      `A ready capture enrichment must have between ${captureEnrichmentLimits.minTakeaways} and ${captureEnrichmentLimits.maxTakeaways} takeaways.`
    );
  }
  if (openQuestions.length > captureEnrichmentLimits.maxQuestions) {
    throw new Error(`A capture enrichment can have at most ${captureEnrichmentLimits.maxQuestions} open questions.`);
  }
  return {
    summary: boundedText(raw.summary, "capture enrichment summary", captureEnrichmentLimits.maxSummaryLength),
    takeaways,
    openQuestions
  };
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const text = nonEmptyExactString(value, label);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
  return text;
}

function isoString(value: unknown, label: string): string {
  const text = nonEmptyExactString(value, label);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) throw new Error(`${label} must be an ISO timestamp.`);
  return text;
}

function assertContained(parentPath: string, childPath: string): void {
  const relative = path.relative(parentPath, childPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error("Capture enrichment path escapes the active knowledge root.");
}
