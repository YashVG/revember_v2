import assert from "node:assert/strict";
import { describe, expect, test } from "vitest";
import { applyReviewEvent, emptyProgress, normalizeProgress, normalizeTopic } from "../shared/domain";
import { buildGraph, graphNeighbors, graphNodeRadius, graphTierY, isDirectedGraphLink, type GraphLink, type GraphNode } from "../shared/graph";
import type { ReviewEvent } from "../shared/types";
import {
  canApplyFinalViewportFit,
  clampViewport,
  clientPointToViewBox,
  fitViewport,
  panViewport,
  zoomViewport,
  GRAPH_MAX_SCALE,
  GRAPH_MIN_SCALE,
  type GraphViewportState
} from "../src/renderer/src/graphViewport";

const viewport: GraphViewportState = { scale: 1, x: 0, y: 0 };

describe("graph viewport", () => {
  test("zooms around the pointer anchor", () => {
    expect(zoomViewport(viewport, 2, { x: 250, y: 180 })).toEqual({ scale: 2, x: -250, y: -180 });
  });

  test("clamps zoom and pan to the graph bounds", () => {
    expect(clampViewport({ scale: 0.1, x: 20, y: 20 }).scale).toBe(GRAPH_MIN_SCALE);
    expect(clampViewport({ scale: 9, x: -9000, y: 9000 }).scale).toBe(GRAPH_MAX_SCALE);
    expect(panViewport({ scale: 2, x: 0, y: 0 }, { x: -5000, y: 5000 })).toEqual({ scale: 2, x: -1000, y: 0 });
    expect(panViewport({ scale: 0.9, x: 50, y: 37 }, { x: -80, y: 80 })).toEqual({ scale: 0.9, x: 0, y: 74 });
  });

  test("maps pointer coordinates through SVG letterboxing", () => {
    expect(clientPointToViewBox(400, 300, { left: 0, top: 0, width: 800, height: 600 })).toEqual({ x: 500, y: 370 });
  });

  test("fits the supplied nodes into a stable viewport", () => {
    const nodes = [node("a", "concept", 100, 100), node("b", "question", 900, 650)];
    const fitted = fitViewport(nodes);
    expect(fitted.scale).toBeGreaterThan(GRAPH_MIN_SCALE);
    expect(fitted.scale).toBeLessThanOrEqual(1.6);
    expect(Number.isFinite(fitted.x)).toBe(true);
    expect(Number.isFinite(fitted.y)).toBe(true);
  });

  test("does not let final layout overwrite a user interaction", () => {
    const initialization = { topicID: "ble", interactionRevision: 4 };

    expect(canApplyFinalViewportFit(initialization, "ble", 4)).toBe(true);
    expect(canApplyFinalViewportFit(initialization, "ble", 5)).toBe(false);
    expect(canApplyFinalViewportFit(initialization, "os", 4)).toBe(false);
    expect(canApplyFinalViewportFit(undefined, "ble", 4)).toBe(false);
  });
});

describe("graph semantics", () => {
  test("keeps tier and radius semantics explicit", () => {
    expect(graphTierY("gap")).toBeLessThan(graphTierY("concept"));
    expect(graphTierY("concept")).toBeLessThan(graphTierY("question"));
    expect(graphNodeRadius("concept")).toBeGreaterThan(graphNodeRadius("question"));
  });

  test("finds undirected neighbors for focus highlighting", () => {
    const links: GraphLink[] = [
      { id: "a-b", sourceID: "a", targetID: "b", kind: "enables" },
      { id: "c-a", sourceID: "c", targetID: "a", kind: "questionConcept" }
    ];
    assert.deepEqual([...graphNeighbors(links, "a")].sort(), ["b", "c"]);
  });

  test("only authored directional links receive arrows", () => {
    expect(isDirectedGraphLink("prerequisite")).toBe(true);
    expect(isDirectedGraphLink("partOf")).toBe(true);
    expect(isDirectedGraphLink("enables")).toBe(true);
    expect(isDirectedGraphLink("contrastsWith")).toBe(false);
    expect(isDirectedGraphLink("questionConcept")).toBe(false);
  });

  test("ignores evidence from obsolete question revisions when scoring concepts", () => {
    const topic = normalizeTopic({
      schemaVersion: 2,
      revision: 2,
      id: "revision-test",
      title: "Revision test",
      summary: "Revision-bound evidence",
      concepts: [{
        id: "concept",
        title: "Concept",
        firstPrinciples: "Current evidence only",
        explanation: "Old answers do not score rewritten questions."
      }],
      gaps: [],
      questions: [{
        id: "question",
        revision: 2,
        prompt: "Current question?",
        difficulty: "intro",
        conceptIDs: ["concept"],
        choices: [
          { id: "yes", text: "Yes", isCorrect: true },
          { id: "no", text: "No", isCorrect: false }
        ],
        explanation: "Yes."
      }]
    });
    const progress = emptyProgress();
    progress.reviewEvents.push(reviewEvent(1, "good", true));

    expect(buildGraph(topic, progress).nodes.find((node) => node.id === "concept:concept")?.status).toBe("untested");

    progress.reviewEvents.push(reviewEvent(2, "hard", true));
    expect(buildGraph(topic, progress).nodes.find((node) => node.id === "concept:concept")?.status).toBe("developing");
  });

  test("projects mixed-topic ledgers without changing graph nodes, links, or latest-event semantics", () => {
    const topic = normalizeTopic({
      schemaVersion: 2,
      revision: 2,
      id: "mixed",
      title: "Mixed",
      summary: "Multiple questions and revisions",
      concepts: [
        { id: "alpha", title: "Alpha", firstPrinciples: "Alpha", explanation: "Alpha" },
        { id: "beta", title: "Beta", firstPrinciples: "Beta", explanation: "Beta" }
      ],
      relationships: [{
        id: "alpha-enables-beta",
        sourceConceptID: "alpha",
        targetConceptID: "beta",
        kind: "enables"
      }],
      gaps: [{
        id: "alpha-gap",
        title: "Alpha gap",
        description: "Practice alpha",
        conceptIDs: ["alpha"]
      }],
      questions: [
        {
          id: "q1",
          revision: 2,
          prompt: "Alpha and beta?",
          difficulty: "intro",
          conceptIDs: ["alpha", "beta"],
          choices: graphChoices(),
          explanation: "Yes."
        },
        {
          id: "q2",
          revision: 1,
          prompt: "Beta?",
          difficulty: "intro",
          conceptIDs: ["beta"],
          choices: graphChoices(),
          explanation: "Yes."
        },
        {
          id: "retired",
          revision: 1,
          retiredAt: "2026-07-01T00:00:00.000Z",
          prompt: "Retired?",
          difficulty: "intro",
          conceptIDs: ["alpha"],
          choices: graphChoices(),
          explanation: "Yes."
        }
      ]
    });
    const progress = emptyProgress();
    progress.reviewEvents.push(
      mixedReviewEvent("other", "other-topic", "q1", 2, "missed", false, "2026-07-09T00:00:00.000Z"),
      mixedReviewEvent("obsolete", "mixed", "q1", 1, "missed", false, "2026-07-08T00:00:00.000Z"),
      mixedReviewEvent("q1-latest", "mixed", "q1", 2, "good", true, "2026-07-04T00:00:00.000Z"),
      mixedReviewEvent("q1-older", "mixed", "q1", 2, "hard", true, "2026-07-03T00:00:00.000Z"),
      mixedReviewEvent("q2-missed", "mixed", "q2", 1, "missed", false, "2026-07-05T00:00:00.000Z"),
      mixedReviewEvent("retired", "mixed", "retired", 1, "missed", false, "2026-07-10T00:00:00.000Z")
    );

    const graph = buildGraph(topic, progress);
    const statusByNodeID = Object.fromEntries(graph.nodes.map((candidate) => [candidate.id, candidate.status]));
    expect(statusByNodeID).toMatchObject({
      "concept:alpha": "stable",
      "concept:beta": "fragile",
      "question:q1": "stable",
      "question:q2": "fragile"
    });
    expect(statusByNodeID).not.toHaveProperty("question:retired");
    expect(graph.links.map((link) => link.id)).toEqual([
      "gap:alpha-gap->alpha",
      "question:q1->alpha",
      "question:q1->beta",
      "question:q2->beta",
      "alpha-enables-beta"
    ]);
  });

  test("uses chronological latest evidence after mixed-offset timestamps are canonicalized", () => {
    const topic = normalizeTopic({
      schemaVersion: 2,
      revision: 1,
      id: "offsets",
      title: "Offsets",
      summary: "Chronological evidence",
      concepts: [{ id: "concept", title: "Concept", firstPrinciples: "Time is absolute", explanation: "Offsets normalize." }],
      gaps: [],
      questions: [{
        id: "question",
        revision: 1,
        prompt: "Latest?",
        difficulty: "intro",
        conceptIDs: ["concept"],
        choices: graphChoices(),
        explanation: "The newest instant wins."
      }]
    });
    const progress = normalizeProgress({
      schemaVersion: 2,
      topics: {},
      reviewEvents: [
        mixedReviewEvent("newer", "offsets", "question", 1, "good", true, "2026-07-31T23:30:00-01:00"),
        mixedReviewEvent("older", "offsets", "question", 1, "missed", false, "2026-08-01T10:00:00+10:00")
      ]
    });

    expect(progress.reviewEvents.map((event) => event.reviewedAt)).toEqual([
      "2026-08-01T00:30:00.000Z",
      "2026-08-01T00:00:00.000Z"
    ]);
    const statuses = Object.fromEntries(buildGraph(topic, progress).nodes.map((node) => [node.id, node.status]));
    expect(statuses["question:question"]).toBe("stable");
    expect(statuses["concept:concept"]).toBe("stable");
  });

  test("uses last insertion for equal-timestamp evidence in both scheduler and graph projections", () => {
    const topic = normalizeTopic({
      schemaVersion: 2,
      revision: 1,
      id: "ties",
      title: "Ties",
      summary: "Deterministic evidence",
      concepts: [{ id: "concept", title: "Concept", firstPrinciples: "Order breaks ties", explanation: "The ledger is ordered." }],
      gaps: [],
      questions: [{
        id: "question",
        revision: 1,
        prompt: "Latest insertion?",
        difficulty: "intro",
        conceptIDs: ["concept"],
        choices: graphChoices(),
        explanation: "The later ledger entry wins."
      }]
    });
    const reviewedAt = "2026-08-01T00:00:00.000Z";
    const first = mixedReviewEvent("first", "ties", "question", 1, "missed", false, reviewedAt);
    const second = mixedReviewEvent("second", "ties", "question", 1, "good", true, reviewedAt);
    const progress = emptyProgress();
    applyReviewEvent(progress, first);
    const card = applyReviewEvent(progress, second);

    expect(card.lastRating).toBe("good");
    const statuses = Object.fromEntries(buildGraph(topic, progress).nodes.map((node) => [node.id, node.status]));
    expect(statuses["question:question"]).toBe("stable");
    expect(statuses["concept:concept"]).toBe("stable");
  });
});

function node(id: string, kind: GraphNode["kind"], x: number, y: number): GraphNode {
  return { id, rawID: id, kind, title: id, subtitle: id, status: "untested", x, y };
}

function reviewEvent(questionRevision: number, rating: ReviewEvent["rating"], isCorrect: boolean): ReviewEvent {
  return {
    id: `event-${questionRevision}`,
    topicID: "revision-test",
    questionID: "question",
    questionRevision,
    choiceID: isCorrect ? "yes" : "no",
    isCorrect,
    rating,
    conceptIDs: ["concept"],
    gapTags: [],
    misconceptionIDs: [],
    sourceRefs: [],
    reviewedAt: `2026-07-0${questionRevision}T00:00:00.000Z`
  };
}

function mixedReviewEvent(
  id: string,
  topicID: string,
  questionID: string,
  questionRevision: number,
  rating: ReviewEvent["rating"],
  isCorrect: boolean,
  reviewedAt: string
): ReviewEvent {
  return {
    id,
    topicID,
    questionID,
    questionRevision,
    choiceID: isCorrect ? "yes" : "no",
    isCorrect,
    rating,
    conceptIDs: [],
    gapTags: [],
    misconceptionIDs: [],
    sourceRefs: [],
    reviewedAt
  };
}

function graphChoices() {
  return [
    { id: "yes", text: "Yes", isCorrect: true },
    { id: "no", text: "No", isCorrect: false }
  ];
}
