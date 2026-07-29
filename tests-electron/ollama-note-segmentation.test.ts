import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OllamaNoteModel,
  OllamaResponseError,
  type SegmentNoteModelInput
} from "../electron/ollama-note-model";

interface OllamaRequestBody {
  model: string;
  stream: boolean;
  think: boolean;
  keep_alive: number;
  system: string;
  format: {
    additionalProperties: boolean;
    properties: {
      chunks: {
        items: {
          additionalProperties: boolean;
          properties: Record<string, unknown>;
        };
      };
    };
  };
  options: {
    temperature: number;
    num_ctx: number;
    num_predict: number;
  };
  prompt: string;
}

interface SegmentationPrompt {
  title?: string;
  sourceBlocks: Array<{ id: string; text: string }>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function requestBody(init: RequestInit | undefined): OllamaRequestBody {
  if (typeof init?.body !== "string") throw new Error("Expected an Ollama JSON request body.");
  return JSON.parse(init.body) as OllamaRequestBody;
}

function segmentationPrompt(body: OllamaRequestBody): SegmentationPrompt {
  return JSON.parse(body.prompt) as SegmentationPrompt;
}

function ollamaResponse(generated: unknown): Response {
  return new Response(JSON.stringify({
    response: JSON.stringify(generated)
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function threeBlockInput(): SegmentNoteModelInput {
  return {
    title: "Binary foundations",
    sourceBlocks: [
      { id: "B0001", text: "A bit represents a distinguishable state.\n\n" },
      { id: "B0002", text: "Eight bits make one byte.\n\n" },
      { id: "B0003", text: "A byte has 256 possible bit patterns." }
    ]
  };
}

describe("Ollama semantic note segmentation", () => {
  it("processes every exact block across multiple context-safe requests and preserves ordered IDs", async () => {
    const sourceBlocks = Array.from({ length: 50 }, (_, index) => ({
      id: `B${String(index + 1).padStart(4, "0")}`,
      text: `Exact source block ${index + 1}: ${"x".repeat(520)}\n`
    }));
    const requests: OllamaRequestBody[] = [];
    const model = new OllamaNoteModel(async (_input, init) => {
      const body = requestBody(init);
      const prompt = segmentationPrompt(body);
      requests.push(body);
      return ollamaResponse({
        chunks: [{
          title: `Window ${requests.length}`,
          sourceBlockIDs: prompt.sourceBlocks.map(({ id }) => id)
        }]
      });
    });

    const result = await model.segmentNote({
      title: "A note much longer than the enrichment source cap",
      sourceBlocks
    }, new AbortController().signal);

    const sentBlocks = requests.flatMap((body) => segmentationPrompt(body).sourceBlocks);
    const expectedIDs = sourceBlocks.map(({ id }) => id);
    expect(sourceBlocks.reduce((total, block) => total + block.text.length, 0)).toBeGreaterThan(12_000);
    expect(requests.length).toBeGreaterThan(1);
    expect(sentBlocks).toEqual(sourceBlocks);
    expect(result.chunks.flatMap(({ sourceBlockIDs }) => sourceBlockIDs)).toEqual(expectedIDs);
    expect(requests.every((body) => body.options.temperature === 0)).toBe(true);
    expect(requests.every((body) => body.options.num_ctx === 8_192)).toBe(true);
    expect(requests.every((body) => body.stream === false && body.think === false)).toBe(true);
  });

  it.each([
    {
      label: "unknown IDs",
      sourceBlockIDs: ["B0001", "B9999", "B0003"],
      message: /unknown source block ID/i
    },
    {
      label: "duplicate IDs",
      sourceBlockIDs: ["B0001", "B0001", "B0003"],
      message: /duplicate source block IDs/i
    },
    {
      label: "omitted IDs",
      sourceBlockIDs: ["B0001", "B0002"],
      message: /omitted one or more source block IDs/i
    },
    {
      label: "reordered IDs",
      sourceBlockIDs: ["B0002", "B0001", "B0003"],
      message: /reordered source block IDs/i
    }
  ])("rejects $label", async ({ sourceBlockIDs, message }) => {
    const model = new OllamaNoteModel(async () => ollamaResponse({
      chunks: [{ title: "Invalid grouping", sourceBlockIDs }]
    }));

    const result = model.segmentNote(threeBlockInput(), new AbortController().signal);

    await expect(result).rejects.toBeInstanceOf(OllamaResponseError);
    await expect(result).rejects.toThrow(message);
  });

  it("allows only titles and source IDs in model output, so source text cannot be rewritten", async () => {
    let capturedFormat: OllamaRequestBody["format"] | undefined;
    const model = new OllamaNoteModel(async (_input, init) => {
      capturedFormat = requestBody(init).format;
      return ollamaResponse({
        chunks: [{
          title: "Rewritten section",
          sourceBlockIDs: ["B0001", "B0002", "B0003"],
          text: "The model tried to replace the learner's exact source."
        }]
      });
    });

    await expect(
      model.segmentNote(threeBlockInput(), new AbortController().signal)
    ).rejects.toThrow(/invalid note-segmentation chunk/i);

    const chunkSchema = capturedFormat?.properties.chunks.items;
    expect(capturedFormat?.additionalProperties).toBe(false);
    expect(chunkSchema?.additionalProperties).toBe(false);
    expect(Object.keys(chunkSchema?.properties ?? {}).sort()).toEqual([
      "sourceBlockIDs",
      "title"
    ]);
  });

  it("honors the parent abort signal without creating a segmentation-specific timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    let observedSignal: AbortSignal | null = null;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const model = new OllamaNoteModel(async (_input, init) => {
      observedSignal = init?.signal as AbortSignal;
      markStarted();
      return await new Promise<Response>((_resolve, reject) => {
        const rejectAbort = (): void => {
          reject(observedSignal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        if (observedSignal?.aborted) {
          rejectAbort();
          return;
        }
        observedSignal?.addEventListener("abort", rejectAbort, { once: true });
      });
    });

    const segmentation = model.segmentNote(threeBlockInput(), controller.signal);
    await started;

    expect(observedSignal).toBe(controller.signal);
    expect(timeoutSpy).not.toHaveBeenCalled();
    controller.abort();

    await expect(segmentation).rejects.toBeInstanceOf(OllamaResponseError);
    await expect(segmentation).rejects.toThrow(/cancelled/i);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});
