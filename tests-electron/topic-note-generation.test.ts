import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import type { DistractorModelInput, LocalNoteModel, TopicNoteModelInput } from "../electron/ollama-note-model";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-topic-note-"));
  roots.push(root);
  const knowledgeRoot = path.join(root, "knowledge");
  const topicsDirectory = path.join(knowledgeRoot, "topics");
  const progressPath = path.join(root, "state", "progress.json");
  const settingsPath = path.join(root, "settings.json");
  await fs.mkdir(topicsDirectory, { recursive: true });
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(path.join(topicsDirectory, "bits.json"), JSON.stringify({
    schemaVersion: 2,
    revision: 1,
    id: "bits",
    title: "Bits",
    summary: "Information begins with distinguishable physical states.",
    sources: [],
    relationships: [],
    concepts: [{
      id: "bit",
      title: "Bit",
      firstPrinciples: "A bit is a distinguishable physical state.",
      explanation: "Software interprets that state as zero or one.",
      relatedTerms: [],
      confusableTerms: [],
      gapTags: [],
      sourceRefs: []
    }],
    gaps: [],
    questions: [{
      id: "what-is-a-bit",
      revision: 1,
      kind: "multipleChoice",
      transferLevel: "recall",
      prompt: "What is a bit?",
      difficulty: "intro",
      conceptIDs: ["bit"],
      gapTags: [],
      sourceRefs: [],
      choices: [{ id: "state", text: "A distinguishable state", isCorrect: true }, { id: "packet", text: "A packet", isCorrect: false }],
      explanation: "A bit is a physical distinction that software interprets."
    }]
  }, null, 2) + "\n");
  await fs.writeFile(progressPath, JSON.stringify({ schemaVersion: 2, topics: {}, reviewEvents: [] }) + "\n");
  await fs.writeFile(settingsPath, JSON.stringify({ knowledgeRootPath: knowledgeRoot, progressPath, notificationsEnabled: false }));
  return { root, knowledgeRoot, progressPath, settingsPath };
}

describe("topic AI-note generation", () => {
  it("creates one explicitly tagged local note from the selected topic", async () => {
    const { knowledgeRoot, progressPath, settingsPath } = await fixture();
    const calls: TopicNoteModelInput[] = [];
    const model: LocalNoteModel = {
      generateTopicNote: async (input) => {
        calls.push(input);
        return {
          title: "Bits — AI study note",
          rawText: "A bit begins as a physical distinction. Software can interpret it as zero or one."
        };
      }
    };
    const state = new RevemberState({ settingsPath, bundledKnowledgeRoot: knowledgeRoot, legacyProgressPath: progressPath }, model);
    try {
      const [first, second] = await Promise.all([state.generateTopicNote("bits"), state.generateTopicNote("bits")]);

      expect(first).toEqual(second);
      expect(first).toMatchObject({ topicID: "bits", origin: "ollama", status: "ready" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.topicContext).toContain("A bit is a distinguishable physical state.");
      expect(calls[0]?.topicContext).toContain("What is a bit?");
      expect(state.listCaptureSummaries()).toMatchObject([{
        id: first.id,
        topicID: "bits",
        origin: "ollama",
        status: "ready"
      }]);
      await expect(state.generateTopicNote("missing")).rejects.toThrow(/selected topic/i);
    } finally {
      state.dispose();
    }
  });

  it("generates editable distractors from the selected topic without mutating it", async () => {
    const { knowledgeRoot, progressPath, settingsPath } = await fixture();
    const calls: DistractorModelInput[] = [];
    const model: LocalNoteModel = {
      generateDistractors: async (input) => {
        calls.push(input);
        return ["A packet", "A protocol", "A byte"];
      }
    };
    const state = new RevemberState({ settingsPath, bundledKnowledgeRoot: knowledgeRoot, legacyProgressPath: progressPath }, model);
    try {
      await expect(state.generateDistractors({
        topicID: "bits",
        sentence: "A bit is a distinguishable physical state.",
        answer: "A distinguishable physical state",
        conceptID: "bit"
      })).resolves.toEqual(["A packet", "A protocol", "A byte"]);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        topicTitle: "Bits",
        conceptTitle: "Bit",
        sentence: "A bit is a distinguishable physical state.",
        answer: "A distinguishable physical state"
      });
      expect(calls[0]?.topicContext).toContain("A bit is a distinguishable physical state.");
      expect(state.snapshot.topics[0]?.questions).toHaveLength(1);
      await expect(state.generateDistractors({
        topicID: "bits",
        sentence: "A bit is a distinguishable physical state.",
        answer: "A distinguishable physical state",
        conceptID: "missing"
      })).rejects.toThrow(/concept/i);
    } finally {
      state.dispose();
    }
  });
});
