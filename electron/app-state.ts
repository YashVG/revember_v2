import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { FSWatcher } from "node:fs";
import type {
  AppSettings,
  AppSnapshot,
  ArchiveExamPlanInput,
  CardMutationResult,
  CaptureCheckpointInput,
  CaptureCheckpointResult,
  CaptureSummary,
  CommitReviewInput,
  CommitReviewResult,
  CreateCardInput,
  EditCardInput,
  KnowledgeTopic,
  LearnerCapture,
  PlannerMutationResult,
  PlannerRecord,
  ProgressRecord,
  RetireCardInput,
  ReviewEvent,
  SaveCaptureInput,
  UpsertExamPlanInput
} from "../shared/types";
import {
  applyReviewEvent,
  correctChoice,
  emptyProgress,
  normalizeProgress,
  normalizeTopic
} from "../shared/domain";
import { planExamReviews } from "../shared/planner";
import { createTopicCard, editTopicCard, retireTopicCard } from "./topic-authoring";
import { emptyPlanner, PlannerStore } from "./planner-store";
import { CaptureRevisionConflictError, CaptureStore } from "./capture-store";
import {
  NoteEnrichmentCoordinator,
  noteEnrichmentStorageFailureMessage
} from "./note-enrichment-coordinator";
import type { LocalNoteModel } from "./ollama-note-model";
import {
  booleanValue,
  nonEmptyExactString,
  nonNegativeInteger,
  oneOf,
  positiveInteger,
  record,
  strictIdentifier
} from "./input-validation";

interface StatePaths {
  settingsPath: string;
  bundledKnowledgeRoot: string;
  legacyProgressPath: string;
}

const reviewRatings = new Set<CommitReviewInput["rating"]>(["missed", "hard", "good", "easy"]);

export class RevemberState extends EventEmitter {
  private topics: KnowledgeTopic[] = [];
  private progress: ProgressRecord = emptyProgress();
  private planner: PlannerRecord = emptyPlanner();
  private settings: AppSettings;
  private errorMessage?: string;
  private settingsWarning?: string;
  private backgroundWarning?: string;
  private watchers: FSWatcher[] = [];
  private reloadTimer?: NodeJS.Timeout;
  private readonly noteEnrichment: NoteEnrichmentCoordinator;

  constructor(private readonly paths: StatePaths, noteModel?: LocalNoteModel) {
    super();
    this.noteEnrichment = new NoteEnrichmentCoordinator(noteModel, (message) => {
      this.backgroundWarning = message;
      this.broadcast();
    });
    this.settings = this.loadSettings();
    this.reloadFromDisk();
    this.startWatching();
  }

  get snapshot(): AppSnapshot {
    return structuredClone({
      topics: this.topics,
      progress: this.progress,
      planner: this.planner,
      settings: this.settings,
      errorMessage: this.errorMessage ?? this.backgroundWarning ?? this.settingsWarning,
      platform: process.platform
    });
  }

  reload(): AppSnapshot {
    this.refreshFromDiskAndWatch();
    this.broadcast();
    return this.snapshot;
  }

  setKnowledgeRoot(knowledgeRootPath: string): AppSnapshot {
    return this.switchKnowledgeRoot(path.resolve(expandHome(knowledgeRootPath)));
  }

  resetKnowledgeRoot(): AppSnapshot {
    return this.switchKnowledgeRoot(this.defaultKnowledgeRoot());
  }

  setNotificationsEnabled(rawEnabled: unknown): AppSnapshot {
    const enabled = booleanValue(rawEnabled, "notificationsEnabled");
    this.settings.notificationsEnabled = enabled;
    this.saveSettings();
    this.broadcast();
    return this.snapshot;
  }

  commitReview(rawInput: unknown): CommitReviewResult {
    const input = normalizeCommitReviewInput(rawInput);
    const topic = this.topics.find((candidate) => candidate.id === input.topicID);
    const question = topic?.questions.find((candidate) => candidate.id === input.questionID && !candidate.retiredAt);
    if (!topic || !question || question.revision !== input.questionRevision) {
      throw new Error("This check changed while it was open. Start a fresh review before saving evidence.");
    }
    const choice = question.choices.find((candidate) => candidate.id === input.choiceID);
    if (!choice) throw new Error("The selected answer no longer exists.");
    const reviewedAt = input.reviewedAt ?? new Date().toISOString();
    const answer = correctChoice(question);
    const event: ReviewEvent = {
      id: input.eventID.toLowerCase(),
      topicID: topic.id,
      questionID: question.id,
      questionRevision: question.revision,
      questionKind: question.kind,
      transferLevel: question.transferLevel,
      questionPrompt: question.prompt,
      choiceID: choice.id,
      selectedChoiceText: choice.text,
      correctChoiceID: answer?.id,
      correctChoiceText: answer?.text,
      isCorrect: choice.isCorrect,
      rating: choice.isCorrect ? input.rating : "missed",
      conceptIDs: question.conceptIDs,
      gapTags: question.gapTags,
      misconceptionIDs: choice.misconceptionID ? [choice.misconceptionID] : [],
      sourceRefs: question.sourceRefs,
      reviewedAt
    };
    const existing = this.progress.reviewEvents.find((candidate) => candidate.id.toLowerCase() === event.id);
    const candidate = structuredClone(this.progress);
    const cardState = applyReviewEvent(candidate, event);
    if (!existing) {
      this.writeProgress(candidate);
      this.progress = candidate;
    }
    this.errorMessage = undefined;
    this.broadcast();
    return { snapshot: this.snapshot, event, cardState, wasInserted: !existing };
  }

  captureCheckpoint(input: CaptureCheckpointInput): CaptureCheckpointResult {
    const summary = input.summary.trim();
    if (!summary) throw new Error("A learning checkpoint needs a short summary.");
    const topic = input.topicID ? this.topics.find((candidate) => candidate.id === input.topicID) : undefined;
    if (input.topicID && !topic) throw new Error("The selected topic is no longer in this knowledge store.");
    const capturedAt = new Date();
    const id = `checkpoint-${capturedAt.toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
    const title = topic ? `${topic.title} checkpoint` : "Learning checkpoint";
    const openQuestion = input.openQuestion?.trim();
    const record = {
      schemaVersion: 1,
      id,
      revision: 1,
      capturedAt: capturedAt.toISOString(),
      title,
      summary,
      ...(topic ? { topicID: topic.id } : {}),
      confirmedConceptIDs: [],
      misconceptionIDs: [],
      openQuestions: openQuestion ? [openQuestion] : [],
      sourceRefs: [],
      notesMarkdown: `## ${title}\n\n${summary}`
    };
    const filePath = path.join(this.settings.knowledgeRootPath, "sessions", `${id}.json`);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeJson(filePath, record);
    return { snapshot: this.snapshot, filePath };
  }

  listCaptureSummaries(): CaptureSummary[] {
    return new CaptureStore(this.settings.knowledgeRootPath).listSummaries();
  }

  getCapture(id: string): LearnerCapture {
    return new CaptureStore(this.settings.knowledgeRootPath).get(id);
  }

  saveCapture(input: SaveCaptureInput): LearnerCapture {
    return new CaptureStore(this.settings.knowledgeRootPath).save(input, new Date(), (topicID) => {
      if (!this.topics.some((topic) => topic.id === topicID)) {
        throw new Error(`Capture references missing topic ${topicID}.`);
      }
    });
  }

  finishCapture(rawID: unknown, rawExpectedRevision: unknown): LearnerCapture {
    const id = strictIdentifier(rawID, "capture id");
    const expectedRevision = nonNegativeInteger(rawExpectedRevision, "expectedRevision");
    const store = new CaptureStore(this.settings.knowledgeRootPath);
    const current = store.get(id);
    if (current.revision !== expectedRevision) {
      throw new CaptureRevisionConflictError(expectedRevision, current.revision);
    }
    if (current.status === "archived") throw new Error("Archived notes cannot be finished.");
    if (!current.rawText.trim()) throw new Error("Add note text before finishing this lecture.");

    const capture = current.status === "ready"
      ? current
      : store.save({
        id: current.id,
        expectedRevision: current.revision,
        topicID: current.topicID,
        title: current.title,
        rawText: current.rawText,
        concisePoints: current.concisePoints,
        status: "ready"
      }, new Date(), (topicID) => {
        if (!this.topics.some((topic) => topic.id === topicID)) {
          throw new Error(`Capture references missing topic ${topicID}.`);
        }
      });
    try {
      this.noteEnrichment.enqueue(capture, this.settings.knowledgeRootPath);
      this.backgroundWarning = undefined;
    } catch (error) {
      // The learner-authored revision is already durably Ready. Queue storage
      // is best-effort and can be retried after the knowledge folder is fixed.
      this.backgroundWarning = noteEnrichmentStorageFailureMessage(error);
      this.broadcast();
    }
    return capture;
  }

  archiveCapture(id: string, expectedRevision: number): LearnerCapture {
    return new CaptureStore(this.settings.knowledgeRootPath).archive(id, expectedRevision);
  }

  getCaptureEnrichment(captureID: string, captureRevision: number) {
    const enrichment = this.noteEnrichment.get(captureID, captureRevision, this.settings.knowledgeRootPath);
    if (enrichment && enrichment.status !== "queued" && enrichment.status !== "running") return enrichment;
    const capture = this.getCapture(captureID);
    if (capture.revision !== captureRevision) return enrichment;
    if (capture.status !== "ready") return enrichment;
    const scheduled = enrichment
      ? this.noteEnrichment.resume(capture, this.settings.knowledgeRootPath)
      : this.noteEnrichment.enqueue(capture, this.settings.knowledgeRootPath);
    if (this.backgroundWarning) {
      this.backgroundWarning = undefined;
      this.broadcast();
    }
    return scheduled;
  }

  retryCaptureEnrichment(captureID: string, captureRevision: number) {
    const capture = this.getCapture(captureID);
    if (capture.revision !== captureRevision) {
      throw new Error("This note changed before its study response could be retried. Open the current revision instead.");
    }
    if (capture.status !== "ready") throw new Error("Finish this lecture before requesting a local study response.");
    const enrichment = this.noteEnrichment.retry(capture, this.settings.knowledgeRootPath);
    this.backgroundWarning = undefined;
    this.broadcast();
    return enrichment;
  }

  async createCard(input: CreateCardInput): Promise<CardMutationResult> {
    const result = await createTopicCard(this.settings.knowledgeRootPath, input);
    return this.finishCardMutation(input.topicID, input.card.id, result.topic);
  }

  async editCard(input: EditCardInput): Promise<CardMutationResult> {
    const result = await editTopicCard(this.settings.knowledgeRootPath, input);
    return this.finishCardMutation(input.topicID, input.questionID, result.topic);
  }

  async retireCard(input: RetireCardInput): Promise<CardMutationResult> {
    const result = await retireTopicCard(this.settings.knowledgeRootPath, input);
    return this.finishCardMutation(input.topicID, input.questionID, result.topic);
  }

  upsertExamPlan(input: UpsertExamPlanInput): PlannerMutationResult {
    const progressBefore = this.progressFingerprint();
    const store = new PlannerStore(this.settings.progressPath);
    const result = store.upsert(input, new Date(), (plan) => {
      const knownTopicIDs = new Set(this.topics.map((topic) => topic.id));
      for (const topicID of plan.topicIDs) {
        if (!knownTopicIDs.has(topicID)) throw new Error(`Exam plan references missing topic ${topicID}.`);
      }
      planExamReviews(plan, { topics: this.topics, progress: this.progress });
      this.assertProgressUnchanged(progressBefore);
    });
    this.planner = result.record;
    this.errorMessage = undefined;
    this.broadcast();
    return { snapshot: this.snapshot, plan: result.plan };
  }

  archiveExamPlan(input: ArchiveExamPlanInput): PlannerMutationResult {
    const progressBefore = this.progressFingerprint();
    const result = new PlannerStore(this.settings.progressPath).archive(input);
    this.planner = result.record;
    this.assertProgressUnchanged(progressBefore);
    this.errorMessage = undefined;
    this.broadcast();
    return { snapshot: this.snapshot, plan: result.plan };
  }

  dispose(): void {
    this.noteEnrichment.dispose();
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  private loadSettings(): AppSettings {
    let stored: Partial<AppSettings> = {};
    if (existsSync(this.paths.settingsPath)) {
      try {
        stored = normalizeStoredSettings(JSON.parse(readFileSync(this.paths.settingsPath, "utf8")));
      } catch (error) {
        this.settingsWarning = this.quarantineInvalidSettings(error);
      }
    }
    const configuredKnowledgeRoot = process.env.REVEMBER_KNOWLEDGE_ROOT
      ? path.resolve(expandHome(process.env.REVEMBER_KNOWLEDGE_ROOT))
      : undefined;
    const configuredProgressPath = process.env.REVEMBER_PROGRESS_PATH
      ? path.resolve(expandHome(process.env.REVEMBER_PROGRESS_PATH))
      : undefined;
    return {
      knowledgeRootPath: configuredKnowledgeRoot ?? stored.knowledgeRootPath ?? this.legacyKnowledgeRoot() ?? this.defaultKnowledgeRoot(),
      progressPath: configuredProgressPath ?? stored.progressPath ?? this.paths.legacyProgressPath,
      notificationsEnabled: stored.notificationsEnabled ?? false
    };
  }

  private quarantineInvalidSettings(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      const quarantine = artifactPath(this.paths.settingsPath, "corrupt");
      renameSync(this.paths.settingsPath, quarantine);
      return `Settings were invalid and moved to ${path.basename(quarantine)}. Revember is using safe defaults: ${detail}`;
    } catch {
      return `Settings were invalid. Revember is using safe defaults for this session: ${detail}`;
    }
  }

  private progressFingerprint(): string {
    return JSON.stringify(this.progress);
  }

  private assertProgressUnchanged(before: string): void {
    if (this.progressFingerprint() !== before) throw new Error("Planner operations cannot mutate review progress.");
  }

  private defaultKnowledgeRoot(): string {
    const documentsRoot = path.join(homedir(), "Documents", "RevemberKnowledge");
    if (!existsSync(documentsRoot) && existsSync(this.paths.bundledKnowledgeRoot)) {
      mkdirSync(path.dirname(documentsRoot), { recursive: true });
      cpSync(this.paths.bundledKnowledgeRoot, documentsRoot, { recursive: true });
    }
    return existsSync(documentsRoot) ? documentsRoot : this.paths.bundledKnowledgeRoot;
  }

  private legacyKnowledgeRoot(): string | undefined {
    if (process.platform !== "darwin") return undefined;
    try {
      const value = execFileSync("/usr/bin/defaults", ["read", "com.yashvg.Revember", "knowledgeRootPath"], {
        encoding: "utf8",
        timeout: 1_500,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      return value && existsSync(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private saveSettings(settings = this.settings): void {
    mkdirSync(path.dirname(this.paths.settingsPath), { recursive: true });
    writeJson(this.paths.settingsPath, settings);
  }

  private reloadFromDisk(): void {
    try {
      const loaded = this.readDiskState(this.settings);
      this.topics = loaded.topics;
      this.progress = loaded.progress;
      this.planner = loaded.planner;
      this.errorMessage = [this.settingsWarning, loaded.warning].filter(Boolean).join(" ") || undefined;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  private switchKnowledgeRoot(knowledgeRootPath: string): AppSnapshot {
    const candidateSettings = { ...this.settings, knowledgeRootPath };
    const loaded = this.readDiskState(candidateSettings);
    this.saveSettings(candidateSettings);
    this.settings = candidateSettings;
    this.topics = loaded.topics;
    this.progress = loaded.progress;
    this.planner = loaded.planner;
    this.errorMessage = loaded.warning;
    this.backgroundWarning = undefined;
    this.startWatching();
    this.broadcast();
    return this.snapshot;
  }

  private readDiskState(settings: AppSettings): {
    topics: KnowledgeTopic[];
    progress: ProgressRecord;
    planner: PlannerRecord;
    warning?: string;
  } {
    const topics = this.loadTopics(settings.knowledgeRootPath);
    const progress = this.loadProgress(settings.progressPath);
    const planner = new PlannerStore(settings.progressPath).load();
    return { topics, progress, planner: planner.record, warning: planner.warning };
  }

  private finishCardMutation(topicID: string, questionID: string, rawTopic: Record<string, unknown>): CardMutationResult {
    const topic = normalizeTopic(rawTopic);
    const question = topic.questions.find((candidate) => candidate.id === questionID);
    if (!question) throw new Error(`Saved question ${questionID} could not be reloaded.`);
    this.topics = this.topics.map((candidate) => candidate.id === topicID ? topic : candidate);
    this.errorMessage = undefined;
    this.startWatching();
    this.broadcast();
    return { snapshot: this.snapshot, topic, question };
  }

  private loadTopics(knowledgeRootPath = this.settings.knowledgeRootPath): KnowledgeTopic[] {
    const topicsDirectory = path.join(knowledgeRootPath, "topics");
    if (!existsSync(topicsDirectory)) return [];
    return readdirSync(topicsDirectory)
      .filter((fileName) => fileName.toLowerCase().endsWith(".json") && !fileName.startsWith("."))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((fileName) => {
        const topic = normalizeTopic(JSON.parse(readFileSync(path.join(topicsDirectory, fileName), "utf8")));
        if (topic.id !== path.basename(fileName, ".json")) throw new Error(`${fileName}: topic id must match its file name.`);
        return topic;
      });
  }

  private loadProgress(progressPath = this.settings.progressPath): ProgressRecord {
    if (!existsSync(progressPath)) return emptyProgress();
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(progressPath, "utf8"));
    } catch (error) {
      const quarantine = artifactPath(progressPath, "corrupt");
      renameSync(progressPath, quarantine);
      throw new Error(`Progress was unreadable and moved to ${path.basename(quarantine)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let progress: ProgressRecord;
    try {
      progress = normalizeProgress(raw);
    } catch (error) {
      const quarantine = artifactPath(progressPath, "corrupt");
      renameSync(progressPath, quarantine);
      throw new Error(`Progress was invalid and moved to ${path.basename(quarantine)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (progress.schemaVersion < 2) {
      const backup = artifactPath(progressPath, "pre-v2-backup");
      copyFileSync(progressPath, backup);
      progress.schemaVersion = 2;
      this.writeProgress(progress, progressPath);
    }
    return progress;
  }

  private writeProgress(progress: ProgressRecord, progressPath = this.settings.progressPath): void {
    mkdirSync(path.dirname(progressPath), { recursive: true });
    writeJson(progressPath, progress);
  }

  private refreshFromDiskAndWatch(): void {
    this.reloadFromDisk();
    this.startWatching();
  }

  private startWatching(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const directory of [this.settings.knowledgeRootPath, path.join(this.settings.knowledgeRootPath, "topics")]) {
      if (!existsSync(directory)) continue;
      try {
        this.watchers.push(watch(directory, () => {
          if (this.reloadTimer) clearTimeout(this.reloadTimer);
          this.reloadTimer = setTimeout(() => {
            this.refreshFromDiskAndWatch();
            this.broadcast();
          }, 250);
        }));
      } catch {
        // Manual reload remains available if the OS cannot watch this location.
      }
    }
  }

  private broadcast(): void {
    this.emit("snapshot", this.snapshot);
  }
}

function normalizeCommitReviewInput(rawInput: unknown): CommitReviewInput {
  const input = record(rawInput, "review input");
  const reviewedAt = optionalCanonicalTimestamp(input.reviewedAt, "reviewedAt");
  return {
    topicID: strictIdentifier(input.topicID, "topicID"),
    questionID: nonEmptyExactString(input.questionID, "questionID"),
    questionRevision: positiveInteger(input.questionRevision, "questionRevision"),
    choiceID: nonEmptyExactString(input.choiceID, "choiceID"),
    rating: oneOf(input.rating, reviewRatings, "rating"),
    eventID: strictIdentifier(input.eventID, "eventID"),
    ...(reviewedAt ? { reviewedAt } : {})
  };
}

function optionalCanonicalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function atomicWrite(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function writeJson(filePath: string, value: unknown): void {
  atomicWrite(filePath, JSON.stringify(value, null, 2) + "\n");
}

function normalizeStoredSettings(value: unknown): Partial<AppSettings> {
  const raw = record(value, "Settings");
  return {
    ...(raw.knowledgeRootPath === undefined ? {} : {
      knowledgeRootPath: path.resolve(expandHome(nonEmptyExactString(raw.knowledgeRootPath, "settings knowledgeRootPath")))
    }),
    ...(raw.progressPath === undefined ? {} : {
      progressPath: path.resolve(expandHome(nonEmptyExactString(raw.progressPath, "settings progressPath")))
    }),
    ...(raw.notificationsEnabled === undefined ? {} : {
      notificationsEnabled: booleanValue(raw.notificationsEnabled, "settings notificationsEnabled")
    })
  };
}

function artifactPath(filePath: string, kind: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${kind}-${Date.now()}${parsed.ext}`);
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  return input.startsWith("~/") ? path.join(homedir(), input.slice(2)) : input;
}
