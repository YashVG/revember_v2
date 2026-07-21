import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type Force
} from "d3-force";
import { Check, CircleAlert, Lightbulb, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import type { AppSnapshot, KnowledgeTopic } from "../../../shared/types";
import {
  buildGraph,
  graphNeighbors,
  graphNodeRadius,
  graphTierY,
  isDirectedGraphLink,
  GRAPH_VIEWBOX,
  type GraphLink,
  type GraphNode,
  type GraphNodeKind
} from "../../../shared/graph";
import {
  clientPointToViewBox,
  fitViewport,
  GRAPH_DEFAULT_VIEWPORT,
  GRAPH_ZOOM_STEP,
  panViewport,
  type GraphPoint,
  type GraphViewportState,
  zoomViewport
} from "./graphViewport";
import { capitalize, Eyebrow, Tag, truncate } from "./components/ui";

type LayoutNode = GraphNode & Omit<SimulationNodeDatum, "x" | "y">;
interface LayoutLink extends GraphLink, SimulationLinkDatum<LayoutNode> {}

type FilterState = Record<GraphNodeKind, boolean>;

const ALL_FILTERS: FilterState = { concept: true, gap: true, question: true };

export function KnowledgeGraph({ topic, snapshot }: { topic: KnowledgeTopic; snapshot: AppSnapshot }) {
  const graph = useMemo(() => buildGraph(topic, snapshot.progress), [topic, snapshot.progress]);
  const [layoutNodes, setLayoutNodes] = useState<GraphNode[]>(graph.nodes);
  const [visible, setVisible] = useState<FilterState>(ALL_FILTERS);
  const [selectedID, setSelectedID] = useState(`concept:${topic.concepts[0]?.id ?? ""}`);
  const [hoveredID, setHoveredID] = useState<string>();
  const [focusedID, setFocusedID] = useState<string>();
  const [viewport, setViewport] = useState<GraphViewportState>(GRAPH_DEFAULT_VIEWPORT);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef(viewport);
  const viewportInteractedRef = useRef(false);
  const lastTopicIDRef = useRef<string | undefined>(undefined);
  const shouldFitTopicRef = useRef(true);
  const viewportFrameRef = useRef<number | undefined>(undefined);
  const pendingViewportRef = useRef<GraphViewportState | undefined>(undefined);
  const pointerRef = useRef<{ pointerId: number; start: GraphPoint; initial: GraphViewportState; moved: boolean } | undefined>(undefined);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const topicChanged = lastTopicIDRef.current !== topic.id;
    lastTopicIDRef.current = topic.id;
    shouldFitTopicRef.current = topicChanged;
    setLayoutNodes(graph.nodes);
    if (topicChanged) setViewport(fitViewport(graph.nodes));
  }, [graph, topic.id]);

  useEffect(() => {
    setVisible(ALL_FILTERS);
    setSelectedID(`concept:${topic.concepts[0]?.id ?? ""}`);
    setHoveredID(undefined);
    setFocusedID(undefined);
  }, [topic.id]);

  useEffect(() => {
    const nodes: LayoutNode[] = graph.nodes.map((node) => ({ ...node }));
    const links: LayoutLink[] = graph.links.map((link) => ({
      ...link,
      source: link.sourceID,
      target: link.targetID
    }));
    const seedX = new Map(nodes.map((node) => [node.id, node.x]));
    const seedY = new Map(nodes.map((node) => [node.id, node.y]));
    const topicChanged = shouldFitTopicRef.current;
    viewportInteractedRef.current = false;
    const simulation = forceSimulation<LayoutNode>(nodes)
      .force("charge", forceManyBody<LayoutNode>().strength(-45).distanceMax(420))
      .force("x", forceX<LayoutNode>((node) => seedX.get(node.id) ?? GRAPH_VIEWBOX.width / 2).strength(0.42))
      .force("y", forceY<LayoutNode>((node) => seedY.get(node.id) ?? graphTierY(node.kind)).strength(0.72))
      .force("collide", forceCollide<LayoutNode>((node) => graphNodeMetrics(node).collisionRadius).iterations(6))
      .force("bounds", forceBounds())
      .force("link", forceLink<LayoutNode, LayoutLink>(links).id((node) => node.id).distance((link) => linkDistance(link.kind)).strength(0.2))
      .alpha(1)
      .alphaDecay(0.11)
      .velocityDecay(0.46);
    let frame: number | undefined;
    const publish = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setLayoutNodes(nodes.map(clampLayoutNode));
      });
    };
    simulation.on("tick", publish);
    simulation.on("end", () => {
      const finalNodes = finalizeLayout(nodes);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
      setLayoutNodes(finalNodes);
      if (topicChanged && !viewportInteractedRef.current) {
        setViewport(fitViewport(finalNodes, 130));
      }
    });
    publish();
    return () => {
      simulation.stop();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [graph]);

  useEffect(() => () => {
    if (viewportFrameRef.current !== undefined) cancelAnimationFrame(viewportFrameRef.current);
  }, []);

  const queueViewport = useCallback((next: GraphViewportState) => {
    viewportInteractedRef.current = true;
    const clamped = next;
    viewportRef.current = clamped;
    pendingViewportRef.current = clamped;
    if (viewportFrameRef.current !== undefined) return;
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = undefined;
      if (pendingViewportRef.current) setViewport(pendingViewportRef.current);
    });
  }, []);

  const visibleNodes = layoutNodes.filter((node) => visible[node.kind]);
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const links = graph.links.filter((link) => nodeMap.has(link.sourceID) && nodeMap.has(link.targetID));
  const selected = nodeMap.get(selectedID) ?? visibleNodes[0];
  const activeFocusID = visibleNodes.some((node) => node.id === focusedID)
    ? focusedID
    : visibleNodes.some((node) => node.id === hoveredID) ? hoveredID : undefined;
  const neighborIDs = activeFocusID ? graphNeighbors(links, activeFocusID) : new Set<string>();

  useEffect(() => {
    if (selected?.id !== selectedID) setSelectedID(selected?.id ?? "");
  }, [selected?.id, selectedID]);

  const toggle = (kind: GraphNodeKind) => setVisible((current) => {
    const activeCount = Object.values(current).filter(Boolean).length;
    if (current[kind] && activeCount === 1) return current;
    return { ...current, [kind]: !current[kind] };
  });

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    if (target.closest?.(".graph-node")) return;
    const svg = event.currentTarget;
    svg.setPointerCapture(event.pointerId);
    pointerRef.current = {
      pointerId: event.pointerId,
      start: clientToViewBox(svg, event.clientX, event.clientY),
      initial: viewportRef.current,
      moved: false
    };
    setPanning(true);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const current = clientToViewBox(event.currentTarget, event.clientX, event.clientY);
    const delta = { x: current.x - pointer.start.x, y: current.y - pointer.start.y };
    if (Math.abs(delta.x) > 2 || Math.abs(delta.y) > 2) pointer.moved = true;
    queueViewport(panViewport(pointer.initial, delta));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointerRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      pointerRef.current = undefined;
      setPanning(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const anchor = clientToViewBox(event.currentTarget, event.clientX, event.clientY);
    queueViewport(zoomViewport(viewportRef.current, Math.exp(-event.deltaY * 0.001), anchor));
  };

  const zoomAroundCenter = (factor: number) => {
    queueViewport(zoomViewport(viewportRef.current, factor, { x: GRAPH_VIEWBOX.width / 2, y: GRAPH_VIEWBOX.height / 2 }));
  };

  const handleCanvasKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || (event.key === "=" && event.shiftKey)) {
      event.preventDefault();
      zoomAroundCenter(GRAPH_ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAroundCenter(1 / GRAPH_ZOOM_STEP);
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const distance = event.shiftKey ? 120 : 40;
      const delta = event.key === "ArrowLeft" ? { x: distance, y: 0 }
        : event.key === "ArrowRight" ? { x: -distance, y: 0 }
          : event.key === "ArrowUp" ? { x: 0, y: distance } : { x: 0, y: -distance };
      queueViewport(panViewport(viewportRef.current, delta));
    }
  };

  const handleNodeSelect = (nodeID: string) => {
    if (pointerRef.current?.moved) return;
    setSelectedID(nodeID);
  };

  return <div className="graph-page">
    <section className="surface graph-toolbar" aria-label="Knowledge graph controls">
      <div><Eyebrow>Knowledge Graph</Eyebrow><span>{visibleNodes.length} nodes <b>·</b> {links.length} links</span></div>
      <div className="graph-controls">
        {(["concept", "gap", "question"] as GraphNodeKind[]).map((kind) => <button
          key={kind}
          className={visible[kind] ? "on" : ""}
          aria-pressed={visible[kind]}
          onClick={() => toggle(kind)}
        >{kind === "concept" ? <Lightbulb /> : kind === "gap" ? <CircleAlert /> : <Check />} {kind === "question" ? "Check" : capitalize(kind)}</button>)}
        <button aria-label="Zoom out" title="Zoom out" onClick={() => zoomAroundCenter(1 / GRAPH_ZOOM_STEP)}><Minus /></button>
        <button aria-label="Fit graph to view" title="Fit graph to view" onClick={() => queueViewport(fitViewport(visibleNodes))}><Maximize2 /></button>
        <button aria-label="Reset graph view" title="Reset graph view" onClick={() => queueViewport(GRAPH_DEFAULT_VIEWPORT)}><RotateCcw /></button>
        <button aria-label="Zoom in" title="Zoom in" onClick={() => zoomAroundCenter(GRAPH_ZOOM_STEP)}><Plus /></button>
      </div>
    </section>
    <div className="graph-layout">
      <section className={`surface graph-canvas ${panning ? "panning" : ""}`} aria-label="Knowledge relationships graph">
        <svg
          viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
          tabIndex={0}
          role="group"
          aria-label="Knowledge relationships"
          aria-describedby="graph-interaction-hint"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onKeyDown={handleCanvasKeyDown}
        >
          <defs>
            <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M 64 0 L 0 0 0 64" fill="none" stroke="#252830" strokeWidth="1" /></pattern>
            <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6db6bb" /></marker>
          </defs>
          <rect width={GRAPH_VIEWBOX.width} height={GRAPH_VIEWBOX.height} fill="url(#grid)" opacity=".55" />
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {links.map((link) => {
              const source = nodeMap.get(link.sourceID);
              const target = nodeMap.get(link.targetID);
              if (!source || !target) return null;
              const endpoints = linkEndpoints(source, target);
              const active = !activeFocusID || link.sourceID === activeFocusID || link.targetID === activeFocusID;
              return <line
                key={link.id}
                x1={endpoints.x1}
                y1={endpoints.y1}
                x2={endpoints.x2}
                y2={endpoints.y2}
                className={`graph-link ${link.kind} ${active ? "" : "dimmed"}`}
                markerEnd={isDirectedGraphLink(link.kind) ? "url(#graph-arrow)" : undefined}
              />;
            })}
            <g role="listbox" aria-label="Graph nodes">
              {visibleNodes.map((node, index) => <GraphNodeView
                key={node.id}
                node={node}
                selected={node.id === selected?.id}
                focused={node.id === activeFocusID}
                dimmed={Boolean(activeFocusID && node.id !== activeFocusID && !neighborIDs.has(node.id))}
                position={index + 1}
                setSize={visibleNodes.length}
                onSelect={() => handleNodeSelect(node.id)}
                onHover={setHoveredID}
                onFocus={setFocusedID}
              />)}
            </g>
          </g>
        </svg>
        <div id="graph-interaction-hint" className="graph-hint" role="note">Drag to pan <b>·</b> scroll to zoom <b>·</b> focus a node to trace its links</div>
      </section>
      <GraphSelection topic={topic} node={selected} />
    </div>
  </div>;
}

function GraphNodeView({
  node,
  selected,
  focused,
  dimmed,
  position,
  setSize,
  onSelect,
  onHover,
  onFocus
}: {
  node: GraphNode;
  selected: boolean;
  focused: boolean;
  dimmed: boolean;
  position: number;
  setSize: number;
  onSelect: () => void;
  onHover: (id?: string) => void;
  onFocus: (id?: string) => void;
}) {
  const radius = graphNodeRadius(node.kind);
  const label = `${capitalize(node.kind === "question" ? "check" : node.kind)}: ${node.title}. Evidence: ${capitalize(node.status)}.`;
  return <g
    className={`graph-node ${node.kind} ${node.status} ${selected ? "selected" : ""} ${focused ? "focused" : ""} ${dimmed ? "dimmed" : ""}`}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    }}
    onMouseEnter={() => onHover(node.id)}
    onMouseLeave={() => onHover(undefined)}
    onFocus={() => onFocus(node.id)}
    onBlur={() => onFocus(undefined)}
    tabIndex={0}
    role="option"
    aria-label={label}
    aria-selected={selected}
    aria-posinset={position}
    aria-setsize={setSize}
  >
    <title>{label}</title>
    <circle cx={node.x} cy={node.y} r={radius + 13} className="node-hit-area" />
    <circle cx={node.x} cy={node.y} r={radius + (selected ? 5 : focused ? 3 : 0)} className="node-halo" />
    <circle cx={node.x} cy={node.y} r={radius} className="node-core" />
    <text x={node.x} y={node.y + 4} textAnchor="middle" className="node-icon">{node.kind === "concept" ? "◊" : node.kind === "gap" ? "△" : "≡"}</text>
    <text x={node.x} y={node.y + radius + 18} textAnchor="middle" className={`node-label ${selected || focused ? "active" : ""}`}>{truncate(node.title, selected || focused ? 44 : 28)}</text>
  </g>;
}

function GraphSelection({ topic, node }: { topic: KnowledgeTopic; node?: GraphNode }) {
  if (!node) return <aside id="graph-selection" className="surface graph-selection" aria-label="Graph selection"><Eyebrow>Selection</Eyebrow><p>Select a node.</p></aside>;
  const concept = topic.concepts.find((item) => item.id === node.rawID);
  const gap = topic.gaps.find((item) => item.id === node.rawID);
  return <aside id="graph-selection" className="surface graph-selection" aria-label="Graph selection" aria-live="polite"><Eyebrow>Selection</Eyebrow><h3>{node.title}</h3><p>{concept?.explanation ?? gap?.description ?? node.subtitle}</p><hr />
    <div className="selection-stat"><i className={node.kind} /> Type <b>{node.kind === "question" ? "Check" : capitalize(node.kind)}</b></div>
    <div className="selection-stat"><i className={node.status} /> Evidence <b>{capitalize(node.status)}</b></div>
    {concept?.gapTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
  </aside>;
}

function linkEndpoints(source: GraphNode, target: GraphNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const sourceRadius = graphNodeRadius(source.kind) + 2;
  const targetRadius = graphNodeRadius(target.kind) + 4;
  return {
    x1: source.x + dx / distance * sourceRadius,
    y1: source.y + dy / distance * sourceRadius,
    x2: target.x - dx / distance * targetRadius,
    y2: target.y - dy / distance * targetRadius
  };
}

function clientToViewBox(svg: SVGSVGElement, clientX: number, clientY: number): GraphPoint {
  const rect = svg.getBoundingClientRect();
  return clientPointToViewBox(clientX, clientY, rect);
}

function linkDistance(kind: string): number {
  return kind === "questionConcept" || kind === "gapConcept" ? 180 : 130;
}

function labelWidth(title: string): number {
  return Math.min(238, Math.max(46, Math.min(title.length, 44) * 5.4));
}

interface GraphNodeMetrics {
  collisionRadius: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function graphNodeMetrics(node: Pick<GraphNode, "kind" | "title">): GraphNodeMetrics {
  const halfLabel = labelWidth(node.title) / 2 + 25;
  return {
    collisionRadius: graphNodeRadius(node.kind) + labelWidth(node.title) / 2 + 13,
    minX: halfLabel,
    maxX: GRAPH_VIEWBOX.width - halfLabel,
    minY: 45,
    maxY: GRAPH_VIEWBOX.height - 35
  };
}

function clampLayoutNode<T extends GraphNode & { x?: number; y?: number }>(node: T): T {
  const metrics = graphNodeMetrics(node);
  return {
    ...node,
    x: clamp(node.x ?? 0, metrics.minX, metrics.maxX),
    y: clamp(node.y ?? graphTierY(node.kind), metrics.minY, metrics.maxY)
  };
}

function forceBounds(): Force<LayoutNode, undefined> {
  let nodes: LayoutNode[] = [];
  const force = () => {
    for (const node of nodes) {
      const metrics = graphNodeMetrics(node);
      if ((node.x ?? 0) < metrics.minX) {
        node.x = metrics.minX;
        node.vx = Math.max(0, node.vx ?? 0);
      } else if ((node.x ?? 0) > metrics.maxX) {
        node.x = metrics.maxX;
        node.vx = Math.min(0, node.vx ?? 0);
      }
      if ((node.y ?? 0) < metrics.minY) {
        node.y = metrics.minY;
        node.vy = Math.max(0, node.vy ?? 0);
      } else if ((node.y ?? 0) > metrics.maxY) {
        node.y = metrics.maxY;
        node.vy = Math.min(0, node.vy ?? 0);
      }
    }
  };
  force.initialize = (nextNodes: LayoutNode[]) => { nodes = nextNodes; };
  return force;
}

function finalizeLayout(nodes: LayoutNode[]): GraphNode[] {
  const resolved = nodes.map(clampLayoutNode);
  const rows: Array<{ y: number; nodes: typeof resolved }> = [];
  for (const node of [...resolved].sort((a, b) => a.y - b.y)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - node.y) < 52);
    if (row) row.nodes.push(node);
    else rows.push({ y: node.y, nodes: [node] });
  }
  for (const row of rows) {
    row.nodes.sort((a, b) => a.x - b.x);
    let cursor = 0;
    for (const node of row.nodes) {
      const metrics = graphNodeMetrics(node);
      node.x = Math.max(node.x, cursor + metrics.minX);
      cursor = node.x + metrics.minX;
    }
    const overflow = Math.max(0, cursor - GRAPH_VIEWBOX.width);
    if (overflow) {
      const shift = overflow / 2;
      for (const node of row.nodes) {
        const metrics = graphNodeMetrics(node);
        node.x = clamp(node.x - shift, metrics.minX, metrics.maxX);
      }
    }
  }
  return resolved.map(({ vx: _vx, vy: _vy, index: _index, ...node }) => node);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
