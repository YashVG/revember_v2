import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RevemberConfig } from "../src/config.js";
import {
  assertSafeSlug,
  ensureKnowledgeDirs,
  fileExists,
  sessionPath,
  topicPath
} from "../src/paths.js";
import { validateTopicData } from "../src/schema.js";
import {
  createTopic,
  readMarkdown,
  readTopic,
  retireCard,
  updateMarkdownWithRevision,
  updateTopic,
  upsertCard,
  upsertConcept,
  validateTopicFile,
  writeMarkdown
} from "../src/topics.js";
import { searchKnowledge, searchTopics } from "../src/search.js";
import {
  captureLearningSession,
  readLearningSession,
  searchSessions
} from "../src/sessions.js";
import { getLearnerBrief } from "../src/learner.js";
import { buildReviewPlan } from "../src/tools.js";
import { validateKnowledgeBase } from "../src/validation.js";

function makeConfig(root: string): RevemberConfig {
  return {
    packageRoot: path.dirname(root),
    knowledgeRoot: root,
    topicsDir: path.join(root, "topics"),
    notesDir: path.join(root, "notes"),
    sessionsDir: path.join(root, "sessions"),
    backupsDir: path.join(root, ".backups"),
    progressPath: path.join(root, "progress.json")
  };
}

const validTopic = {
  id: "ble",
  title: "Bluetooth Low Energy",
  summary: "BLE fundamentals.",
  concepts: [
    {
      id: "bits",
      title: "Bits",
      firstPrinciples: "A bit is a distinguishable physical state.",
      explanation: "Bits become useful when a protocol assigns meaning.",
      relatedTerms: ["binary"],
      confusableTerms: ["byte"],
      gapTags: ["physical substrate"]
    }
  ],
  gaps: [],
  questions: [
    {
      id: "bits-check-1",
      prompt: "What is a bit?",
      difficulty: "intro",
      conceptIDs: ["bits"],
      gapTags: ["physical substrate"],
      choices: [
        { id: "a", text: "A distinguishable physical state.", isCorrect: true },
        { id: "b", text: "A whole BLE packet.", isCorrect: false }
      ],
      explanation: "A bit is below packet and protocol meaning."
    }
  ]
};

function runTopicMutationWorker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL("./topic-mutation-worker.mjs", import.meta.url));
    const child = spawn(process.execPath, [workerPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function run(): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-mcp-"));
  const config = makeConfig(root);

  try {
    await ensureKnowledgeDirs(config);

    // Backward-compatible legacy schema and additive v2 schema.
    assert.equal(validateTopicData(validTopic).valid, true);
    const v2Validation = validateTopicData({
      ...validTopic,
      schemaVersion: 2,
      revision: 4,
      sources: [{ id: "spec", kind: "specification", title: "BLE specification", locator: "https://example.test/spec", capturedAt: "2026-07-09T08:00:00.000Z" }],
      relationships: [{ id: "bits-to-bits", sourceConceptID: "bits", targetConceptID: "bits", kind: "enables", rationale: "Bits enable higher representations.", sourceRefs: ["spec"] }],
      questions: [{
        ...validTopic.questions[0]!,
        revision: 3,
        kind: "predict",
        transferLevel: "application",
        sourceRefs: ["spec"],
        choices: [
          { ...validTopic.questions[0]!.choices[0]!, rationale: "Correct physical model." },
          { ...validTopic.questions[0]!.choices[1]!, misconceptionID: "bit-is-packet", rationale: "Confuses representation with transport." }
        ]
      }]
    });
    assert.equal(v2Validation.valid, true);
    assert.match(v2Validation.warnings.join(" "), /points a concept to itself/);
    assert.equal(validateTopicData({
      ...validTopic,
      relationships: [{ id: "missing-bits", sourceConceptID: "missing", targetConceptID: "bits", kind: "prerequisite", rationale: "Missing source.", sourceRefs: [] }]
    }).valid, false);
    assert.equal(validateTopicData({
      ...validTopic,
      questions: [{
        ...validTopic.questions[0]!,
        choices: validTopic.questions[0]!.choices.map((choice) => ({ ...choice, isCorrect: false }))
      }]
    }).valid, false);
    assert.equal(validateTopicData({ ...validTopic, schemaVersion: 999, revision: 1 }).valid, false);
    assert.equal(validateTopicData({ ...validTopic, schemaVersion: 2 }).valid, false);
    assert.equal(validateTopicData({
      ...validTopic,
      concepts: [{ ...validTopic.concepts[0]!, sourceRefs: ["missing-source"] }]
    }).valid, false);

    // Interim MCP aliases are accepted only by normalizing to the app's canonical JSON contract.
    const aliasValidation = validateTopicData({
      ...validTopic,
      sources: [{ id: "legacy", title: "Legacy link", uri: "https://example.test/legacy" }],
      relationships: [{ id: "legacy-rel", fromConceptID: "bits", toConceptID: "bits", kind: "depends-on", description: "Legacy relation", sourceRefs: ["legacy"] }],
      questions: [{ ...validTopic.questions[0]!, kind: "explain-why", transferLevel: "understanding" }]
    });
    assert.equal(aliasValidation.valid, true);
    assert.equal(aliasValidation.topic!.sources![0]!.locator, "https://example.test/legacy");
    assert.equal((aliasValidation.topic!.sources![0] as Record<string, unknown>).uri, undefined);
    assert.equal(aliasValidation.topic!.relationships![0]!.sourceConceptID, "bits");
    assert.equal(aliasValidation.topic!.relationships![0]!.kind, "prerequisite");
    assert.equal(aliasValidation.topic!.questions[0]!.kind, "explain");
    assert.equal(aliasValidation.topic!.questions[0]!.transferLevel, "application");

    // The checked-in BLE fixture validates and survives a JSON round trip through the MCP schema.
    const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
    const bleFixturePath = path.resolve(testsDirectory, "..", "..", "RevemberKnowledge", "topics", "ble.json");
    const bleFixture = JSON.parse(await fs.readFile(bleFixturePath, "utf8")) as unknown;
    const fixtureValidation = validateTopicData(bleFixture, { expectedSlug: "ble" });
    assert.equal(fixtureValidation.valid, true, fixtureValidation.errors.join("; "));
    const fixtureRoundTrip = validateTopicData(JSON.parse(JSON.stringify(fixtureValidation.topic)), { expectedSlug: "ble" });
    assert.equal(fixtureRoundTrip.valid, true, fixtureRoundTrip.errors.join("; "));
    assert.equal(fixtureRoundTrip.topic!.relationships![0]!.sourceConceptID, "bits");
    assert.equal(fixtureRoundTrip.topic!.questions[0]!.kind, "multipleChoice");

    // Lexical path traversal is rejected for both topics and sessions.
    assert.throws(() => assertSafeSlug("../escape"));
    assert.throws(() => topicPath(config, "../escape"));
    assert.throws(() => sessionPath(config, "../../escape"));

    // A raw legacy file remains readable with implicit schema v1/revision 0.
    await fs.writeFile(topicPath(config, "ble"), `${JSON.stringify(validTopic, null, 2)}\n`, "utf8");
    assert.equal((await readTopic(config, "ble")).revision, undefined);

    const created = await createTopic(config, {
      slug: "firmware",
      title: "Firmware",
      summary: "C firmware fundamentals.",
      tags: ["c", "embedded"],
      expectedRevision: 0,
      sources: [{
        id: "c-standard",
        kind: "specification",
        title: "C language reference",
        locator: "https://example.test/c"
      }],
      concepts: [
        {
          title: "Pointers",
          body: "A pointer stores an address.",
          checks: [
            {
              question: "What does a pointer store?",
              choices: ["An address", "A protocol"],
              answerIndex: 0,
              explanation: "The value is an address."
            }
          ]
        }
      ],
      markdownBody: "# Firmware\n\nA local note."
    });
    assert.equal(created.topic.schemaVersion, 2);
    assert.equal(created.topic.revision, 1);
    assert.equal((await readTopic(config, "firmware")).questions.length, 1);
    assert.match(await readMarkdown(config, "firmware"), /local note/);
    await assert.rejects(
      createTopic(config, { slug: "new-topic", title: "New", summary: "New", concepts: [{ title: "One" }], expectedRevision: 2 }),
      /Revision conflict/
    );

    // Unknown top-level and nested fields survive the raw authoring path.
    const firmwarePath = topicPath(config, "firmware");
    const rawFirmware = JSON.parse(await fs.readFile(firmwarePath, "utf8")) as Record<string, unknown>;
    rawFirmware.futureMetadata = { plugin: "kept" };
    const rawConcepts = rawFirmware.concepts as Array<Record<string, unknown>>;
    rawConcepts[0]!.futureConceptField = { layout: 17 };
    const rawQuestions = rawFirmware.questions as Array<Record<string, unknown>>;
    rawQuestions[0]!.futureQuestionField = ["keep-me"];
    const rawChoices = rawQuestions[0]!.choices as Array<Record<string, unknown>>;
    rawChoices[0]!.futureChoiceField = { color: "cyan" };
    await fs.writeFile(firmwarePath, `${JSON.stringify(rawFirmware, null, 2)}\n`, "utf8");
    const bytesBeforeUpdate = await fs.readFile(firmwarePath);

    // Optimistic concurrency is enforced under simultaneous writers.
    const updated = await updateTopic(config, "firmware", { summary: "Updated firmware fundamentals." }, 1);
    assert.equal(updated.revision, 2);
    assert.ok(updated.backup);
    assert.deepEqual(await fs.readFile(updated.backup!), bytesBeforeUpdate);
    await assert.rejects(
      updateTopic(config, "firmware", { summary: "Stale write" }, 1),
      (error: unknown) => {
        const conflict = error as { code?: string; expectedRevision?: number; actualRevision?: number };
        assert.equal(conflict.code, "REVISION_CONFLICT");
        assert.equal(conflict.expectedRevision, 1);
        assert.equal(conflict.actualRevision, 2);
        return true;
      }
    );
    assert.equal((await readTopic(config, "firmware")).summary, "Updated firmware fundamentals.");

    const preserved = JSON.parse(await fs.readFile(firmwarePath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(preserved.futureMetadata, { plugin: "kept" });
    const preservedConcept = (preserved.concepts as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(preservedConcept.futureConceptField, { layout: 17 });
    const preservedQuestion = (preserved.questions as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(preservedQuestion.futureQuestionField, ["keep-me"]);
    const preservedChoice = (preservedQuestion.choices as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(preservedChoice.futureChoiceField, { color: "cyan" });

    // These are independent Node processes, not two promises sharing one lock map.
    const concurrent = await Promise.all([
      runTopicMutationWorker([root, firmwarePath, "firmware", "2", "Concurrent process A"]),
      runTopicMutationWorker([root, firmwarePath, "firmware", "2", "Concurrent process B"])
    ]);
    assert.equal(concurrent.filter((result) => result.code === 0).length, 1);
    assert.equal(concurrent.filter((result) => result.code === 2).length, 1);
    assert.match(concurrent.find((result) => result.code === 2)!.stderr, /Revision conflict/);
    assert.equal((await readTopic(config, "firmware")).revision, 3);
    await assert.rejects(updateTopic(config, "firmware", { revision: 99 }, 3), /server-managed/);

    const conceptResult = await upsertConcept(config, "firmware", {
      id: "memory",
      title: "Memory",
      firstPrinciples: "Memory stores distinguishable states.",
      explanation: "Addresses identify locations.",
      relatedTerms: ["address"],
      confusableTerms: ["pointer"],
      gapTags: ["memory-model"],
      sourceRefs: ["c-standard"]
    }, 3);
    assert.equal(conceptResult.created, true);
    assert.equal(conceptResult.revision, 4);

    // Invalid probes never advance or partially write the topic.
    await assert.rejects(upsertCard(config, "firmware", {
      id: "invalid-card",
      prompt: "Invalid?",
      explanation: "No correct answer.",
      choices: [
        { id: "a", text: "A", isCorrect: false },
        { id: "b", text: "B", isCorrect: false }
      ]
    }, 4), /exactly one correct choice/);
    assert.equal((await readTopic(config, "firmware")).revision, 4);

    const cardResult = await upsertCard(config, "firmware", {
      id: "pointer-transfer",
      prompt: "Which statement best explains pointer indirection?",
      difficulty: "hard",
      conceptIDs: ["pointers"],
      gapTags: ["memory-model"],
      kind: "explain-why",
      transferLevel: "transfer",
      sourceRefs: ["c-standard"],
      choices: [
        { id: "a", text: "The address selects another object.", isCorrect: true, rationale: "Address-to-object mapping is the key operation." },
        { id: "b", text: "The address is the object itself.", isCorrect: false, rationale: "Confuses an address with the addressed value.", misconceptionID: "address-is-value" }
      ],
      explanation: "Indirection follows an address to the referred object."
    }, 4);
    assert.equal(cardResult.created, true);
    assert.equal(cardResult.revision, 5);
    assert.equal((await readTopic(config, "firmware")).questions.find((question) => question.id === "pointer-transfer")!.revision, 1);

    const retired = await retireCard(config, "firmware", "pointers-check-1", "2026-07-09T00:00:00.000Z", 5);
    assert.equal(retired.revision, 6);
    const retiredQuestion = (await readTopic(config, "firmware")).questions[0]!;
    assert.equal(retiredQuestion.retiredAt, "2026-07-09T00:00:00.000Z");
    assert.equal(retiredQuestion.revision, 2);

    const metadata = await updateTopic(config, "firmware", {
      sources: [{ id: "c-standard", title: "C language reference", uri: "https://example.test/c" }],
      relationships: [{ id: "pointer-memory", fromConceptID: "pointers", toConceptID: "memory", kind: "depends-on", sourceRefs: ["c-standard"] }],
      gaps: [{
        id: "pointer-model",
        title: "Pointer model",
        tag: "memory-model",
        description: "Distinguish the address from the addressed value.",
        conceptIDs: ["pointers", "memory"],
        misconceptionIDs: ["address-is-value"],
        sourceRefs: ["c-standard"]
      }]
    }, 6);
    assert.equal(metadata.revision, 7);
    const canonicalDiskTopic = JSON.parse(await fs.readFile(firmwarePath, "utf8")) as Record<string, unknown>;
    const canonicalSource = (canonicalDiskTopic.sources as Array<Record<string, unknown>>)[0]!;
    assert.equal(canonicalSource.uri, undefined);
    assert.equal(canonicalSource.locator, "https://example.test/c");
    const canonicalRelationship = (canonicalDiskTopic.relationships as Array<Record<string, unknown>>)[0]!;
    assert.equal(canonicalRelationship.fromConceptID, undefined);
    assert.equal(canonicalRelationship.sourceConceptID, "pointers");
    assert.equal(canonicalRelationship.kind, "prerequisite");
    assert.deepEqual(canonicalDiskTopic.futureMetadata, { plugin: "kept" });

    const markdownUpdate = await updateMarkdownWithRevision(config, "firmware", "Appended note.", "append", 7);
    assert.equal(markdownUpdate.revision, 8);
    assert.match(await readMarkdown(config, "firmware"), /Appended note/);
    assert.equal((await validateTopicFile(config, "firmware")).valid, true);

    const topicSearch = await searchTopics(config, "address-is-value");
    assert.equal(topicSearch.length, 1);
    assert.equal(topicSearch[0]!.type, "topic");
    assert.ok(topicSearch[0]!.matchedFields.includes("choice.misconceptionID"));

    const captured = await captureLearningSession(config, {
      id: "firmware-session-1",
      capturedAt: "2026-07-09T08:00:00.000Z",
      title: "Pointer checkpoint",
      summary: "Separated pointer addresses from addressed values.",
      topicID: "firmware",
      confirmedConceptIDs: ["pointers"],
      misconceptionIDs: ["address-is-value"],
      openQuestions: ["How does pointer arithmetic scale?"],
      sourceRefs: ["c-standard"],
      notesMarkdown: "The learner can now explain one level of indirection.",
      checkpointMarkdown: "## Learning checkpoint\n\nAddress and value are distinct.",
      expectedRevision: 8
    });
    assert.equal(captured.session.revision, 1);
    assert.equal(captured.session.topicRevision, 9);
    assert.equal(captured.topicRevision, 9);
    assert.equal((await readTopic(config, "firmware")).revision, 9);
    assert.match(await readMarkdown(config, "firmware"), /Address and value are distinct/);
    assert.equal((await readLearningSession(config, "firmware-session-1")).topicID, "firmware");
    await assert.rejects(captureLearningSession(config, {
      id: "../session-escape", title: "No", summary: "No", expectedRevision: 0
    }), /Invalid session id/);

    // Two concurrent creates for the same standalone session cannot overwrite each other.
    const standaloneAttempts = await Promise.allSettled([
      captureLearningSession(config, { id: "standalone", title: "Standalone", summary: "One", expectedRevision: 0 }),
      captureLearningSession(config, { id: "standalone", title: "Standalone", summary: "Two", expectedRevision: 0 })
    ]);
    assert.equal(standaloneAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(standaloneAttempts.filter((result) => result.status === "rejected").length, 1);

    // Inject a post-session filesystem failure: the session must be removed and topic/note left unchanged.
    const backupNotes = path.join(config.backupsDir, "notes");
    const outside = await fs.mkdtemp(path.join(tmpdir(), "revember-outside-"));
    const noteBeforeRollback = await readMarkdown(config, "firmware");
    await fs.rm(backupNotes, { recursive: true, force: true });
    await fs.symlink(outside, backupNotes);
    await assert.rejects(captureLearningSession(config, {
      id: "rollback-session",
      title: "Rollback",
      summary: "Must not persist.",
      topicID: "firmware",
      checkpointMarkdown: "This must roll back.",
      expectedRevision: 9
    }), /outside configured knowledge root/);
    assert.equal(await fileExists(sessionPath(config, "rollback-session")), false);
    assert.equal((await readTopic(config, "firmware")).revision, 9);
    assert.equal(await readMarkdown(config, "firmware"), noteBeforeRollback);
    await fs.rm(backupNotes, { force: true });
    await fs.mkdir(backupNotes, { recursive: true });
    await fs.rm(outside, { recursive: true, force: true });

    // Exact app scheduler names plus legacy aggregates feed one learner brief.
    // Missing questionRevision is the legacy revision-1 contract. The explicit
    // correctness and misconception snapshot remain authoritative over choice lookup.
    const legacyRevisionSchedule = {
      schedulerVersion: "simple-v1",
      dueAt: "2026-07-08T09:00:00.000Z",
      intervalDays: 1,
      stability: 0.7,
      difficulty: 7,
      lastRating: "hard",
      lapses: 1,
      reviews: 1,
      lastReviewedAt: "2026-07-08T08:00:00.000Z"
    };
    const legacyRevisionEvent = {
      id: "11111111-1111-4111-8111-111111111111",
      topicID: "firmware",
      questionID: "pointer-transfer",
      choiceID: "a",
      isCorrect: false,
      rating: "hard",
      conceptIDs: ["pointers"],
      gapTags: ["memory-model"],
      misconceptionIDs: ["address-is-value"],
      reviewedAt: "2026-07-08T08:00:00.000Z"
    };
    const legacyRevisionProgress = {
      schemaVersion: 2,
      topics: {
        firmware: {
          attemptsByQuestionID: {
            "pointer-transfer": { attempts: 4, correctAttempts: 3, lastAnsweredAt: "2026-07-08T08:00:00.000Z" }
          },
          weakConceptIDs: { pointers: 1 },
          reviewCardsByQuestionID: {
            "pointer-transfer": legacyRevisionSchedule
          }
        },
        ble: {
          attemptsByQuestionID: {
            "bits-check-1": { attempts: 2, correctAttempts: 2, lastAnsweredAt: "2026-07-07T08:00:00.000Z" }
          }
        }
      },
      reviewEvents: [legacyRevisionEvent]
    };
    await fs.writeFile(config.progressPath, `${JSON.stringify(legacyRevisionProgress, null, 2)}\n`, "utf8");

    const brief = await getLearnerBrief(config, { now: "2026-07-09T00:00:00.000Z" });
    assert.equal(brief.progress.schemaVersion, 2);
    assert.equal(brief.progress.reviewEventCount, 1);
    assert.equal(brief.progress.hasV2Scheduler, true);
    assert.deepEqual(brief.progress.schedulerVersions, ["simple-v1"]);
    assert.equal(brief.progress.hasLegacyAttempts, true);
    const firmwareBrief = brief.topics.find((topic) => topic.id === "firmware")!;
    const firmwareCard = firmwareBrief.cards.find((card) => card.cardID === "pointer-transfer")!;
    assert.deepEqual(firmwareBrief.dueCardIDs, ["pointer-transfer"]);
    assert.equal(firmwareCard.questionRevision, 1);
    assert.equal(firmwareCard.schedulerVersion, "simple-v1");
    assert.equal(firmwareCard.attempts, 1);
    assert.equal(firmwareCard.correctAttempts, 0);
    assert.equal(firmwareCard.incorrectAttempts, 1);
    assert.equal(firmwareCard.staleAttempts, 0);
    assert.equal(firmwareCard.staleEvidence, false);
    assert.ok(firmwareBrief.weakConceptIDs.includes("pointers"));
    assert.ok(firmwareBrief.misconceptionIDs.includes("address-is-value"));
    assert.equal(firmwareBrief.gaps.find((gap) => gap.id === "pointer-model")!.status, "unresolved");
    const bleBrief = brief.topics.find((topic) => topic.id === "ble")!;
    assert.equal(bleBrief.attempts, 2);
    assert.equal(bleBrief.accuracy, 1);

    const sessionSearch = await searchSessions(config, "pointer arithmetic");
    assert.equal(sessionSearch[0]!.id, "firmware-session-1");
    const combinedSearch = await searchKnowledge(config, "pointer checkpoint");
    assert.ok(combinedSearch.some((result) => result.type === "session"));

    const revisedCard = await upsertCard(config, "firmware", {
      id: "pointer-transfer",
      explanation: "Indirection follows an address to a distinct referred object."
    }, 9);
    assert.equal(revisedCard.created, false);
    assert.equal(revisedCard.revision, 10);
    assert.equal((await readTopic(config, "firmware")).questions.find((question) => question.id === "pointer-transfer")!.revision, 2);

    // Revision-1 events, aggregates, and schedules stay visible as stale evidence,
    // but cannot make the newly authored revision tested, due, weak, or unresolved.
    const staleBrief = await getLearnerBrief(config, { topicID: "firmware", now: "2026-07-09T00:00:00.000Z" });
    const staleFirmware = staleBrief.topics[0]!;
    const staleCard = staleFirmware.cards.find((card) => card.cardID === "pointer-transfer")!;
    assert.equal(staleCard.questionRevision, 2);
    assert.equal(staleCard.attempts, 0);
    assert.equal(staleCard.correctAttempts, 0);
    assert.equal(staleCard.incorrectAttempts, 0);
    assert.equal(staleCard.staleAttempts, 1);
    assert.equal(staleCard.staleEvidence, true);
    assert.equal(staleCard.due, false);
    assert.equal(staleCard.dueAt, undefined);
    assert.equal(staleCard.lastReviewedAt, undefined);
    assert.ok(staleFirmware.untestedCardIDs.includes("pointer-transfer"));
    assert.ok(!staleFirmware.dueCardIDs.includes("pointer-transfer"));
    assert.ok(!staleFirmware.weakConceptIDs.includes("pointers"));
    assert.deepEqual(staleFirmware.misconceptionIDs, []);
    assert.equal(staleFirmware.gaps.find((gap) => gap.id === "pointer-model")!.status, "unobserved");
    assert.equal(staleFirmware.staleAttempts, 1);
    assert.equal(staleBrief.totals.staleAttempts, 1);

    // The plan uses revision-aware learner evidence, so a revised untested card
    // outranks a topic whose only signal is a legacy aggregate.
    const revisedPlan = await buildReviewPlan(config, 1, true, "2026-07-09T00:00:00.000Z");
    assert.equal(revisedPlan.plan[0]!.topic, "Firmware (firmware)");
    assert.deepEqual(revisedPlan.plan[0]!.untestedCardIDs, ["pointer-transfer"]);
    assert.deepEqual(revisedPlan.plan[0]!.revisedCardIDs, ["pointer-transfer"]);
    assert.match(revisedPlan.plan[0]!.reason, /fresh retrieval evidence/);

    const currentRevisionProgress = {
      ...legacyRevisionProgress,
      topics: {
        ...legacyRevisionProgress.topics,
        firmware: {
          ...legacyRevisionProgress.topics.firmware,
          reviewCardsByQuestionID: {
            "pointer-transfer": {
              ...legacyRevisionSchedule,
              questionRevision: 2,
              dueAt: "2026-07-08T10:00:00.000Z",
              lastReviewedAt: "2026-07-08T09:00:00.000Z"
            }
          }
        }
      },
      reviewEvents: [
        legacyRevisionEvent,
        {
          ...legacyRevisionEvent,
          id: "22222222-2222-4222-8222-222222222222",
          questionRevision: 2,
          reviewedAt: "2026-07-08T09:00:00.000Z"
        }
      ]
    };
    await fs.writeFile(config.progressPath, `${JSON.stringify(currentRevisionProgress, null, 2)}\n`, "utf8");

    const restoredBrief = await getLearnerBrief(config, { topicID: "firmware", now: "2026-07-09T00:00:00.000Z" });
    const restoredFirmware = restoredBrief.topics[0]!;
    const restoredCard = restoredFirmware.cards.find((card) => card.cardID === "pointer-transfer")!;
    assert.equal(restoredCard.questionRevision, 2);
    assert.equal(restoredCard.schedulerVersion, "simple-v1");
    assert.equal(restoredCard.attempts, 1);
    assert.equal(restoredCard.correctAttempts, 0);
    assert.equal(restoredCard.incorrectAttempts, 1);
    assert.equal(restoredCard.staleAttempts, 1);
    assert.equal(restoredCard.staleEvidence, true);
    assert.equal(restoredCard.due, true);
    assert.deepEqual(restoredFirmware.dueCardIDs, ["pointer-transfer"]);
    assert.ok(!restoredFirmware.untestedCardIDs.includes("pointer-transfer"));
    assert.ok(restoredFirmware.weakConceptIDs.includes("pointers"));
    assert.deepEqual(restoredFirmware.misconceptionIDs, ["address-is-value"]);
    assert.equal(restoredFirmware.gaps.find((gap) => gap.id === "pointer-model")!.status, "unresolved");
    assert.equal(restoredBrief.totals.attempts, 1);
    assert.equal(restoredBrief.totals.staleAttempts, 1);

    // A v2 schedule due now takes precedence over a lower-attempt legacy topic.
    const duePlan = await buildReviewPlan(config, 1, true, "2026-07-09T00:00:00.000Z");
    assert.equal(duePlan.plan[0]!.topic, "Firmware (firmware)");
    assert.deepEqual(duePlan.plan[0]!.dueCardIDs, ["pointer-transfer"]);
    assert.match(duePlan.plan[0]!.reason, /due now/);

    await assert.rejects(
      upsertCard(config, "firmware", { id: "pointer-transfer", revision: 99 }, 10),
      /server-managed/
    );
    await assert.rejects(
      updateTopic(config, "firmware", { questions: [] }, 10),
      /Card revisions are server-managed/
    );

    const knowledgeValidation = await validateKnowledgeBase(config);
    assert.equal(knowledgeValidation.valid, true);
    assert.equal(knowledgeValidation.counts.topics, 2);
    assert.equal(knowledgeValidation.counts.sessions, 2);

    await fs.writeFile(sessionPath(config, "broken"), "{not json\n", "utf8");
    const brokenValidation = await validateKnowledgeBase(config);
    assert.equal(brokenValidation.valid, false);
    assert.match(brokenValidation.errors.join(" "), /Malformed JSON/);

    // Low-level Markdown helper remains backward compatible for internal callers.
    await writeMarkdown(config, "firmware", "Direct helper append.", "append");
    assert.match(await readMarkdown(config, "firmware"), /Direct helper append/);

    console.log("All Revember MCP tests passed (schema, concurrency, rollback, path safety, learner brief, validation). ");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
