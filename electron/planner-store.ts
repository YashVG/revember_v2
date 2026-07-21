import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ArchiveExamPlanInput,
  PlannerRecord,
  StoredExamPlan,
  UpsertExamPlanInput
} from "../shared/types";
import { validateTimeZone } from "../shared/planner";

const safeID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class PlannerRevisionConflictError extends Error {
  readonly code = "PLANNER_REVISION_CONFLICT" as const;

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Planner revision conflict: expected ${expectedRevision}, found ${actualRevision}. Refresh and retry.`);
    this.name = "PlannerRevisionConflictError";
  }
}

export interface PlannerLoadResult {
  record: PlannerRecord;
  warning?: string;
  quarantinePath?: string;
}

export interface PlannerWriteResult {
  record: PlannerRecord;
  plan: StoredExamPlan;
}

export function emptyPlanner(): PlannerRecord {
  return { schemaVersion: 1, revision: 0, plans: [] };
}

export class PlannerStore {
  readonly filePath: string;

  constructor(progressPath: string) {
    this.filePath = path.join(path.dirname(path.resolve(progressPath)), "planner.json");
  }

  load(): PlannerLoadResult {
    if (!existsSync(this.filePath)) return { record: emptyPlanner() };
    try {
      return { record: normalizePlanner(JSON.parse(readFileSync(this.filePath, "utf8"))) };
    } catch (error) {
      const quarantinePath = artifactPath(this.filePath, "corrupt");
      renameSync(this.filePath, quarantinePath);
      return {
        record: emptyPlanner(),
        quarantinePath,
        warning: `Planner data was unreadable and moved to ${path.basename(quarantinePath)}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  upsert(rawInput: unknown, now = new Date(), validate?: (plan: UpsertExamPlanInput["plan"]) => void): PlannerWriteResult {
    const input = parseUpsertInput(rawInput);
    assertDate(now, "Planner update timestamp");
    validate?.(input.plan);
    const loaded = this.load();
    assertExpectedRevision(input.expectedPlannerRevision, loaded.record.revision);
    const timestamp = now.toISOString();
    const existing = input.planID ? loaded.record.plans.find((plan) => plan.id === input.planID) : undefined;
    if (input.planID && !existing) throw new Error(`Exam plan ${input.planID} does not exist.`);
    if (existing?.archivedAt) throw new Error(`Exam plan ${existing.id} is archived and cannot be edited.`);
    const plan: StoredExamPlan = {
      id: existing?.id ?? `plan-${randomUUID()}`,
      ...input.plan,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    const plans = existing
      ? loaded.record.plans.map((candidate) => candidate.id === existing.id ? plan : candidate)
      : [...loaded.record.plans, plan];
    const record: PlannerRecord = { schemaVersion: 1, revision: loaded.record.revision + 1, plans };
    this.write(record);
    return { record, plan };
  }

  archive(rawInput: unknown, now = new Date()): PlannerWriteResult {
    const input = parseArchiveInput(rawInput);
    assertDate(now, "Planner archive timestamp");
    const loaded = this.load();
    assertExpectedRevision(input.expectedPlannerRevision, loaded.record.revision);
    const existing = loaded.record.plans.find((plan) => plan.id === input.planID);
    if (!existing) throw new Error(`Exam plan ${input.planID} does not exist.`);
    if (existing.archivedAt) throw new Error(`Exam plan ${input.planID} is already archived.`);
    const timestamp = now.toISOString();
    const plan = { ...existing, updatedAt: timestamp, archivedAt: timestamp };
    const record: PlannerRecord = {
      schemaVersion: 1,
      revision: loaded.record.revision + 1,
      plans: loaded.record.plans.map((candidate) => candidate.id === input.planID ? plan : candidate)
    };
    this.write(record);
    return { record, plan };
  }

  private write(record: PlannerRecord): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

export function normalizePlanner(value: unknown): PlannerRecord {
  const raw = record(value, "Planner data");
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported planner schemaVersion ${String(raw.schemaVersion)}.`);
  const revision = nonNegativeInteger(raw.revision, "planner revision");
  const plans = array(raw.plans, "planner plans").map((plan, index) => normalizeStoredPlan(plan, index));
  const ids = plans.map((plan) => plan.id);
  if (new Set(ids).size !== ids.length) throw new Error("Planner plan IDs must be unique.");
  return { schemaVersion: 1, revision, plans };
}

function normalizeStoredPlan(value: unknown, index: number): StoredExamPlan {
  const raw = record(value, `Plan ${index + 1}`);
  const plan = parseExamPlan(raw);
  return {
    id: identifier(raw.id, `plan ${index + 1} id`),
    ...plan,
    createdAt: isoDate(raw.createdAt, `plan ${index + 1} createdAt`),
    updatedAt: isoDate(raw.updatedAt, `plan ${index + 1} updatedAt`),
    ...(raw.archivedAt === undefined ? {} : { archivedAt: isoDate(raw.archivedAt, `plan ${index + 1} archivedAt`) })
  };
}

function parseUpsertInput(value: unknown): UpsertExamPlanInput {
  const raw = record(value, "Upsert exam plan input");
  return {
    expectedPlannerRevision: nonNegativeInteger(raw.expectedPlannerRevision, "expectedPlannerRevision"),
    ...(raw.planID === undefined ? {} : { planID: identifier(raw.planID, "planID") }),
    plan: parseExamPlan(record(raw.plan, "Exam plan"))
  };
}

function parseArchiveInput(value: unknown): ArchiveExamPlanInput {
  const raw = record(value, "Archive exam plan input");
  return {
    expectedPlannerRevision: nonNegativeInteger(raw.expectedPlannerRevision, "expectedPlannerRevision"),
    planID: identifier(raw.planID, "planID")
  };
}

function parseExamPlan(raw: Record<string, unknown>): UpsertExamPlanInput["plan"] {
  const topicIDs = stringIDs(raw.topicIDs, "topicIDs");
  if (!topicIDs.length) throw new Error("topicIDs cannot be empty.");
  const targetDate = plannerDate(raw.targetDate, "targetDate");
  const timeZone = nonEmptyString(raw.timeZone, "timeZone");
  validateTimeZone(timeZone);
  return {
    examName: nonEmptyString(raw.examName, "examName"),
    targetDate,
    topicIDs,
    sessionCount: positiveInteger(raw.sessionCount, "sessionCount"),
    timeZone
  };
}

function plannerDate(value: unknown, label: string): string {
  const date = nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return date;
}

function assertExpectedRevision(expected: number, actual: number): void {
  if (expected !== actual) throw new PlannerRevisionConflictError(expected, actual);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const id = nonEmptyString(value, label);
  if (!safeID.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function stringIDs(value: unknown, label: string): string[] {
  const values = array(value, label).map((item, index) => identifier(item, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${label} cannot contain duplicates.`);
  return values;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

function isoDate(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  assertDate(new Date(text), label);
  return text;
}

function assertDate(date: Date, label: string): void {
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
}

function artifactPath(filePath: string, kind: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${kind}-${Date.now()}-${randomUUID()}${parsed.ext}`);
}
