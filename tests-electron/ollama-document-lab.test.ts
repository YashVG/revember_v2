import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OllamaNoteModel,
  OllamaResponseError,
  type GenerateDocumentNotesInput
} from "../electron/ollama-note-model";

interface DocumentRequestBody {
  model: string;
  stream: boolean;
  think: boolean;
  keep_alive: number;
  system: string;
  format: {
    additionalProperties: boolean;
    properties: Record<string, { items: { additionalProperties: boolean } }>;
  };
  options: {
    temperature: number;
    num_ctx: number;
    num_predict: number;
  };
  prompt: string;
}

interface DocumentPrompt {
  title: string;
  studyGoals: string[];
  sourceBlocks: Array<{ id: string; text: string }>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ollama Document Lab generation", () => {
  it("returns grounded memory notes through a closed schema", async () => {
    let request: DocumentRequestBody | undefined;
    const model = new OllamaNoteModel(async (_input, init) => {
      const body = requestBody(init);
      request = body;
      return ollamaResponse({
        sections: [{
          title: "Bits",
          bullets: [{ text: "A bit represents one of two physical states.", sourceBlockIDs: ["source-a"] }]
        }]
      });
    });

    const result = await model.generateDocumentNotes(inputFixture(), new AbortController().signal);

    expect(result.sections[0]?.bullets[0]?.sourceBlockIDs).toEqual(["source-a"]);
    expect(request?.model).toBe("llama3");
    expect(request?.stream).toBe(false);
    expect(request?.think).toBe(false);
    expect(request?.options).toMatchObject({ temperature: 0, num_ctx: 8_192 });
    expect(request?.system).toContain("source block IDs");
    expect(request?.system).toContain("short, direct sentences");
    expect(request?.system).toContain("course logistics");
    expect(request?.system).toContain("empty sections array");
    expect(request?.format.additionalProperties).toBe(false);
    expect(request?.format.properties.sections?.items.additionalProperties).toBe(false);
  });

  it.each([
    {
      label: "unknown evidence",
      generated: {
        sections: [{ title: "Bits", bullets: [{ text: "Two states.", sourceBlockIDs: ["unknown"] }] }]
      },
      message: /unknown source id/i
    },
    {
      label: "extra fields",
      generated: {
        sections: [{
          title: "Bits",
          bullets: [{ text: "Two states.", sourceBlockIDs: ["source-a"], invented: true }]
        }]
      },
      message: /invalid document section 1 bullet 1/i
    }
  ])("rejects $label", async ({ generated, message }) => {
    const model = new OllamaNoteModel(async () => ollamaResponse(generated));
    const generation = model.generateDocumentNotes(inputFixture(), new AbortController().signal);

    await expect(generation).rejects.toBeInstanceOf(OllamaResponseError);
    await expect(generation).rejects.toThrow(message);
  });

  it("processes long documents in ordered windows without dropping source blocks", async () => {
    const sourceBlocks = Array.from({ length: 50 }, (_, index) => ({
      id: `source-${index + 1}`,
      text: `Source ${index + 1} contains a useful fact. ${"x".repeat(500)}`
    }));
    const prompts: DocumentPrompt[] = [];
    const model = new OllamaNoteModel(async (_input, init) => {
      const body = requestBody(init);
      const prompt = JSON.parse(body.prompt) as DocumentPrompt;
      prompts.push(prompt);
      if (prompts.length === 1) return ollamaResponse({ sections: [] });
      const first = prompt.sourceBlocks[0]!;
      return ollamaResponse({
        sections: [{
          title: `Part ${prompts.length}`,
          bullets: [{ text: first.text.match(/^[^.]+\./u)![0], sourceBlockIDs: [first.id] }]
        }]
      });
    });

    const result = await model.generateDocumentNotes({ title: "Long lecture", sourceBlocks }, new AbortController().signal);

    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts.flatMap(({ sourceBlocks: blocks }) => blocks)).toEqual(sourceBlocks);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections.length).toBeLessThanOrEqual(prompts.length - 1);
  });

  it("rejects a document with no educational content", async () => {
    const model = new OllamaNoteModel(async () => ollamaResponse({ sections: [] }));

    await expect(model.generateDocumentNotes(inputFixture(), new AbortController().signal))
      .rejects.toThrow("No study content found");
  });

  it("drops unsupported candidates and keeps exact source notes", async () => {
    const model = new OllamaNoteModel(async () => ollamaResponse({
      sections: [{
        title: "Bits",
        bullets: [
          { text: "A bit is always stored in a transistor.", sourceBlockIDs: ["source-a"] },
          { text: "Eight bits form one byte.", sourceBlockIDs: ["source-b"] }
        ]
      }]
    }));

    const result = await model.generateDocumentNotes(inputFixture(), new AbortController().signal);

    expect(result.sections[0]?.bullets).toEqual([{
      text: "Eight bits form one byte.",
      sourceBlockIDs: ["source-b"]
    }]);
  });

  it("adds exact source coverage for a supported study goal the model skipped", async () => {
    const model = new OllamaNoteModel(async () => ollamaResponse({
      sections: [{
        title: "Universal machines",
        bullets: [{
          text: "A universal machine can imitate any Turing machine.",
          sourceBlockIDs: ["page-2"]
        }]
      }]
    }));
    const result = await model.generateDocumentNotes({
      title: "Turing machines",
      studyGoals: ["Define a Turing machine and a universal Turing machine."],
      sourceBlocks: [{
        id: "page-1",
        text: "Turing machine\nThe tape has no length limit. The tape can move left or right."
      }, {
        id: "page-2",
        text: "Universal machine\nA universal machine can imitate any Turing machine."
      }]
    }, new AbortController().signal);

    expect(result.sections.find(({ title }) => title === "Turing machine")?.bullets.length)
      .toBeGreaterThan(0);
  });

  it("keeps conclusions instead of hypothetical branches on discussion slides", async () => {
    const model = new OllamaNoteModel(async () => ollamaResponse({
      sections: [{
        title: "Brain",
        bullets: [{
          text: "If the answer is yes, there is no need for further argument.",
          sourceBlockIDs: ["page-1"]
        }]
      }]
    }));
    const result = await model.generateDocumentNotes({
      title: "Computation",
      studyGoals: ["Is the brain a computer?"],
      sourceBlocks: [{
        id: "page-1",
        text: [
          "Is the Brain a Computer?",
          "If the answer is yes, there is no need for further argument.",
          "The lecture concludes that brain processes can be described in computable terms."
        ].join("\n")
      }]
    }, new AbortController().signal);

    const notes = result.sections.flatMap(({ bullets }) => bullets.map(({ text }) => text));
    expect(notes.some((text) => /^if\b/iu.test(text))).toBe(false);
    expect(notes).toContain("The lecture concludes that brain processes can be described in computable terms.");
  });
});

function inputFixture(): GenerateDocumentNotesInput {
  return {
    title: "Binary",
    sourceBlocks: [
      { id: "source-a", text: "A bit represents one of two physical states." },
      { id: "source-b", text: "Eight bits form one byte." }
    ]
  };
}

function requestBody(init: RequestInit | undefined): DocumentRequestBody {
  if (typeof init?.body !== "string") throw new Error("Expected an Ollama JSON body.");
  return JSON.parse(init.body) as DocumentRequestBody;
}

function ollamaResponse(generated: unknown): Response {
  return new Response(JSON.stringify({ response: JSON.stringify(generated) }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
