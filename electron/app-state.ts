import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
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
  CloudVaultArchive,
  CommitReviewInput,
  CommitReviewResult,
  CreateCardInput,
  CreateTopicInput,
  CreateTopicResult,
  EditCardInput,
  GenerateDistractorsInput,
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
  normalizeTopic,
  validateTopic
} from "../shared/domain";
import {
  inferReviewRating,
  REVIEW_RESPONSE_TIME_CAP_MS
} from "../shared/review-timing";
import { planExamReviews } from "../shared/planner";
import { createTopicCard, editTopicCard, retireTopicCard } from "./topic-authoring";
import { emptyPlanner, normalizePlanner, PlannerStore } from "./planner-store";
import { CaptureRevisionConflictError, CaptureStore } from "./capture-store";
import {
  NoteSegmentationCoordinator,
  noteSegmentationStorageFailureMessage
} from "./note-segmentation-coordinator";
import { OllamaNoteModel, type LocalNoteModel } from "./ollama-note-model";
import {
  booleanValue,
  nonEmptyExactString,
  nonNegativeInteger,
  oneOf,
  positiveInteger,
  record,
  strictIdentifier
} from "./input-validation";
import { assertPathContained, writeJsonAtomically, writeTextAtomically } from "./persistence";

interface StatePaths {
  settingsPath: string;
  bundledKnowledgeRoot: string;
  personalKnowledgeRoot?: string;
  legacyProgressPath: string;
}

const reviewRatings = new Set<CommitReviewInput["rating"]>(["missed", "hard", "good", "easy"]);
const cloudVaultDirectories = ["topics", "notes", "captures", "capture-enrichments", "capture-segmentations", "sessions"] as const;
const cloudVaultMaxBytes = 7_500_000;

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
  private readonly noteSegmentation: NoteSegmentationCoordinator;
  private readonly localNoteModel: LocalNoteModel;

  constructor(private readonly paths: StatePaths, noteModel: LocalNoteModel = new OllamaNoteModel()) {
    super();
    this.localNoteModel = noteModel;
    this.noteSegmentation = new NoteSegmentationCoordinator(this.localNoteModel, (message) => {
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

  exportCloudVault(): CloudVaultArchive {
    const archive: CloudVaultArchive = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      files: readCloudVaultFiles(this.settings.knowledgeRootPath),
      progress: structuredClone(this.progress),
      planner: structuredClone(this.planner)
    };
    if (Buffer.byteLength(JSON.stringify(archive), "utf8") > cloudVaultMaxBytes) {
      throw new Error("This vault is too large for a single cloud snapshot. Large attachments are not syncable yet.");
    }
    return archive;
  }

  importCloudVault(rawArchive: unknown): AppSnapshot {
    const archive = normalizeCloudVaultArchive(rawArchive);
    const root = this.settings.knowledgeRootPath;
    const backupRoot = path.join(root, ".revember-cloud-backups", `${Date.now()}-${randomUUID()}`);
    mkdirSync(backupRoot, { recursive: true });
    for (const directory of cloudVaultDirectories) {
      const source = path.join(root, directory);
      if (existsSync(source)) cpSync(source, path.join(backupRoot, directory), { recursive: true });
    }
    if (existsSync(this.settings.progressPath)) copyFileSync(this.settings.progressPath, path.join(backupRoot, "progress.json"));
    const plannerPath = new PlannerStore(this.settings.progressPath).filePath;
    if (existsSync(plannerPath)) copyFileSync(plannerPath, path.join(backupRoot, "planner.json"));

    for (const directory of cloudVaultDirectories) {
      rmSync(path.join(root, directory), { recursive: true, force: true });
    }
    for (const [relativePath, contents] of Object.entries(archive.files)) {
      const destination = path.resolve(root, relativePath);
      assertPathContained(root, destination, "Cloud vault contains an unsafe file path.");
      mkdirSync(path.dirname(destination), { recursive: true });
      writeTextAtomically(destination, contents);
    }
    this.writeProgress(archive.progress);
    writeJsonAtomically(plannerPath, archive.planner);
    this.refreshFromDiskAndWatch();
    this.errorMessage = undefined;
    this.backgroundWarning = undefined;
    this.broadcast();
    return this.snapshot;
  }

  createTopic(rawInput: CreateTopicInput): CreateTopicResult {
    const input = normalizeCreateTopicInput(rawInput);
    const topicID = topicIDFromTitle(input.title);
    const topicsDirectory = path.join(this.settings.knowledgeRootPath, "topics");
    const notesDirectory = path.join(this.settings.knowledgeRootPath, "notes");
    const topicPath = path.join(topicsDirectory, `${topicID}.json`);
    const notesPath = path.join(notesDirectory, `${topicID}.md`);
    if (existsSync(topicPath) || existsSync(notesPath)) {
      throw new Error(`A topic named \"${input.title}\" already exists. Choose a different name.`);
    }

    mkdirSync(topicsDirectory, { recursive: true });
    mkdirSync(notesDirectory, { recursive: true });
    const topic = normalizeTopic({
      schemaVersion: 2,
      revision: 1,
      id: topicID,
      title: input.title,
      summary: input.summary || `${input.title} study topic.`,
      sources: [],
      relationships: [],
      concepts: [],
      gaps: [],
      questions: []
    });
    validateTopic(topic, topicID);
    try {
      writeFileSync(topicPath, JSON.stringify(topic, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      writeFileSync(notesPath, `# ${input.title}\n\n${topic.summary}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`A topic named \"${input.title}\" already exists. Choose a different name.`);
      }
      throw error;
    }

    this.refreshFromDiskAndWatch();
    this.errorMessage = undefined;
    this.broadcast();
    const createdTopic = this.topics.find((candidate) => candidate.id === topicID);
    if (!createdTopic) throw new Error(`Created topic ${topicID} could not be reloaded.`);
    return { snapshot: this.snapshot, topic: createdTopic };
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
    const rating = input.responseTimeMs === undefined
      ? choice.isCorrect ? input.rating : "missed"
      : inferReviewRating(choice.isCorrect, input.responseTimeMs);
    if (input.responseTimeMs !== undefined && input.rating !== rating) {
      throw new Error("The review rating does not match its correctness and response time.");
    }
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
      rating,
      ...(input.responseTimeMs === undefined ? {} : {
        responseTimeMs: input.responseTimeMs,
        ratingSource: "responseTime" as const
      }),
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
    writeJsonAtomically(filePath, record);
    return { snapshot: this.snapshot, filePath };
  }

  listCaptureSummaries(): CaptureSummary[] {
    return this.captureStore().listSummaries();
  }

  getCapture(id: string): LearnerCapture {
    return this.captureStore().get(id);
  }

  saveCapture(input: SaveCaptureInput): LearnerCapture {
    return this.captureStore().save(input, new Date(), (topicID) => this.assertKnownCaptureTopic(topicID));
  }

  async generateDistractors(rawInput: unknown): Promise<string[]> {
    if (!this.localNoteModel.generateDistractors) {
      throw new Error("The configured local model cannot generate distractors.");
    }
    const input = normalizeGenerateDistractorsInput(rawInput);
    const topic = this.topics.find((candidate) => candidate.id === input.topicID);
    if (!topic) throw new Error("The selected topic is no longer in this knowledge store.");
    return await this.localNoteModel.generateDistractors({
      topicTitle: topic.title,
      topicContext: topicContextForDistractors(topic),
      sentence: input.sentence,
      answer: input.answer
    }, new AbortController().signal);
  }

  finishCapture(rawID: unknown, rawExpectedRevision: unknown): LearnerCapture {
    const id = strictIdentifier(rawID, "capture id");
    const expectedRevision = nonNegativeInteger(rawExpectedRevision, "expectedRevision");
    const store = this.captureStore();
    const current = store.get(id);
    if (current.revision !== expectedRevision) {
      throw new CaptureRevisionConflictError(expectedRevision, current.revision);
    }
    if (current.status === "archived") throw new Error("Archived notes cannot be finished.");
    if (current.origin === "ollama") return current;
    if (!current.rawText.trim()) throw new Error("Add note text before finishing this lecture.");

    const capture = current.status === "ready"
      ? current
      : store.save({
        id: current.id,
        expectedRevision: current.revision,
        topicID: current.topicID,
        title: current.title,
        rawText: current.rawText,
        status: "ready"
      }, new Date(), (topicID) => this.assertKnownCaptureTopic(topicID));
    try {
      this.noteSegmentation.enqueue(capture, this.settings.knowledgeRootPath);
    } catch (error) {
      // Deterministic organization is derived and stored separately; failure
      // here cannot invalidate or modify the already-saved capture revision.
      this.backgroundWarning = noteSegmentationStorageFailureMessage(error);
      this.broadcast();
    }
    return capture;
  }

  archiveCapture(id: string, expectedRevision: number): LearnerCapture {
    return this.captureStore().archive(id, expectedRevision);
  }

  getCaptureSegmentation(captureID: string, captureRevision: number) {
    const capture = this.getCapture(captureID);
    const segmentation = this.noteSegmentation.get(
      captureID,
      captureRevision,
      this.settings.knowledgeRootPath
    );
    if (segmentation?.status === "ready") return segmentation;
    if (capture.revision !== captureRevision) return segmentation;
    if (capture.status !== "ready") return segmentation;
    const scheduled = segmentation
      ? this.noteSegmentation.resume(capture, this.settings.knowledgeRootPath)
      : this.noteSegmentation.enqueue(capture, this.settings.knowledgeRootPath);
    if (this.backgroundWarning) {
      this.backgroundWarning = undefined;
      this.broadcast();
    }
    return scheduled;
  }

  retryCaptureSegmentation(captureID: string, captureRevision: number) {
    const capture = this.getCapture(captureID);
    if (capture.revision !== captureRevision) {
      throw new Error("This note changed before its sections could be reorganized. Open the current revision instead.");
    }
    if (capture.status !== "ready") {
      throw new Error("Only a ready note can be reorganized into reading sections.");
    }
    const segmentation = this.noteSegmentation.retry(capture, this.settings.knowledgeRootPath);
    this.backgroundWarning = undefined;
    this.broadcast();
    return segmentation;
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
    this.noteSegmentation.dispose();
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
    const personalRoot = this.paths.personalKnowledgeRoot ?? path.join(homedir(), "Documents", "RevemberKnowledge");
    if (existsSync(personalRoot)) return personalRoot;
    if (!existsSync(this.paths.bundledKnowledgeRoot)) {
      throw new Error("Revember could not find its included starter knowledge vault.");
    }
    try {
      mkdirSync(path.dirname(personalRoot), { recursive: true });
      cpSync(this.paths.bundledKnowledgeRoot, personalRoot, { recursive: true });
      return personalRoot;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Revember could not set up your starter knowledge vault at ${personalRoot}: ${detail}`);
    }
  }

  private legacyKnowledgeRoot(): string | undefined {
    if (process.platform !== "darwin" || process.env.REVEMBER_USER_DATA_PATH) return undefined;
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
    writeJsonAtomically(this.paths.settingsPath, settings);
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

  private captureStore(): CaptureStore {
    return new CaptureStore(this.settings.knowledgeRootPath);
  }

  private assertKnownCaptureTopic(topicID: string): void {
    if (!this.topics.some((topic) => topic.id === topicID)) {
      throw new Error(`Capture references missing topic ${topicID}.`);
    }
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
    writeJsonAtomically(progressPath, progress);
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

function readCloudVaultFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (directory: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
        continue;
      }
      if (!entry.isFile() || lstatSync(candidate).isSymbolicLink()) continue;
      const relativePath = path.relative(root, candidate).split(path.sep).join("/");
      if (!isCloudVaultPath(relativePath)) continue;
      files[relativePath] = readFileSync(candidate, "utf8");
    }
  };
  for (const directory of cloudVaultDirectories) visit(path.join(root, directory));
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeCloudVaultArchive(value: unknown): CloudVaultArchive {
  const raw = record(value, "Cloud vault");
  if (raw.schemaVersion !== 1) throw new Error("This cloud vault uses an unsupported schema.");
  if (typeof raw.exportedAt !== "string" || Number.isNaN(new Date(raw.exportedAt).getTime())) {
    throw new Error("Cloud vault export timestamp is invalid.");
  }
  const rawFiles = record(raw.files, "Cloud vault files");
  const files: Record<string, string> = {};
  for (const [relativePath, contents] of Object.entries(rawFiles)) {
    if (!isCloudVaultPath(relativePath) || typeof contents !== "string") {
      throw new Error("Cloud vault contains an invalid file.");
    }
    files[relativePath] = contents;
  }
  const archive: CloudVaultArchive = {
    schemaVersion: 1,
    exportedAt: raw.exportedAt,
    files,
    progress: normalizeProgress(raw.progress),
    planner: normalizePlanner(raw.planner)
  };
  if (Buffer.byteLength(JSON.stringify(archive), "utf8") > cloudVaultMaxBytes) {
    throw new Error("Cloud vault exceeds this app's safe snapshot size.");
  }
  return archive;
}

function isCloudVaultPath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.length < 2 || !cloudVaultDirectories.includes(segments[0] as typeof cloudVaultDirectories[number])) return false;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return false;
  return relativePath.endsWith(".json") || relativePath.endsWith(".md");
}

function normalizeGenerateDistractorsInput(rawInput: unknown): GenerateDistractorsInput {
  const input = record(rawInput, "distractor request");
  return {
    topicID: strictIdentifier(input.topicID, "topicID"),
    sentence: boundedRequestText(input.sentence, "sentence", 1_200),
    answer: boundedRequestText(input.answer, "answer", 500)
  };
}

function normalizeCreateTopicInput(rawInput: unknown): CreateTopicInput {
  const input = record(rawInput, "create topic input");
  const title = boundedRequestText(input.title, "title", 120);
  const summary = input.summary === undefined
    ? ""
    : typeof input.summary === "string"
      ? input.summary.trim().slice(0, 500)
      : (() => { throw new Error("summary must be a string."); })();
  return { title, summary };
}

function topicIDFromTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || `topic-${Date.now()}`;
}

function boundedRequestText(value: unknown, label: string, maximum: number): string {
  const text = nonEmptyExactString(value, label).trim();
  if (text.length > maximum) throw new Error(`${label} must be at most ${maximum} characters.`);
  return text;
}

function normalizeCommitReviewInput(rawInput: unknown): CommitReviewInput {
  const input = record(rawInput, "review input");
  const reviewedAt = optionalCanonicalTimestamp(input.reviewedAt, "reviewedAt");
  const responseTimeMs = input.responseTimeMs === undefined
    ? undefined
    : nonNegativeInteger(input.responseTimeMs, "responseTimeMs");
  if (responseTimeMs !== undefined && responseTimeMs > REVIEW_RESPONSE_TIME_CAP_MS) {
    throw new Error(`responseTimeMs must be at most ${REVIEW_RESPONSE_TIME_CAP_MS}.`);
  }
  return {
    topicID: strictIdentifier(input.topicID, "topicID"),
    questionID: nonEmptyExactString(input.questionID, "questionID"),
    questionRevision: positiveInteger(input.questionRevision, "questionRevision"),
    choiceID: nonEmptyExactString(input.choiceID, "choiceID"),
    rating: oneOf(input.rating, reviewRatings, "rating"),
    ...(responseTimeMs === undefined ? {} : { responseTimeMs }),
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

function topicContextForDistractors(topic: KnowledgeTopic): string {
  const lines = [
    `Topic: ${topic.title}`,
    `Summary: ${topic.summary}`,
    "Concepts:"
  ];
  for (const concept of topic.concepts) {
    lines.push(`- ${concept.title}: ${concept.firstPrinciples}`);
    if (concept.explanation && concept.explanation !== concept.firstPrinciples) {
      lines.push(`  Explanation: ${concept.explanation}`);
    }
  }
  const activeQuestions = topic.questions.filter((question) => !question.retiredAt);
  if (activeQuestions.length > 0) {
    lines.push("Existing review questions:");
    for (const question of activeQuestions) {
      const correct = question.choices.find((choice) => choice.isCorrect);
      lines.push(`- Prompt: ${question.prompt}`);
      if (correct) lines.push(`  Correct answer: ${correct.text}`);
      lines.push(`  Explanation: ${question.explanation}`);
    }
  }
  return lines.join("\n");
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
