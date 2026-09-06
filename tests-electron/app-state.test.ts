import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as persistence from "../electron/persistence";
import { RevemberState } from "../electron/app-state";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("knowledge-root state transitions", () => {
  it("rolls back a new topic when its companion note cannot be created, preserving the conflicting entry", async () => {
    const fixture = await stateFixture();
    const notes = path.join(fixture.oldRoot, "notes");
    await fs.mkdir(notes, { recursive: true });
    const note = path.join(notes, "incomplete-topic.md");
    // A dangling symlink is invisible to existsSync but exclusive creation rejects it.
    await fs.symlink(path.join(fixture.root, "missing-note"), note);
    const state = fixture.createState();
    try {
      expect(() => state.createTopic({ title: "Incomplete topic", summary: "Must be all or nothing." })).toThrow(/already exists/i);
      await expect(fs.access(path.join(fixture.oldRoot, "topics", "incomplete-topic.json"))).rejects.toThrow();
      expect((await fs.lstat(note)).isSymbolicLink()).toBe(true);
    } finally { state.dispose(); }
  });

  it("sets up an editable personal copy of the bundled starter vault", async () => {
    const fixture = await stateFixture();
    const bundledRoot = path.join(fixture.root, "bundled-knowledge");
    const personalRoot = path.join(fixture.root, "Documents", "RevemberKnowledge");
    await writeTopic(bundledRoot, topic("starter-topic"));
    await fs.mkdir(path.join(bundledRoot, "notes"), { recursive: true });
    await fs.writeFile(path.join(bundledRoot, "notes", "starter-topic.md"), "# Starter topic\n");
    const state = new RevemberState({
      settingsPath: fixture.settingsPath,
      bundledKnowledgeRoot: bundledRoot,
      personalKnowledgeRoot: personalRoot,
      legacyProgressPath: fixture.progressPath
    });

    try {
      const snapshot = state.resetKnowledgeRoot();
      expect(snapshot.settings.knowledgeRootPath).toBe(personalRoot);
      expect(snapshot.topics.map((candidate) => candidate.id)).toEqual(["starter-topic"]);
      await expect(fs.access(path.join(personalRoot, "notes", "starter-topic.md"))).resolves.toBeUndefined();

      state.createTopic({ title: "Personal topic", summary: "Created in the editable copy." });
      await expect(fs.access(path.join(personalRoot, "topics", "personal-topic.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(bundledRoot, "topics", "personal-topic.json"))).rejects.toThrow();
    } finally {
      state.dispose();
    }
  });

  it("keeps settings, topics, and mutation paths on the old root when the candidate root is invalid", async () => {
    const fixture = await stateFixture();
    const invalidRoot = path.join(fixture.root, "invalid-knowledge");
    await fs.mkdir(path.join(invalidRoot, "topics"), { recursive: true });
    await fs.writeFile(path.join(invalidRoot, "topics", "broken.json"), JSON.stringify(topic("wrong-file-id")));
    const settingsBefore = await fs.readFile(fixture.settingsPath);
    const state = fixture.createState();

    try {
      expect(() => state.setKnowledgeRoot(invalidRoot)).toThrow(/topic id must match/i);
      expect(state.snapshot.settings.knowledgeRootPath).toBe(fixture.oldRoot);
      expect(state.snapshot.topics.map((candidate) => candidate.id)).toEqual(["old-topic"]);
      expect(await fs.readFile(fixture.settingsPath)).toEqual(settingsBefore);

      const checkpoint = state.captureCheckpoint({ topicID: "old-topic", summary: "Still on the old root." });
      expect(checkpoint.filePath.startsWith(path.join(fixture.oldRoot, "sessions"))).toBe(true);
      await expect(fs.access(path.join(invalidRoot, "sessions"))).rejects.toThrow();
    } finally {
      state.dispose();
    }
  });

  it("commits a valid root switch as one coherent snapshot", async () => {
    const fixture = await stateFixture();
    const nextRoot = path.join(fixture.root, "next-knowledge");
    await writeTopic(nextRoot, topic("next-topic"));
    const state = fixture.createState();

    try {
      const snapshot = state.setKnowledgeRoot(nextRoot);
      expect(snapshot.settings.knowledgeRootPath).toBe(nextRoot);
      expect(snapshot.topics.map((candidate) => candidate.id)).toEqual(["next-topic"]);
      expect(JSON.parse(await fs.readFile(fixture.settingsPath, "utf8")).knowledgeRootPath).toBe(nextRoot);

      const checkpoint = state.captureCheckpoint({ topicID: "next-topic", summary: "Now on the next root." });
      expect(checkpoint.filePath.startsWith(path.join(nextRoot, "sessions"))).toBe(true);
    } finally {
      state.dispose();
    }
  });
});

describe("review mutation validation", () => {
  it.each([
    ["an empty event ID", { eventID: "" }, /eventID must be a non-empty string/],
    ["a whitespace event ID", { eventID: "   " }, /eventID must be a non-empty string/],
    ["a padded event ID", { eventID: " event " }, /eventID cannot start or end with whitespace/],
    ["an invalid rating", { rating: "perfect" }, /rating is invalid/],
    ["a fractional response time", { responseTimeMs: 1.5 }, /responseTimeMs must be a non-negative integer/],
    ["an excessive response time", { responseTimeMs: 60_001 }, /responseTimeMs must be at most 60000/],
    ["a rating inconsistent with timing", { responseTimeMs: 12_000, rating: "easy" }, /rating does not match/i],
    ["a non-canonical timestamp", { reviewedAt: "2026-08-01T00:00:00Z" }, /reviewedAt must be a canonical ISO timestamp/]
  ])("rejects %s without changing memory or disk", async (_label, replacement, message) => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      const snapshotBefore = JSON.stringify(state.snapshot.progress);
      const bytesBefore = await fs.readFile(fixture.progressPath);
      expect(() => state.commitReview({ ...validReviewInput(), ...replacement })).toThrow(message);
      expect(JSON.stringify(state.snapshot.progress)).toBe(snapshotBefore);
      expect(await fs.readFile(fixture.progressPath)).toEqual(bytesBefore);
    } finally {
      state.dispose();
    }
  });

  it("persists validated input in a form that reloads without quarantine", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      const result = state.commitReview(validReviewInput());
      expect(result.wasInserted).toBe(true);
      expect(result.event.id).toBe("event-1");
      expect(result.event.reviewedAt).toBe("2026-08-01T00:00:00.000Z");
    } finally {
      state.dispose();
    }

    const restarted = fixture.createState();
    try {
      expect(restarted.snapshot.errorMessage).toBeUndefined();
      expect(restarted.snapshot.progress.reviewEvents).toHaveLength(1);
    } finally {
      restarted.dispose();
    }
  });

  it("persists automatic difficulty evidence with its response time", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      const result = state.commitReview({
        ...validReviewInput(),
        rating: "easy",
        responseTimeMs: 4_850
      });
      expect(result.event).toMatchObject({
        rating: "easy",
        responseTimeMs: 4_850,
        ratingSource: "responseTime"
      });
    } finally {
      state.dispose();
    }

    const restarted = fixture.createState();
    try {
      expect(restarted.snapshot.errorMessage).toBeUndefined();
      expect(restarted.snapshot.progress.reviewEvents[0]).toMatchObject({
        rating: "easy",
        responseTimeMs: 4_850,
        ratingSource: "responseTime"
      });
    } finally {
      restarted.dispose();
    }
  });

  it("accepts logical question and choice IDs containing schema-valid punctuation", async () => {
    const fixture = await stateFixture();
    const colonTopic = topic("old-topic");
    colonTopic.questions[0].id = "question:1";
    colonTopic.questions[0].choices[0].id = "choice:1";
    await writeTopic(fixture.oldRoot, colonTopic);
    const state = fixture.createState();
    try {
      const result = state.commitReview({
        ...validReviewInput(),
        questionID: "question:1",
        choiceID: "choice:1",
        eventID: "event-colon-1"
      });
      expect(result.event).toMatchObject({
        questionID: "question:1",
        choiceID: "choice:1",
        isCorrect: true
      });
    } finally {
      state.dispose();
    }

    const restarted = fixture.createState();
    try {
      expect(restarted.snapshot.errorMessage).toBeUndefined();
      expect(restarted.snapshot.progress.reviewEvents[0]).toMatchObject({
        questionID: "question:1",
        choiceID: "choice:1"
      });
    } finally {
      restarted.dispose();
    }
  });
});

describe("cloud vault archives", () => {
  it("exports current disk progress rather than stale cached progress", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      state.commitReview(validReviewInput());
      await fs.writeFile(fixture.progressPath, JSON.stringify({ schemaVersion: 2, topics: {}, reviewEvents: [] }));
      expect(state.exportCloudVault().progress.reviewEvents).toHaveLength(0);
      await fs.writeFile(path.join(fixture.oldRoot, "topics", "old-topic.json"), "broken");
      expect(() => state.exportCloudVault()).toThrow();
    } finally { state.dispose(); }
  });
  it("rolls back the vault and progress when committing an import fails", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    const progressBefore = await fs.readFile(fixture.progressPath);
    const archive = state.exportCloudVault();
    archive.files = { "topics/new-topic.json": JSON.stringify(topic("new-topic")) };
    const write = vi.spyOn(persistence, "writeJsonAtomically").mockImplementationOnce(() => { throw new Error("disk full"); });
    try {
      expect(() => state.importCloudVault(archive)).toThrow("disk full");
      expect(await fs.readFile(fixture.progressPath)).toEqual(progressBefore);
      expect(JSON.parse(await fs.readFile(path.join(fixture.oldRoot, "topics", "old-topic.json"), "utf8")).id).toBe("old-topic");
      await expect(fs.access(path.join(fixture.oldRoot, "topics", "new-topic.json"))).rejects.toThrow();
      expect(state.snapshot.topics[0].id).toBe("old-topic");
    } finally { write.mockRestore(); state.dispose(); }
  });

  it("refuses to download through an existing symlink without changing its target", async () => {
    const fixture = await stateFixture();
    const outside = path.join(fixture.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "note.md"), "private");
    await fs.symlink(outside, path.join(fixture.oldRoot, "notes"));
    const state = fixture.createState();
    try {
      const archive = state.exportCloudVault();
      archive.files["notes/note.md"] = "overwrite";
      expect(() => state.importCloudVault(archive)).toThrow(/link/i);
      expect(await fs.readFile(path.join(outside, "note.md"), "utf8")).toBe("private");
    } finally { state.dispose(); }
  });
  it("preserves excluded attachments and nested backups on download", async () => {
    const fixture = await stateFixture();
    await fs.mkdir(path.join(fixture.oldRoot, "notes", ".backups"), { recursive: true });
    await fs.writeFile(path.join(fixture.oldRoot, "notes", "attachment.pdf"), "private attachment");
    await fs.writeFile(path.join(fixture.oldRoot, "notes", ".backups", "old.md"), "private backup");
    const state = fixture.createState();
    try {
      const archive = state.exportCloudVault();
      expect(Object.keys(archive.files)).not.toContain("notes/.backups/old.md");
      state.importCloudVault(archive);
      expect(await fs.readFile(path.join(fixture.oldRoot, "notes", "attachment.pdf"), "utf8")).toBe("private attachment");
      expect(await fs.readFile(path.join(fixture.oldRoot, "notes", ".backups", "old.md"), "utf8")).toBe("private backup");
    } finally { state.dispose(); }
  });

  it("never exports files through a symlinked top-level directory", async () => {
    const fixture = await stateFixture();
    const outside = path.join(fixture.root, "private");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.md"), "not vault content");
    await fs.symlink(outside, path.join(fixture.oldRoot, "notes"));
    const state = fixture.createState();
    try { expect(Object.keys(state.exportCloudVault().files)).not.toContain("notes/secret.md"); }
    finally { state.dispose(); }
  });

  it.each([
    ["broken topic JSON", { "topics/old-topic.json": "{broken" }],
    ["topic filename mismatch", { "topics/other.json": JSON.stringify(topic("old-topic")) }],
    ["NUL path", { "notes/bad\u0000.md": "x" }],
    ["case-colliding paths", { "notes/A.md": "one", "notes/a.md": "two" }],
    ["file-directory collision", { "notes/a.md": "one", "notes/a.md/b.md": "two" }]
  ])("rejects %s without replacing local files", async (_label, files) => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      const before = await fs.readFile(path.join(fixture.oldRoot, "topics", "old-topic.json"));
      expect(() => state.importCloudVault({ ...state.exportCloudVault(), files })).toThrow();
      expect(await fs.readFile(path.join(fixture.oldRoot, "topics", "old-topic.json"))).toEqual(before);
      expect(state.snapshot.topics[0].id).toBe("old-topic");
    } finally { state.dispose(); }
  });
  it("round-trips only syncable vault data and keeps a backup before replacement", async () => {
    const source = await stateFixture();
    const sourceRoot = path.join(source.root, "source-knowledge");
    await writeTopic(sourceRoot, topic("source-topic"));
    await fs.mkdir(path.join(sourceRoot, "notes"), { recursive: true });
    await fs.mkdir(path.join(sourceRoot, "captures"), { recursive: true });
    await fs.mkdir(path.join(sourceRoot, "sessions"), { recursive: true });
    await fs.mkdir(path.join(sourceRoot, ".backups"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "notes", "source-topic.md"), "# Synced note\n");
    await fs.writeFile(path.join(sourceRoot, "captures", "capture.json"), '{"title":"Synced capture"}\n');
    await fs.writeFile(path.join(sourceRoot, "sessions", "session.json"), '{"summary":"Synced session"}\n');
    await fs.writeFile(path.join(sourceRoot, ".backups", "private.json"), '{"do":"not sync"}\n');
    await fs.writeFile(path.join(sourceRoot, "notes", "attachment.pdf"), "not text");

    const sourceState = source.createState();
    let archive;
    try {
      sourceState.setKnowledgeRoot(sourceRoot);
      sourceState.commitReview({
        ...validReviewInput(),
        topicID: "source-topic",
        eventID: "source-event"
      });
      archive = sourceState.exportCloudVault();
    } finally {
      sourceState.dispose();
    }

    expect(archive.files).toMatchObject({
      "topics/source-topic.json": expect.any(String),
      "notes/source-topic.md": "# Synced note\n",
      "captures/capture.json": '{"title":"Synced capture"}\n',
      "sessions/session.json": '{"summary":"Synced session"}\n'
    });
    expect(archive.files).not.toHaveProperty(".backups/private.json");
    expect(archive.files).not.toHaveProperty("notes/attachment.pdf");

    const destination = await stateFixture();
    await fs.mkdir(path.join(destination.oldRoot, "notes"), { recursive: true });
    await fs.writeFile(path.join(destination.oldRoot, "notes", "old-topic.md"), "# Old device note\n");
    const destinationState = destination.createState();
    try {
      const snapshot = destinationState.importCloudVault(archive);
      expect(snapshot.topics.map((candidate) => candidate.id)).toEqual(["source-topic"]);
      expect(snapshot.progress.reviewEvents.map((event) => event.id)).toEqual(["source-event"]);
      await expect(fs.readFile(path.join(destination.oldRoot, "notes", "source-topic.md"), "utf8")).resolves.toBe("# Synced note\n");
      await expect(fs.access(path.join(destination.oldRoot, "topics", "old-topic.json"))).rejects.toThrow();
      await expect(fs.access(path.join(destination.oldRoot, "notes", "old-topic.md"))).rejects.toThrow();

      const backups = await fs.readdir(path.join(destination.oldRoot, ".revember-cloud-backups"));
      expect(backups).toHaveLength(1);
      await expect(fs.readFile(path.join(destination.oldRoot, ".revember-cloud-backups", backups[0], "topics", "old-topic.json"), "utf8")).resolves.toContain('"id":"old-topic"');
      await expect(fs.readFile(path.join(destination.oldRoot, ".revember-cloud-backups", backups[0], "notes", "old-topic.md"), "utf8")).resolves.toBe("# Old device note\n");
    } finally {
      destinationState.dispose();
    }
  });

  it.each([
    ["an unsafe path", (archive: ReturnType<RevemberState["exportCloudVault"]>) => ({ ...archive, files: { "topics/../escape.json": "{}" } }), /invalid file/i],
    ["a malformed progress record", (archive: ReturnType<RevemberState["exportCloudVault"]>) => ({ ...archive, progress: null }), /progress/i],
    ["an unsupported schema", (archive: ReturnType<RevemberState["exportCloudVault"]>) => ({ ...archive, schemaVersion: 2 }), /unsupported schema/i]
  ])("rejects %s before touching the local vault", async (_label, corruptArchive, message) => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      const archive = state.exportCloudVault();
      const topicBefore = await fs.readFile(path.join(fixture.oldRoot, "topics", "old-topic.json"));
      await expect(Promise.resolve().then(() => state.importCloudVault(corruptArchive(archive)))).rejects.toThrow(message);
      expect(await fs.readFile(path.join(fixture.oldRoot, "topics", "old-topic.json"))).toEqual(topicBefore);
      await expect(fs.access(path.join(fixture.oldRoot, ".revember-cloud-backups"))).rejects.toThrow();
    } finally {
      state.dispose();
    }
  });

  it("rejects an oversized cloud archive before it can create a backup", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      const archive = state.exportCloudVault();
      archive.files["notes/too-large.md"] = "x".repeat(7_500_000);
      expect(() => state.importCloudVault(archive)).toThrow(/safe snapshot size/i);
      await expect(fs.access(path.join(fixture.oldRoot, ".revember-cloud-backups"))).rejects.toThrow();
    } finally {
      state.dispose();
    }
  });
});

describe("settings recovery", () => {
  it.each([
    ["null document", null],
    ["non-string path", {
      knowledgeRootPath: null,
      progressPath: "/tmp/progress.json",
      notificationsEnabled: false
    }],
    ["non-boolean notification value", {
      knowledgeRootPath: "/tmp/knowledge",
      progressPath: "/tmp/progress.json",
      notificationsEnabled: "yes"
    }]
  ])("quarantines a %s and uses validated fallback settings", async (_label, invalidSettings) => {
    const fixture = await stateFixture();
    await fs.writeFile(fixture.settingsPath, JSON.stringify(invalidSettings));
    const previousKnowledgeRoot = process.env.REVEMBER_KNOWLEDGE_ROOT;
    const previousProgressPath = process.env.REVEMBER_PROGRESS_PATH;
    process.env.REVEMBER_KNOWLEDGE_ROOT = fixture.oldRoot;
    process.env.REVEMBER_PROGRESS_PATH = fixture.progressPath;
    let state: RevemberState | undefined;

    try {
      state = fixture.createState();
      expect(state.snapshot.settings).toEqual({
        knowledgeRootPath: fixture.oldRoot,
        progressPath: fixture.progressPath,
        notificationsEnabled: false
      });
      expect(state.snapshot.errorMessage).toMatch(/Settings were invalid and moved/i);
      await expect(fs.access(fixture.settingsPath)).rejects.toThrow();
      expect((await fs.readdir(path.dirname(fixture.settingsPath))).some((name) =>
        /^settings\.corrupt-.*\.json$/.test(name)
      )).toBe(true);
    } finally {
      state?.dispose();
      restoreEnvironment("REVEMBER_KNOWLEDGE_ROOT", previousKnowledgeRoot);
      restoreEnvironment("REVEMBER_PROGRESS_PATH", previousProgressPath);
    }
  });

  it("rejects a non-boolean notification mutation", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();
    try {
      expect(() => state.setNotificationsEnabled("yes")).toThrow(/must be a boolean/i);
      expect(state.snapshot.settings.notificationsEnabled).toBe(false);
    } finally {
      state.dispose();
    }
  });
});

describe("progress quarantine", () => {
  it("quarantines scheduler state with a malformed dueAt before it can reach notification timing", async () => {
    const fixture = await stateFixture();
    await fs.writeFile(fixture.progressPath, JSON.stringify({
      schemaVersion: 2,
      topics: {
        "old-topic": {
          attemptsByQuestionID: {},
          weakConceptIDs: {},
          reviewCardsByQuestionID: {
            question: {
              schedulerVersion: "simple-v1",
              questionRevision: 1,
              dueAt: "not-a-date",
              intervalDays: 2,
              stability: 2,
              difficulty: 5,
              lapses: 0,
              reviews: 1
            }
          }
        }
      },
      reviewEvents: []
    }));

    const state = fixture.createState();
    try {
      expect(state.snapshot.errorMessage).toMatch(/Progress was invalid and moved/i);
      await expect(fs.access(fixture.progressPath)).rejects.toThrow();
      expect((await fs.readdir(path.dirname(fixture.progressPath))).some((name) =>
        /^progress\.corrupt-.*\.json$/.test(name)
      )).toBe(true);
    } finally {
      state.dispose();
    }
  });

  it("quarantines malformed review event IDs before commitReview can compare them", async () => {
    const fixture = await stateFixture();
    await fs.writeFile(fixture.progressPath, JSON.stringify({
      schemaVersion: 2,
      topics: {},
      reviewEvents: [{
        id: 17,
        topicID: "old-topic",
        questionID: "question",
        choiceID: "choice",
        isCorrect: true,
        rating: "good",
        reviewedAt: "2026-08-01T00:00:00.000Z"
      }]
    }));

    const state = fixture.createState();
    try {
      expect(state.snapshot.errorMessage).toMatch(/review event 0 id must be a non-empty string/i);
      expect(state.snapshot.progress.reviewEvents).toEqual([]);
      await expect(fs.access(fixture.progressPath)).rejects.toThrow();
      expect((await fs.readdir(path.dirname(fixture.progressPath))).some((name) =>
        /^progress\.corrupt-.*\.json$/.test(name)
      )).toBe(true);
    } finally {
      state.dispose();
    }
  });
});

async function stateFixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-app-state-"));
  temporaryRoots.push(root);
  const oldRoot = path.join(root, "old-knowledge");
  const progressPath = path.join(root, "state", "progress.json");
  const settingsPath = path.join(root, "settings.json");
  await writeTopic(oldRoot, topic("old-topic"));
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify({ schemaVersion: 2, topics: {}, reviewEvents: [] }));
  await fs.writeFile(settingsPath, JSON.stringify({
    knowledgeRootPath: oldRoot,
    progressPath,
    notificationsEnabled: false
  }));
  return {
    root,
    oldRoot,
    progressPath,
    settingsPath,
    createState: () => new RevemberState({
      settingsPath,
      bundledKnowledgeRoot: oldRoot,
      legacyProgressPath: progressPath
    })
  };
}

async function writeTopic(knowledgeRoot: string, value: ReturnType<typeof topic>): Promise<void> {
  const topicsDirectory = path.join(knowledgeRoot, "topics");
  await fs.mkdir(topicsDirectory, { recursive: true });
  await fs.writeFile(path.join(topicsDirectory, `${value.id}.json`), JSON.stringify(value));
}

function topic(id: string) {
  return {
    schemaVersion: 2,
    revision: 1,
    id,
    title: id,
    summary: id,
    sources: [],
    relationships: [],
    concepts: [{
      id: "concept",
      title: "Concept",
      firstPrinciples: "A state",
      explanation: "A measurable distinction"
    }],
    gaps: [],
    questions: [{
      id: "question",
      revision: 1,
      kind: "multipleChoice",
      transferLevel: "recall",
      prompt: "Which choice is correct?",
      difficulty: "intro",
      conceptIDs: ["concept"],
      gapTags: [],
      sourceRefs: [],
      choices: [
        { id: "choice", text: "Correct", isCorrect: true },
        { id: "wrong", text: "Wrong", isCorrect: false }
      ],
      explanation: "Correct."
    }]
  };
}

function validReviewInput() {
  return {
    topicID: "old-topic",
    questionID: "question",
    questionRevision: 1,
    choiceID: "choice",
    rating: "good",
    eventID: "event-1",
    reviewedAt: "2026-08-01T00:00:00.000Z"
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
