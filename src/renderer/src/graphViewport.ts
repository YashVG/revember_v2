import { GRAPH_VIEWBOX, type GraphNode } from "../../../shared/graph";

export interface GraphViewportState {
  scale: number;
  x: number;
  y: number;
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const GRAPH_MIN_SCALE = 0.65;
export const GRAPH_MAX_SCALE = 3;
export const GRAPH_ZOOM_STEP = 1.15;
export const GRAPH_DEFAULT_VIEWPORT: GraphViewportState = { scale: 1, x: 0, y: 0 };

export function clampViewport(viewport: GraphViewportState): GraphViewportState {
  const scale = clamp(viewport.scale, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
  return {
    scale,
    x: clampTranslation(viewport.x, scale, GRAPH_VIEWBOX.width),
    y: clampTranslation(viewport.y, scale, GRAPH_VIEWBOX.height)
  };
}

export function panViewport(viewport: GraphViewportState, delta: GraphPoint): GraphViewportState {
  return clampViewport({ ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y });
}

export function zoomViewport(viewport: GraphViewportState, factor: number, anchor: GraphPoint): GraphViewportState {
  const nextScale = clamp(viewport.scale * factor, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
  const ratio = nextScale / viewport.scale;
  return clampViewport({
    scale: nextScale,
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio
  });
}

export function clientPointToViewBox(clientX: number, clientY: number, rect: ClientRectLike): GraphPoint {
  const scale = Math.max(0.0001, Math.min(rect.width / GRAPH_VIEWBOX.width, rect.height / GRAPH_VIEWBOX.height));
  const offsetX = (rect.width - GRAPH_VIEWBOX.width * scale) / 2;
  const offsetY = (rect.height - GRAPH_VIEWBOX.height * scale) / 2;
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale
  };
}

export function fitViewport(nodes: GraphNode[], padding = 110): GraphViewportState {
  if (!nodes.length) return GRAPH_DEFAULT_VIEWPORT;
  const minX = Math.min(...nodes.map((node) => node.x)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.x)) + padding;
  const minY = Math.min(...nodes.map((node) => node.y)) - padding;
  const maxY = Math.max(...nodes.map((node) => node.y)) + padding;
  const scale = Math.min(
    GRAPH_VIEWBOX.width / Math.max(1, maxX - minX),
    GRAPH_VIEWBOX.height / Math.max(1, maxY - minY),
    1.6
  );
  return clampViewport({
    scale,
    x: (GRAPH_VIEWBOX.width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (GRAPH_VIEWBOX.height - (maxY - minY) * scale) / 2 - minY * scale
  });
}

function clampTranslation(value: number, scale: number, size: number): number {
  const remaining = size - size * scale;
  return clamp(value, Math.min(0, remaining), Math.max(0, remaining));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
