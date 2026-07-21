import type { KnowledgeTopic, ProgressRecord, ReviewRating } from "./types";

export type GraphNodeKind = "concept" | "gap" | "question";
export type EvidenceStatus = "untested" | "fragile" | "developing" | "stable";

export interface GraphNode {
  id: string;
  rawID: string;
  kind: GraphNodeKind;
  title: string;
  subtitle: string;
  status: EvidenceStatus;
  x: number;
  y: number;
}

export interface GraphLink {
  id: string;
  sourceID: string;
  targetID: string;
  kind: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const GRAPH_VIEWBOX = { width: 1000, height: 740 } as const;

export function graphNodeRadius(kind: GraphNodeKind): number {
  return kind === "concept" ? 22 : kind === "gap" ? 19 : 17;
}

export function graphTierY(kind: GraphNodeKind): number {
  return kind === "gap" ? 125 : kind === "concept" ? 330 : 570;
}

export function isDirectedGraphLink(kind: string): boolean {
  return kind === "prerequisite" || kind === "partOf" || kind === "enables";
}

export function graphNeighbors(links: GraphLink[], nodeID: string): Set<string> {
  const neighbors = new Set<string>();
  for (const link of links) {
    if (link.sourceID === nodeID) neighbors.add(link.targetID);
    if (link.targetID === nodeID) neighbors.add(link.sourceID);
  }
  return neighbors;
}

export function buildGraph(topic: KnowledgeTopic, progress: ProgressRecord): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const width = 1000;
  const conceptY = 320;
  topic.concepts.forEach((concept, index) => {
    nodes.push({
      id: `concept:${concept.id}`,
      rawID: concept.id,
      kind: "concept",
      title: concept.title,
      subtitle: concept.firstPrinciples,
      status: evidenceStatus(topic.id, concept.id, topic, progress),
      x: position(index, topic.concepts.length, 70, width - 70),
      y: conceptY + (index % 2 ? 20 : -20)
    });
  });
  topic.gaps.forEach((gap, index) => {
    const linked = gap.conceptIDs.map((id) => nodes.find((node) => node.id === `concept:${id}`)?.x).filter((x): x is number => x !== undefined);
    nodes.push({
      id: `gap:${gap.id}`,
      rawID: gap.id,
      kind: "gap",
      title: gap.title,
      subtitle: gap.description,
      status: "fragile",
      x: linked.length ? average(linked) + (index - 1) * 28 : position(index, topic.gaps.length, 160, width - 160),
      y: 110 + (index % 2) * 35
    });
    for (const conceptID of gap.conceptIDs) {
      links.push({ id: `gap:${gap.id}->${conceptID}`, sourceID: `gap:${gap.id}`, targetID: `concept:${conceptID}`, kind: "gapConcept" });
    }
  });
  const activeQuestions = topic.questions.filter((question) => !question.retiredAt);
  activeQuestions.forEach((question, index) => {
    const linked = question.conceptIDs.map((id) => nodes.find((node) => node.id === `concept:${id}`)?.x).filter((x): x is number => x !== undefined);
    const latest = progress.reviewEvents
      .filter((event) => event.topicID === topic.id && event.questionID === question.id && event.questionRevision === question.revision)
      .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt)).at(-1);
    nodes.push({
      id: `question:${question.id}`,
      rawID: question.id,
      kind: "question",
      title: question.prompt,
      subtitle: `${question.transferLevel} · revision ${question.revision}`,
      status: latest ? ratingStatus(latest.rating, latest.isCorrect) : "untested",
      x: clamp((linked.length ? average(linked) : position(index, activeQuestions.length, 65, width - 65)) + ((index % 5) - 2) * 18, 60, width - 60),
      y: 510 + (index % 3) * 78
    });
    for (const conceptID of question.conceptIDs) {
      links.push({ id: `question:${question.id}->${conceptID}`, sourceID: `question:${question.id}`, targetID: `concept:${conceptID}`, kind: "questionConcept" });
    }
  });
  for (const relationship of topic.relationships) {
    links.push({
      id: relationship.id,
      sourceID: `concept:${relationship.sourceConceptID}`,
      targetID: `concept:${relationship.targetConceptID}`,
      kind: relationship.kind
    });
  }
  return { nodes, links };
}

function evidenceStatus(topicID: string, conceptID: string, topic: KnowledgeTopic, progress: ProgressRecord): EvidenceStatus {
  const questionIDs = new Set(topic.questions.filter((question) => !question.retiredAt && question.conceptIDs.includes(conceptID)).map((question) => question.id));
  const events = progress.reviewEvents.filter((event) => event.topicID === topicID && questionIDs.has(event.questionID));
  const latestByQuestion = new Map<string, typeof events[number]>();
  for (const event of events) {
    const current = latestByQuestion.get(event.questionID);
    if (!current || current.reviewedAt < event.reviewedAt) latestByQuestion.set(event.questionID, event);
  }
  const statuses = [...latestByQuestion.values()].map((event) => ratingStatus(event.rating, event.isCorrect));
  if (statuses.includes("fragile")) return "fragile";
  if (statuses.includes("developing")) return "developing";
  if (statuses.length) return "stable";
  return "untested";
}

function ratingStatus(rating: ReviewRating, isCorrect: boolean): EvidenceStatus {
  if (!isCorrect || rating === "missed") return "fragile";
  return rating === "hard" ? "developing" : "stable";
}

function position(index: number, count: number, low: number, high: number): number {
  return count <= 1 ? (low + high) / 2 : low + (high - low) * index / (count - 1);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
