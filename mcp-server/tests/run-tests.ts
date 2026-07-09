import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RevemberConfig } from "../src/config.js";
import { assertSafeSlug, ensureKnowledgeDirs, topicPath } from "../src/paths.js";
import { validateTopicData } from "../src/schema.js";
import { createTopic, readMarkdown, readTopic, updateTopic, validateTopicFile, writeMarkdown } from "../src/topics.js";
import { searchTopics } from "../src/search.js";

function makeConfig(root: string): RevemberConfig {
  return {
    packageRoot: path.dirname(root),
    knowledgeRoot: root,
    topicsDir: path.join(root, "topics"),
    notesDir: path.join(root, "notes"),
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

async function run(): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-mcp-"));
  const config = makeConfig(root);

  try {
    await ensureKnowledgeDirs(config);

    assert.equal(validateTopicData(validTopic).valid, true);
    assert.equal(
      validateTopicData({
        ...validTopic,
        questions: [
          {
            ...validTopic.questions[0]!,
            choices: validTopic.questions[0]!.choices.map((choice) => ({ ...choice, isCorrect: false }))
          }
        ]
      }).valid,
      false
    );

    assert.throws(() => assertSafeSlug("../escape"));
    assert.throws(() => topicPath(config, "../escape"));

    const created = await createTopic(config, {
      slug: "firmware",
      title: "Firmware",
      summary: "C firmware fundamentals.",
      tags: ["c", "embedded"],
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

    assert.equal(created.topic.id, "firmware");
    assert.equal((await readTopic(config, "firmware")).questions.length, 1);
    assert.match(await readMarkdown(config, "firmware"), /local note/);

    const updated = await updateTopic(config, "firmware", {
      summary: "Updated firmware fundamentals."
    });
    assert.equal(updated.topic.summary, "Updated firmware fundamentals.");
    assert.ok(updated.backup);
    assert.equal((await validateTopicFile(config, "firmware")).valid, true);

    await writeMarkdown(config, "firmware", "Appended note.", "append");
    assert.match(await readMarkdown(config, "firmware"), /Appended note/);

    const results = await searchTopics(config, "pointer");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "firmware");

    console.log("All Revember MCP tests passed.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
