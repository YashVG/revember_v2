import assert from "node:assert/strict";
import { describe, expect, test } from "vitest";
import { graphNeighbors, graphNodeRadius, graphTierY, isDirectedGraphLink, type GraphLink, type GraphNode } from "../shared/graph";
import { clampViewport, clientPointToViewBox, fitViewport, panViewport, zoomViewport, GRAPH_MAX_SCALE, GRAPH_MIN_SCALE, type GraphViewportState } from "../src/renderer/src/graphViewport";

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
});

function node(id: string, kind: GraphNode["kind"], x: number, y: number): GraphNode {
  return { id, rawID: id, kind, title: id, subtitle: id, status: "untested", x, y };
}
