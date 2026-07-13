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
  CaptureCheckpointInput,
  CaptureCheckpointResult,
  CommitReviewInput,
  CommitReviewResult,
  KnowledgeTopic,
  ProgressRecord,
  ReviewEvent
} from "../shared/types";
import {
  applyReviewEvent,
  correctChoice,
  emptyProgress,
  normalizeProgress,
  normalizeTopic
} from "../shared/domain";

interface StatePaths {
  settingsPath: string;
  bundledKnowledgeRoot: string;
  legacyProgressPath: string;
}

export class RevemberState extends EventEmitter {
  private topics: KnowledgeTopic[] = [];
  private progress: ProgressRecord = emptyProgress();
  private settings: AppSettings;
  private errorMessage?: string;
  private watchers: FSWatcher[] = [];
  private reloadTimer?: NodeJS.Timeout;

  constructor(private readonly paths: StatePaths) {
    super();
    this.settings = this.loadSettings();
    this.reloadFromDisk();
    this.startWatching();
  }

  get snapshot(): AppSnapshot {
    return structuredClone({
      topics: this.topics,
      progress: this.progress,
      settings: this.settings,
      errorMessage: this.errorMessage,
      platform: process.platform
    });
  }

  reload(): AppSnapshot {
    this.reloadFromDisk();
    this.startWatching();
    this.broadcast();
    return this.snapshot;
  }

  setKnowledgeRoot(knowledgeRootPath: string): AppSnapshot {
    this.settings.knowledgeRootPath = path.resolve(expandHome(knowledgeRootPath));
    this.saveSettings();
    return this.reload();
  }

  resetKnowledgeRoot(): AppSnapshot {
    this.settings.knowledgeRootPath = this.defaultKnowledgeRoot();
    this.saveSettings();
    return this.reload();
  }

  setNotificationsEnabled(enabled: boolean): AppSnapshot {
    this.settings.notificationsEnabled = enabled;
    this.saveSettings();
    this.broadcast();
    return this.snapshot;
  }

  commitReview(input: CommitReviewInput): CommitReviewResult {
    const topic = this.topics.find((candidate) => candidate.id === input.topicID);
    const question = topic?.questions.find((candidate) => candidate.id === input.questionID && !candidate.retiredAt);
    if (!topic || !question || question.revision !== input.questionRevision) {
      throw new Error("This check changed while it was open. Start a fresh review before saving evidence.");
    }
    const choice = question.choices.find((candidate) => candidate.id === input.choiceID);
    if (!choice) throw new Error("The selected answer no longer exists.");
    const reviewedAt = input.reviewedAt ? new Date(input.reviewedAt) : new Date();
    if (Number.isNaN(reviewedAt.getTime())) throw new Error("The review timestamp is invalid.");
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
      reviewedAt: reviewedAt.toISOString()
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
    atomicWrite(filePath, JSON.stringify(record, null, 2) + "\n");
    return { snapshot: this.snapshot, filePath };
  }

  dispose(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  private loadSettings(): AppSettings {
    let stored: Partial<AppSettings> = {};
    try {
      stored = JSON.parse(readFileSync(this.paths.settingsPath, "utf8")) as Partial<AppSettings>;
    } catch {
      // The settings file is optional on first launch.
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

  private saveSettings(): void {
    mkdirSync(path.dirname(this.paths.settingsPath), { recursive: true });
    atomicWrite(this.paths.settingsPath, JSON.stringify(this.settings, null, 2) + "\n");
  }

  private reloadFromDisk(): void {
    try {
      this.topics = this.loadTopics();
      this.progress = this.loadProgress();
      this.errorMessage = undefined;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  private loadTopics(): KnowledgeTopic[] {
    const topicsDirectory = path.join(this.settings.knowledgeRootPath, "topics");
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

  private loadProgress(): ProgressRecord {
    if (!existsSync(this.settings.progressPath)) return emptyProgress();
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.settings.progressPath, "utf8"));
    } catch (error) {
      const quarantine = artifactPath(this.settings.progressPath, "corrupt");
      renameSync(this.settings.progressPath, quarantine);
      throw new Error(`Progress was unreadable and moved to ${path.basename(quarantine)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const progress = normalizeProgress(raw);
    if (progress.schemaVersion < 2) {
      const backup = artifactPath(this.settings.progressPath, "pre-v2-backup");
      copyFileSync(this.settings.progressPath, backup);
      progress.schemaVersion = 2;
      this.writeProgress(progress);
    }
    return progress;
  }

  private writeProgress(progress: ProgressRecord): void {
    mkdirSync(path.dirname(this.settings.progressPath), { recursive: true });
    atomicWrite(this.settings.progressPath, JSON.stringify(progress, null, 2) + "\n");
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
            this.reloadFromDisk();
            this.startWatching();
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

function atomicWrite(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function artifactPath(filePath: string, kind: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${kind}-${Date.now()}${parsed.ext}`);
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  return input.startsWith("~/") ? path.join(homedir(), input.slice(2)) : input;
}
