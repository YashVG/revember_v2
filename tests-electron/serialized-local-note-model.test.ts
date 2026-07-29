import { describe, expect, it } from "vitest";
import {
  OllamaNoteModel,
  type DistractorModelInput,
  type LocalNoteModelInput,
  type SegmentNoteModelInput,
  type TopicNoteModelInput
} from "../electron/ollama-note-model";

interface PendingRequest {
  body: Record<string, unknown>;
  respond(generated: unknown, status?: number): void;
}

function controlledFetcher(): {
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  requests: PendingRequest[];
} {
  const requests: PendingRequest[] = [];

  return {
    requests,
    fetcher: async (_input, init) => await new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      let settled = false;

      const cleanup = (): void => {
        signal?.removeEventListener("abort", abort);
      };
      const abort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });

      requests.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        respond(generated, status = 200): void {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(new Response(JSON.stringify({
            response: JSON.stringify(generated)
          }), {
            status,
            headers: { "content-type": "application/json" }
          }));
        }
      });
    })
  };
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const enrichmentInput: LocalNoteModelInput = {
  title: "Bits",
  rawText: "A bit has two possible values."
};

const segmentationInput: SegmentNoteModelInput = {
  title: "Bits",
  sourceBlocks: [{ id: "B1", text: "A bit has two possible values." }]
};

const topicNoteInput: TopicNoteModelInput = {
  topicTitle: "Bits",
  topicContext: "A bit has two possible values."
};

const distractorInput: DistractorModelInput = {
  topicTitle: "Bits",
  topicContext: "A bit has two possible values.",
  sentence: "A bit can have two possible values.",
  answer: "Zero or one"
};

describe("OllamaNoteModel serialization", () => {
  it("runs every model operation through one FIFO lane", async () => {
    const { fetcher, requests } = controlledFetcher();
    const model = new OllamaNoteModel(fetcher);
    const signal = new AbortController().signal;

    const enrichment = model.enrich(enrichmentInput, signal);
    const segmentation = model.segmentNote(segmentationInput, signal);
    const topicNote = model.generateTopicNote(topicNoteInput, signal);
    const distractors = model.generateDistractors(distractorInput, signal);

    await nextTurn();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.system).toMatch(/study response/i);

    requests[0]!.respond({ takeaways: [{ evidenceID: "S0001" }] });
    await enrichment;
    await nextTurn();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body.system).toMatch(/reading chunks/i);

    requests[1]!.respond({
      chunks: [{ title: "Bit values", sourceBlockIDs: ["B1"] }]
    });
    await segmentation;
    await nextTurn();
    expect(requests).toHaveLength(3);
    expect(requests[2]?.body.system).toMatch(/study note/i);

    requests[2]!.respond({
      title: "Bits",
      rawText: "A bit has two possible values.",
      concisePoints: ["A bit can be zero or one."]
    });
    await topicNote;
    await nextTurn();
    expect(requests).toHaveLength(4);
    expect(requests[3]?.body.system).toMatch(/distractors/i);

    requests[3]!.respond({
      distractors: ["Always two", "A byte", "A radio packet"]
    });
    await expect(distractors).resolves.toEqual([
      "Always two",
      "A byte",
      "A radio packet"
    ]);
  });

  it("continues with the next queued operation after a failure", async () => {
    const { fetcher, requests } = controlledFetcher();
    const model = new OllamaNoteModel(fetcher);
    const signal = new AbortController().signal;

    const failed = model.enrich(enrichmentInput, signal);
    const next = model.segmentNote(segmentationInput, signal);

    await nextTurn();
    requests[0]!.respond({}, 500);
    await expect(failed).rejects.toThrow(/HTTP 500/i);

    await nextTurn();
    expect(requests).toHaveLength(2);
    requests[1]!.respond({
      chunks: [{ title: "Bit values", sourceBlockIDs: ["B1"] }]
    });
    await expect(next).resolves.toEqual({
      chunks: [{ title: "Bit values", sourceBlockIDs: ["B1"] }]
    });
  });

  it("rejects a queued operation promptly without invoking it when its signal is aborted", async () => {
    const { fetcher, requests } = controlledFetcher();
    const model = new OllamaNoteModel(fetcher);
    const activeSignal = new AbortController().signal;
    const queuedController = new AbortController();

    const active = model.enrich(enrichmentInput, activeSignal);
    const queued = model.segmentNote(segmentationInput, queuedController.signal);
    let queuedSettled = false;
    void queued.finally(() => {
      queuedSettled = true;
    }).catch(() => undefined);

    await nextTurn();
    expect(requests).toHaveLength(1);
    queuedController.abort();
    await nextTurn();

    try {
      expect(queuedSettled).toBe(true);
    } finally {
      requests[0]!.respond({ takeaways: [{ evidenceID: "S0001" }] });
      await active;
      await expect(queued).rejects.toThrow(/cancelled/i);
      expect(requests).toHaveLength(1);
    }
  });
});
