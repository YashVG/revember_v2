import { describe, expect, it } from "vitest";
import type { Question } from "../shared/types";
import {
  buildExistingCardEdit,
  fillGeneratedDistractors,
  storedPromptForCard,
  type CardForm
} from "../src/renderer/src/components/CardWorkspace";

describe("existing card edits", () => {
  it("fills only empty distractor slots with locally generated suggestions", () => {
    expect(fillGeneratedDistractors([
      { id: "choice-distractor-1", text: "A packet" },
      { id: "choice-distractor-2", text: "" }
    ], ["A protocol", "A byte", "A physical state"], "A physical state")).toEqual([
      { id: "choice-distractor-1", text: "A packet" },
      { id: "choice-distractor-2", text: "A protocol" },
      { id: "choice-distractor-3", text: "A byte" }
    ]);
  });

  it("changes visible fields without downgrading rich question metadata", () => {
    const richQuestion = {
      id: "diagnose-state",
      revision: 4,
      kind: "debug",
      transferLevel: "transfer",
      prompt: "Why does the receiver decode the wrong state?",
      difficulty: "hard",
      conceptIDs: ["signal", "protocol"],
      gapTags: ["state transition", "protocol/schema"],
      sourceRefs: ["source:chapter/1"],
      choices: [
        {
          id: "noise",
          text: "Noise crossed the decision threshold",
          isCorrect: true,
          rationale: "The decoder maps measured state to a bit.",
          diagnosticWeight: 2
        },
        {
          id: "packet",
          text: "A packet always changes the bit",
          isCorrect: false,
          rationale: "Packets carry bits; they do not redefine them.",
          misconceptionID: "bit-packet-confusion",
          diagnosticWeight: 1
        }
      ],
      explanation: "The measured signal crossed the receiver's threshold.",
      futureQuestion: { retained: true }
    } as Question;
    const form: CardForm = {
      sentence: richQuestion.prompt,
      answer: "Noise exceeded the receiver threshold",
      distractors: [{ id: "packet", text: "A packet always changes state" }],
      explanation: "The updated measurement crossed the receiver's threshold."
    };

    const initial: CardForm = {
      sentence: richQuestion.prompt,
      answer: "Noise crossed the decision threshold",
      distractors: [{ id: "packet", text: "A packet always changes the bit" }],
      explanation: richQuestion.explanation
    };
    const edit = buildExistingCardEdit(
      richQuestion,
      initial,
      form,
      "Why did the receiver decode the wrong state?"
    );

    expect(edit!).toMatchObject({
      kind: "debug",
      transferLevel: "transfer",
      prompt: "Why did the receiver decode the wrong state?",
      difficulty: "hard",
      conceptIDs: ["signal", "protocol"],
      gapTags: ["state transition", "protocol/schema"],
      sourceRefs: ["source:chapter/1"],
      explanation: "The updated measurement crossed the receiver's threshold."
    });
    expect(edit!.choices).toEqual([
      {
        id: "noise",
        text: "Noise exceeded the receiver threshold",
        isCorrect: true,
        rationale: "The decoder maps measured state to a bit.",
        diagnosticWeight: 2
      },
      {
        id: "packet",
        text: "A packet always changes state",
        isCorrect: false,
        rationale: "Packets carry bits; they do not redefine them.",
        misconceptionID: "bit-packet-confusion",
        diagnosticWeight: 1
      }
    ]);
  });

  it("does not produce an edit payload when visible values are unchanged", () => {
    const question = {
      id: "no-op",
      revision: 3,
      kind: "multipleChoice",
      transferLevel: "recall",
      prompt: "Which answer is correct?",
      difficulty: "intro",
      conceptIDs: ["bit"],
      gapTags: ["definition"],
      sourceRefs: ["source:chapter/1"],
      choices: [
        { id: "yes", text: "A bit", isCorrect: true, rationale: "Correct." },
        { id: "no", text: "A packet", isCorrect: false, misconceptionID: "bit-packet" }
      ],
      explanation: "A bit is the answer."
    } satisfies Question;
    const unchanged: CardForm = {
      sentence: question.prompt,
      answer: "A bit",
      distractors: [{ id: "no", text: "A packet" }],
      explanation: question.explanation
    };

    expect(buildExistingCardEdit(question, unchanged, unchanged, question.prompt)).toBeUndefined();
  });

  it("keeps non-cloze prompts non-cloze when they contain the answer text", () => {
    const question = {
      id: "non-cloze",
      revision: 1,
      kind: "explain",
      transferLevel: "application",
      prompt: "Why is a bit the smallest distinguishable state?",
      difficulty: "medium",
      conceptIDs: ["bit"],
      gapTags: [],
      sourceRefs: [],
      choices: [
        { id: "bit", text: "a bit", isCorrect: true },
        { id: "packet", text: "a packet", isCorrect: false }
      ],
      explanation: "Explanation"
    } satisfies Question;

    expect(storedPromptForCard(question, question.prompt, "a bit")).toBe(question.prompt);
    expect(storedPromptForCard(question, "Why does a bit encode a state?", "a bit"))
      .toBe("Why does a bit encode a state?");
  });

  it("regenerates the blank when an existing cloze sentence is edited", () => {
    const question = {
      id: "cloze",
      revision: 2,
      kind: "multipleChoice",
      transferLevel: "recall",
      prompt: "A bit is ________.",
      difficulty: "intro",
      conceptIDs: ["bit"],
      gapTags: [],
      sourceRefs: [],
      choices: [
        { id: "state", text: "a distinguishable state", isCorrect: true },
        { id: "packet", text: "a packet", isCorrect: false }
      ],
      explanation: "Explanation"
    } satisfies Question;

    expect(storedPromptForCard(question, "A bit represents a binary state.", "a binary state"))
      .toBe("A bit represents ________.");
  });
});
