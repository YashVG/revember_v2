import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTopicCard, editTopicCard, mutateElectronTopic, retireTopicCard } from "../electron/topic-authoring";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-electron-topic-"));
  roots.push(root);
  const topics = path.join(root, "topics");
  await fs.mkdir(topics, { recursive: true });
  const topicPath = path.join(topics, "bits.json");
  const topic = {
    schemaVersion: 2,
    revision: 1,
    id: "bits",
    title: "Bits",
    summary: "Original summary.",
    futureTopLevel: { retained: true },
    sources: [{ id: "source:chapter/1", kind: "note", title: "Chapter 1" }],
    concepts: [{
      id: "bit",
      title: "Bit",
      firstPrinciples: "A bit is a distinguishable state.",
      explanation: "Protocols assign meaning to states.",
      relatedTerms: [],
      confusableTerms: [],
      gapTags: [],
      futureConcept: { x: 1 }
    }],
    gaps: [],
    questions: [{
      id: "bit-check",
      revision: 1,
      prompt: "What is a bit?",
      difficulty: "intro",
      conceptIDs: ["bit"],
      gapTags: [],
      choices: [
        { id: "a", text: "A distinguishable state", isCorrect: true, futureChoice: "kept" },
        { id: "b", text: "A whole packet", isCorrect: false }
      ],
      explanation: "It is the smallest distinguishable state here.",
      futureQuestion: [1, 2, 3]
    }]
  };
  await fs.writeFile(topicPath, JSON.stringify(topic, null, 2) + "\n", "utf8");
  return { root, topicPath };
}

describe("Electron topic authoring adapter", () => {
  it("preserves raw unknown fields and rejects stale or invalid writes", async () => {
    const { root, topicPath } = await fixture();
    const result = await mutateElectronTopic({
      knowledgeRootPath: root,
      topicID: "bits",
      expectedRevision: 1,
      transform: (topic) => ({ ...topic, summary: "Updated summary." })
    });
    expect(result.revision).toBe(2);
    await expect(fs.stat(result.backupPath)).resolves.toBeDefined();

    const written = JSON.parse(await fs.readFile(topicPath, "utf8"));
    expect(written.futureTopLevel).toEqual({ retained: true });
    expect(written.concepts[0].futureConcept).toEqual({ x: 1 });
    expect(written.questions[0].futureQuestion).toEqual([1, 2, 3]);
    expect(written.questions[0].choices[0].futureChoice).toBe("kept");

    await expect(mutateElectronTopic({
      knowledgeRootPath: root,
      topicID: "bits",
      expectedRevision: 1,
      transform: (topic) => ({ ...topic, summary: "Stale." })
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT", actualRevision: 2 });

    const beforeInvalid = await fs.readFile(topicPath, "utf8");
    await expect(mutateElectronTopic({
      knowledgeRootPath: root,
      topicID: "bits",
      expectedRevision: 2,
      transform: (topic) => ({
        ...topic,
        questions: (topic.questions as Array<Record<string, unknown>>).map((question) => ({
          ...question,
          choices: (question.choices as Array<Record<string, unknown>>).map((choice) => ({ ...choice, isCorrect: false }))
        }))
      })
    })).rejects.toThrow(/exactly one correct choice/i);
    expect(await fs.readFile(topicPath, "utf8")).toBe(beforeInvalid);
  });

  it("creates, edits, and retires cards with server-managed revisions and stable choice IDs", async () => {
    const { root, topicPath } = await fixture();
    const create = await createTopicCard(root, {
      topicID: "bits",
      expectedTopicRevision: 1,
      card: {
        id: "bit-application",
        kind: "predict",
        transferLevel: "application",
        prompt: "What changes when a bit flips?",
        difficulty: "medium",
        conceptIDs: ["bit"],
        gapTags: ["state transition", "protocol/schema"],
        sourceRefs: ["source:chapter/1"],
        choices: [
          { id: "meaning", text: "The represented state changes", isCorrect: true },
          { id: "packet", text: "A packet is created", isCorrect: false, misconceptionID: "bit-packet-confusion" }
        ],
        explanation: "A bit flip changes the represented state."
      }
    });
    expect(create.revision).toBe(2);
    let written = JSON.parse(await fs.readFile(topicPath, "utf8"));
    expect(written.questions.at(-1)).toMatchObject({ id: "bit-application", revision: 1 });

    const edit = await editTopicCard(root, {
      topicID: "bits",
      expectedTopicRevision: 2,
      questionID: "bit-application",
      expectedQuestionRevision: 1,
      card: {
        kind: "predict",
        transferLevel: "application",
        prompt: "What changes when the encoded bit flips?",
        difficulty: "medium",
        conceptIDs: ["bit"],
        gapTags: ["state transition", "protocol/schema"],
        sourceRefs: ["source:chapter/1"],
        choices: [
          { id: "meaning", text: "The represented state changes", isCorrect: true },
          { id: "packet", text: "A packet is created", isCorrect: false, misconceptionID: "bit-packet-confusion" }
        ],
        explanation: "The physical state now encodes the other bit value."
      }
    });
    expect(edit.revision).toBe(3);
    written = JSON.parse(await fs.readFile(topicPath, "utf8"));
    expect(written.questions.at(-1)).toMatchObject({
      id: "bit-application",
      revision: 2,
      prompt: "What changes when the encoded bit flips?"
    });
    expect(written.questions.at(-1).choices.map((choice: { id: string }) => choice.id)).toEqual(["meaning", "packet"]);

    await expect(editTopicCard(root, {
      topicID: "bits",
      expectedTopicRevision: 3,
      questionID: "bit-application",
      expectedQuestionRevision: 2,
      card: {
        kind: "predict", transferLevel: "application", prompt: "Changed", difficulty: "medium",
        conceptIDs: ["bit"], gapTags: [], sourceRefs: [], explanation: "Changed",
        choices: [{ id: "replacement", text: "Yes", isCorrect: true }, { id: "packet", text: "No", isCorrect: false }]
      }
    })).rejects.toThrow(/preserve all existing choice IDs/i);

    const retire = await retireTopicCard(root, {
      topicID: "bits",
      expectedTopicRevision: 3,
      questionID: "bit-application",
      expectedQuestionRevision: 2
    }, new Date("2026-03-01T12:00:00.000Z"));
    expect(retire.revision).toBe(4);
    written = JSON.parse(await fs.readFile(topicPath, "utf8"));
    expect(written.questions.at(-1)).toMatchObject({ revision: 3, retiredAt: "2026-03-01T12:00:00.000Z" });

    await expect(retireTopicCard(root, {
      topicID: "bits", expectedTopicRevision: 3, questionID: "bit-application", expectedQuestionRevision: 2
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT", actualRevision: 4 });
  });

  it("runtime-validates card shapes and true concept/source references", async () => {
    const { root } = await fixture();
    const base = {
      id: "invalid-ref", kind: "multipleChoice", transferLevel: "recall", prompt: "Prompt", difficulty: "intro",
      conceptIDs: ["missing-concept"], gapTags: ["free-taxonomy-label"], sourceRefs: [], explanation: "Explanation",
      choices: [{ id: "yes", text: "Yes", isCorrect: true }, { id: "no", text: "No", isCorrect: false, misconceptionID: "free-taxonomy-id" }]
    };
    await expect(createTopicCard(root, { topicID: "bits", expectedTopicRevision: 1, card: base }))
      .rejects.toThrow(/missing concept/i);
    await expect(createTopicCard(root, {
      topicID: "bits", expectedTopicRevision: 1, card: { ...base, conceptIDs: ["bit"], sourceRefs: ["missing-source"] }
    })).rejects.toThrow(/missing source/i);
    await expect(createTopicCard(root, {
      topicID: "bits", expectedTopicRevision: 1, card: { ...base, conceptIDs: ["bit"], sourceRefs: [], choices: [{ id: "yes", text: "Yes", isCorrect: "true" }, { id: "no", text: "No", isCorrect: false }] }
    })).rejects.toThrow(/isCorrect must be a boolean/i);
    await expect(createTopicCard(root, {
      topicID: "bits",
      expectedTopicRevision: 1,
      card: {
        ...base,
        conceptIDs: ["bit"],
        choices: [
          { id: "a", text: "A", isCorrect: true },
          { id: "b", text: "B", isCorrect: false },
          { id: "c", text: "C", isCorrect: false },
          { id: "d", text: "D", isCorrect: false },
          { id: "e", text: "E", isCorrect: false }
        ]
      }
    })).rejects.toThrow(/two to four choices/i);
  });
});
