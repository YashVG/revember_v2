import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  CircleAlert,
  Clock3,
  Cog,
  ExternalLink,
  FileJson,
  Folder,
  Gauge,
  GitBranch,
  Lightbulb,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  SquarePen,
  Timer,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type {
  AnswerChoice,
  AppSnapshot,
  CommitReviewResult,
  DueReviewItem,
  KnowledgeTopic,
  Question,
  ReviewCardState,
  ReviewRating
} from "../../../shared/types";
import {
  activeQuestions,
  currentEvidence,
  dueReviewItems,
  intervalLabel,
  progressSummary,
  weakConceptIDs
} from "../../../shared/domain";
import { buildGraph, type GraphNode, type GraphNodeKind } from "../../../shared/graph";

type TopicMode = "concepts" | "graph" | "check-in";

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [selectedTopicID, setSelectedTopicID] = useState<string>();
  const [mode, setMode] = useState<TopicMode>("concepts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<DueReviewItem[] | null>(null);

  const startReview = useCallback((minutes = 3) => {
    if (!snapshot) return;
    const capacity = Math.max(1, Math.floor(minutes * 60 / 45));
    setReviewItems(dueReviewItems(snapshot).slice(0, capacity));
  }, [snapshot]);

  useEffect(() => {
    void window.revember.getSnapshot().then((next) => {
      setSnapshot(next);
      setSelectedTopicID(next.topics[0]?.id);
    });
    return window.revember.onSnapshot((next) => {
      setSnapshot(next);
      setSelectedTopicID((current) => next.topics.some((topic) => topic.id === current) ? current : next.topics[0]?.id);
    });
  }, []);

  useEffect(() => window.revember.onNavigate((route) => {
    if (route === "settings") setSettingsOpen(true);
    else if (route === "checkpoint") setCheckpointOpen(true);
    else if (route.startsWith("review:")) startReview(Number(route.split(":")[1]) || 3);
    else if (route.startsWith("topic:")) {
      setReviewItems(null);
      setSelectedTopicID(route.slice("topic:".length));
    }
  }), [startReview]);

  if (!snapshot) return <LoadingScreen />;
  const selectedTopic = snapshot.topics.find((topic) => topic.id === selectedTopicID) ?? snapshot.topics[0];

  return (
    <div className="app-shell">
      <div className="titlebar" aria-hidden="true"><span>Revember</span></div>
      {reviewItems ? (
        <ReviewSession
          items={reviewItems}
          snapshot={snapshot}
          onSnapshot={setSnapshot}
          onFinish={() => setReviewItems(null)}
        />
      ) : (
        <div className="workspace">
          <Sidebar
            snapshot={snapshot}
            selectedTopicID={selectedTopic?.id}
            onSelect={setSelectedTopicID}
            onStartReview={() => startReview(3)}
          />
          <main className="main-stage">
            <div className="toolbar-actions">
              <button className="icon-button" title="Reload topics" onClick={() => void window.revember.reload()}><RefreshCw size={16} /></button>
              <button className="icon-button" title="Capture learning checkpoint" onClick={() => setCheckpointOpen(true)}><SquarePen size={16} /></button>
              <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Cog size={16} /></button>
            </div>
            {selectedTopic ? (
              <TopicDetail
                topic={selectedTopic}
                snapshot={snapshot}
                mode={mode}
                setMode={setMode}
                onSnapshot={setSnapshot}
                onStart={() => setMode("check-in")}
              />
            ) : <EmptyKnowledge root={snapshot.settings.knowledgeRootPath} />}
          </main>
        </div>
      )}
      {snapshot.errorMessage && <ErrorToast message={snapshot.errorMessage} />}
      {settingsOpen && <SettingsDialog snapshot={snapshot} onSnapshot={setSnapshot} onClose={() => setSettingsOpen(false)} />}
      {checkpointOpen && <CheckpointDialog snapshot={snapshot} onClose={() => setCheckpointOpen(false)} />}
    </div>
  );
}

function Sidebar({ snapshot, selectedTopicID, onSelect, onStartReview }: {
  snapshot: AppSnapshot;
  selectedTopicID?: string;
  onSelect: (id: string) => void;
  onStartReview: () => void;
}) {
  const due = dueReviewItems(snapshot);
  const overallAttempts = snapshot.progress.reviewEvents.length;
  const overallCorrect = snapshot.progress.reviewEvents.filter((event) => event.isCorrect).length;
  const mastery = overallAttempts ? overallCorrect / overallAttempts : 0;
  return (
    <aside className="sidebar">
      <Logo />
      <button className="today-card" onClick={onStartReview}>
        <div><Eyebrow>Today</Eyebrow><strong>{due.length} due {due.length === 1 ? "check" : "checks"}</strong><span>Estimated {Math.max(1, Math.ceil(due.length * 0.75))} min</span></div>
        <MasteryRing value={mastery} size={62} />
      </button>
      <Eyebrow>Topics</Eyebrow>
      <div className="topic-list">
        {snapshot.topics.map((topic) => {
          const evidence = currentEvidence(topic, snapshot.progress);
          return (
            <button key={topic.id} className={`topic-item ${selectedTopicID === topic.id ? "selected" : ""}`} onClick={() => onSelect(topic.id)}>
              <i />
              <div><strong>{topic.title}</strong><span>{evidence.attempts ? `${Math.round(evidence.score * 100)}% across ${evidence.attempts} answers` : "No check-ins yet"}</span>
                <small>{topic.concepts.length} concepts <b>·</b> {activeQuestions(topic).length} checks</small></div>
            </button>
          );
        })}
      </div>
      <div className="sidebar-footer"><Lock size={13} /> Local files only</div>
    </aside>
  );
}

function TopicDetail({ topic, snapshot, mode, setMode, onSnapshot, onStart }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  mode: TopicMode;
  setMode: (mode: TopicMode) => void;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onStart: () => void;
}) {
  const evidence = currentEvidence(topic, snapshot.progress);
  const weakIDs = weakConceptIDs(topic, snapshot.progress);
  const due = dueReviewItems(snapshot).filter((item) => item.topicID === topic.id).length;
  return (
    <div className="topic-detail">
      <header className="topic-header">
        <div className="topic-copy"><Eyebrow>Retrieval Cockpit</Eyebrow><h1>{topic.title}</h1><p>{topic.summary}</p></div>
        <div className="mode-area"><span>Mode</span><div className="segmented">
          <button className={mode === "concepts" ? "active" : ""} onClick={() => setMode("concepts")}>Concept Map</button>
          <button className={mode === "graph" ? "active" : ""} onClick={() => setMode("graph")}>Graph</button>
          <button className={mode === "check-in" ? "active" : ""} onClick={() => setMode("check-in")}>Check-In</button>
        </div><button className="primary compact" onClick={onStart}><Play size={13} fill="currentColor" /> Start</button></div>
        <div className="topic-meta"><span><FileJson /> Local JSON</span><span><Lightbulb /> {topic.concepts.length} concepts</span><span><Check /> {activeQuestions(topic).length} checks</span><span><Lock /> Local-first</span></div>
        {weakIDs.length > 0 && <div className="weak-row"><span>Weak now</span>{weakIDs.map((id) => <Tag key={id}>{topic.concepts.find((concept) => concept.id === id)?.title ?? id}</Tag>)}</div>}
      </header>
      {mode === "concepts" && <>
        <div className="metric-row">
          <Metric icon={<Clock3 />} label="Due now" value={String(due)} caption="scheduled + new" color="amber" />
          <Metric icon={<Gauge />} label="Current accuracy" value={`${Math.round(evidence.score * 100)}%`} caption={progressSummary(topic, snapshot.progress)} color="cyan" />
          <Metric icon={<GitBranch />} label="Fragile links" value={String(Math.max(weakIDs.length, topic.gaps.length))} caption="gap-aware checks" color="magenta" />
        </div>
        <ConceptMap topic={topic} snapshot={snapshot} />
      </>}
      {mode === "graph" && <KnowledgeGraph topic={topic} snapshot={snapshot} />}
      {mode === "check-in" && <CheckIn topic={topic} snapshot={snapshot} onSnapshot={onSnapshot} />}
    </div>
  );
}

function ConceptMap({ topic, snapshot }: { topic: KnowledgeTopic; snapshot: AppSnapshot }) {
  const weak = new Set(weakConceptIDs(topic, snapshot.progress));
  return <div className="scroll-content">
    <section className="surface ladder"><div><Eyebrow>Concept Ladder</Eyebrow><h3>From physical states to app-level meaning</h3></div><MasteryRing value={currentEvidence(topic, snapshot.progress).score} size={70} />
      <div className="ladder-track">{topic.concepts.map((concept) => <div key={concept.id}><span className={weak.has(concept.id) ? "weak" : ""} /><small>{concept.title}</small></div>)}</div>
    </section>
    <div className="concept-stack">{topic.concepts.map((concept, index) => <article key={concept.id} className={`concept-card ${weak.has(concept.id) ? "fragile" : ""}`}>
      <div className="concept-index">{String(index + 1).padStart(2, "0")}</div><div className="concept-rule" />
      <div className="concept-body"><div className="concept-title"><Lightbulb size={17} /><h3>{concept.title}</h3><span>{weak.has(concept.id) ? "fragile" : "stable target"}</span></div>
        <strong>{concept.firstPrinciples}</strong><p>{concept.explanation}</p>
        <div className="tag-columns"><div><small>Confusable</small><div>{concept.confusableTerms.map((term) => <Tag key={term}>{term}</Tag>)}</div></div><div><small>Gap tags</small><div>{concept.gapTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div></div></div>
      </div>
    </article>)}</div>
  </div>;
}

function KnowledgeGraph({ topic, snapshot }: { topic: KnowledgeTopic; snapshot: AppSnapshot }) {
  const [visible, setVisible] = useState<Set<GraphNodeKind>>(new Set(["concept", "gap", "question"]));
  const [selectedID, setSelectedID] = useState(`concept:${topic.concepts[0]?.id ?? ""}`);
  const [zoom, setZoom] = useState(1);
  const graph = useMemo(() => buildGraph(topic, snapshot.progress), [topic, snapshot.progress]);
  const visibleNodes = graph.nodes.filter((node) => visible.has(node.kind));
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const links = graph.links.filter((link) => nodeMap.has(link.sourceID) && nodeMap.has(link.targetID));
  const selected = nodeMap.get(selectedID) ?? visibleNodes[0];
  const toggle = (kind: GraphNodeKind) => setVisible((current) => {
    const next = new Set(current);
    if (next.has(kind) && next.size > 1) next.delete(kind); else next.add(kind);
    return next;
  });
  return <div className="graph-page">
    <section className="surface graph-toolbar"><div><Eyebrow>Knowledge Graph</Eyebrow><span>{visibleNodes.length} nodes <b>·</b> {links.length} links</span></div><div className="graph-controls">
      {(["concept", "gap", "question"] as GraphNodeKind[]).map((kind) => <button key={kind} className={visible.has(kind) ? "on" : ""} onClick={() => toggle(kind)}>{kind === "concept" ? <Lightbulb /> : kind === "gap" ? <CircleAlert /> : <Check />} {kind === "question" ? "Check" : capitalize(kind)}</button>)}
      <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.7, value - .15))}><ZoomOut /></button><button onClick={() => setZoom(1)}>⌾</button><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.5, value + .15))}><ZoomIn /></button>
    </div></section>
    <div className="graph-layout"><section className="surface graph-canvas"><svg viewBox={`${500 - 500 / zoom} ${370 - 370 / zoom} ${1000 / zoom} ${740 / zoom}`} role="img" aria-label="Knowledge relationships">
      <defs><pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M 64 0 L 0 0 0 64" fill="none" stroke="#252830" strokeWidth="1" /></pattern></defs><rect width="1000" height="740" fill="url(#grid)" opacity=".55" />
      {links.map((link) => { const source = nodeMap.get(link.sourceID)!; const target = nodeMap.get(link.targetID)!; return <line key={link.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`graph-link ${link.kind}`} />; })}
      {visibleNodes.map((node) => <GraphNodeView key={node.id} node={node} selected={node.id === selected?.id} onSelect={() => setSelectedID(node.id)} />)}
    </svg></section><GraphSelection topic={topic} node={selected} /></div>
  </div>;
}

function GraphNodeView({ node, selected, onSelect }: { node: GraphNode; selected: boolean; onSelect: () => void }) {
  const radius = node.kind === "concept" ? 22 : node.kind === "gap" ? 19 : 17;
  return <g className={`graph-node ${node.kind} ${node.status} ${selected ? "selected" : ""}`} onClick={onSelect} tabIndex={0} role="button">
    <circle cx={node.x} cy={node.y} r={radius + (selected ? 4 : 0)} className="node-halo" /><circle cx={node.x} cy={node.y} r={radius} className="node-core" />
    <text x={node.x} y={node.y + 4} textAnchor="middle" className="node-icon">{node.kind === "concept" ? "◊" : node.kind === "gap" ? "△" : "≡"}</text>
    <text x={node.x} y={node.y + radius + 18} textAnchor="middle" className="node-label">{truncate(node.title, 24)}</text>
  </g>;
}

function GraphSelection({ topic, node }: { topic: KnowledgeTopic; node?: GraphNode }) {
  if (!node) return <aside className="surface graph-selection"><Eyebrow>Selection</Eyebrow><p>Select a node.</p></aside>;
  const concept = topic.concepts.find((item) => item.id === node.rawID);
  const gap = topic.gaps.find((item) => item.id === node.rawID);
  return <aside className="surface graph-selection"><Eyebrow>Selection</Eyebrow><h3>{node.title}</h3><p>{concept?.explanation ?? gap?.description ?? node.subtitle}</p><hr />
    <div className="selection-stat"><i className={node.kind} /> Type <b>{node.kind === "question" ? "Check" : capitalize(node.kind)}</b></div>
    <div className="selection-stat"><i className={node.status} /> Evidence <b>{capitalize(node.status)}</b></div>
    {concept?.gapTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
  </aside>;
}

function CheckIn({ topic, snapshot, onSnapshot }: { topic: KnowledgeTopic; snapshot: AppSnapshot; onSnapshot: (snapshot: AppSnapshot) => void }) {
  const questions = activeQuestions(topic);
  const [index, setIndex] = useState(0);
  const [selectedChoiceID, setSelectedChoiceID] = useState<string>();
  const [rating, setRating] = useState<ReviewRating>();
  const [saved, setSaved] = useState<ReviewCardState>();
  const [error, setError] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const question = questions[index];
  useEffect(() => { setIndex(0); reset(); }, [topic.id]);
  if (!question) return <div className="surface empty-state">No active checks in this topic.</div>;
  const choice = question.choices.find((candidate) => candidate.id === selectedChoiceID);
  const choose = (candidate: AnswerChoice) => { if (selectedChoiceID) return; setSelectedChoiceID(candidate.id); setRating(candidate.isCorrect ? undefined : "missed"); setSaved(undefined); };
  const save = async () => {
    if (!choice || !rating) return;
    try {
      const result = await commit(question, topic, choice, rating);
      setSaved(result.cardState); onSnapshot(result.snapshot); setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const move = (next: number) => { setIndex(Math.max(0, Math.min(questions.length - 1, next))); reset(); };
  function reset() { setSelectedChoiceID(undefined); setRating(undefined); setSaved(undefined); setError(undefined); setRevealed(false); }
  return <div className="checkin-layout"><section className="surface checkin-card"><div className="checkin-top"><div><Eyebrow>Focus Check-In</Eyebrow><span>Question {index + 1} of {questions.length}</span></div><Tag>{question.gapTags[0] ?? question.transferLevel}</Tag></div>
    <h2>{question.prompt}</h2>
    {question.kind === "freeRecall" && !revealed ? <div className="recall-box"><Brain /><h3>Recall before cues</h3><p>Answer mentally or aloud, then reveal the choices.</p><button className="primary" onClick={() => setRevealed(true)}>Reveal Choices</button></div> : <ChoiceList question={question} selectedChoiceID={selectedChoiceID} onChoose={choose} />}
    {choice && <div className="answer-explanation"><strong>{choice.isCorrect ? "Correct" : "Not quite"}</strong><p>{choice.rationale ?? question.explanation}</p><small>{question.explanation}</small></div>}
    {error && <div className="inline-error"><CircleAlert /> {error}</div>}
    <div className="question-nav"><button disabled={index === 0} onClick={() => move(index - 1)}><ArrowLeft /> Previous</button><button disabled={index === questions.length - 1} onClick={() => move(index + 1)}>Next <ArrowRight /></button></div>
  </section><InsightPanel topic={topic} question={question} snapshot={snapshot} rating={rating} setRating={setRating} answered={Boolean(choice)} correct={choice?.isCorrect} saved={saved} onSave={save} /></div>;
}

function ChoiceList({ question, selectedChoiceID, onChoose }: { question: Question; selectedChoiceID?: string; onChoose: (choice: AnswerChoice) => void }) {
  return <div className="choice-list">{question.choices.map((choice, index) => {
    const selected = choice.id === selectedChoiceID;
    return <button key={choice.id} className={`${selected ? "selected" : ""} ${selected ? (choice.isCorrect ? "correct" : "incorrect") : ""}`} onClick={() => onChoose(choice)} disabled={Boolean(selectedChoiceID)}>
      <span>{index + 1}</span><div><strong>{choice.text}</strong>{selected && choice.rationale && <small>{choice.rationale}</small>}</div>{selected && (choice.isCorrect ? <Check /> : <X />)}
    </button>;
  })}</div>;
}

function InsightPanel({ topic, question, snapshot, rating, setRating, answered, correct, saved, onSave }: {
  topic: KnowledgeTopic; question: Question; snapshot: AppSnapshot; rating?: ReviewRating; setRating: (rating: ReviewRating) => void;
  answered: boolean; correct?: boolean; saved?: ReviewCardState; onSave: () => void;
}) {
  const evidence = currentEvidence(topic, snapshot.progress);
  return <aside className="insight-panel"><section className="surface"><Eyebrow>Session Signal</Eyebrow><div className="signal"><MasteryRing value={evidence.score} size={64} /><div><strong>{progressSummary(topic, snapshot.progress)}</strong><span>Progress updates only after retrieval.</span></div></div></section>
    <section className="surface"><Eyebrow>Gap Diagnosis</Eyebrow><div>{question.gapTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div><code>{question.conceptIDs.join(" → ")}</code></section>
    <section className="surface"><Eyebrow>{saved ? "Last Saved Schedule" : "Next Review"}</Eyebrow>{saved ? <><strong className="cyan">Saved</strong><span>Due {relativeDate(saved.dueAt)}</span><small>{intervalLabel(saved)}</small></> : <strong>{rating ? "Save to schedule your next review" : "Answer, then rate the effort"}</strong>}
      <RatingButtons selected={rating} setSelected={setRating} disabled={!answered} incorrect={correct === false} /><button className="primary save-rating" disabled={!answered || !rating || Boolean(saved)} onClick={onSave}>{saved ? "Saved" : "Save Review"}</button>
      {correct === false && <small className="amber-text">Incorrect retrievals are recorded as Missed so they return soon.</small>}</section></aside>;
}

function ReviewSession({ items, snapshot, onSnapshot, onFinish }: { items: DueReviewItem[]; snapshot: AppSnapshot; onSnapshot: (snapshot: AppSnapshot) => void; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [selectedChoiceID, setSelectedChoiceID] = useState<string>();
  const [rating, setRating] = useState<ReviewRating>();
  const [revealed, setRevealed] = useState(false);
  const [schedules, setSchedules] = useState<ReviewCardState[]>([]);
  const [error, setError] = useState<string>();
  const item = items[index];
  if (!item) return <ReviewCompletion empty={!items.length} completed={schedules.length} schedules={schedules} onFinish={onFinish} />;
  const choice = item.question.choices.find((candidate) => candidate.id === selectedChoiceID);
  const choose = (candidate: AnswerChoice) => { if (selectedChoiceID) return; setSelectedChoiceID(candidate.id); setRating(candidate.isCorrect ? undefined : "missed"); };
  const save = async () => {
    if (!choice || !rating) return;
    try {
      const result = await commit(item.question, item.topic, choice, rating);
      onSnapshot(result.snapshot); setSchedules((current) => [...current, result.cardState]); setIndex((value) => value + 1);
      setSelectedChoiceID(undefined); setRating(undefined); setRevealed(false); setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="review-shell"><div className="review-top"><button onClick={onFinish}><X /> Exit Review</button><span><Timer /> {index + 1} of {items.length}</span></div><section className="surface review-card"><div className="review-context"><div><Eyebrow>{item.isRevised ? "Revised Check" : item.isNew ? "New Check" : "Due Check"}</Eyebrow><strong>{item.topic.title}</strong></div><span>{capitalize(item.question.transferLevel)}</span></div>
    <h2>{item.question.prompt}</h2>{item.question.kind === "freeRecall" && !revealed ? <div className="recall-box"><Brain /><h3>Recall before cues</h3><p>Answer mentally or aloud, then reveal the choices to score what you recalled.</p><button className="primary" onClick={() => setRevealed(true)}>Reveal Choices</button></div> : <ChoiceList question={item.question} selectedChoiceID={selectedChoiceID} onChoose={choose} />}
    {choice && <div className="review-answer"><p>{item.question.explanation}</p><h3>How hard was retrieval?</h3><RatingButtons selected={rating} setSelected={setRating} disabled={false} incorrect={!choice.isCorrect} />{!choice.isCorrect && <small className="amber-text">Incorrect retrievals are recorded as Missed.</small>}</div>}
    {error && <div className="inline-error"><CircleAlert /> {error}</div>}<div className="review-save"><span>The answer and rating are saved together.</span><button className="primary" disabled={!choice || !rating} onClick={save}>{index === items.length - 1 ? "Finish Review" : "Save & Continue"} <ArrowRight /></button></div>
  </section></div>;
}

function ReviewCompletion({ empty, completed, schedules, onFinish }: { empty: boolean; completed: number; schedules: ReviewCardState[]; onFinish: () => void }) {
  const earliest = schedules.sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return <div className="review-shell completion-wrap"><section className="surface completion"><Brain /><h1>{empty ? "Nothing is due" : "Review complete"}</h1><p>{empty ? "New and scheduled checks will appear here when they are ready." : `You saved ${completed} retrieval ${completed === 1 ? "event" : "events"} to your local learner record.`}</p>{earliest && <div><Eyebrow>Earliest next review</Eyebrow><strong>{relativeDate(earliest.dueAt)}</strong><span>{intervalLabel(earliest)}</span></div>}<button className="primary" onClick={onFinish}>Return to Topic</button></section></div>;
}

function RatingButtons({ selected, setSelected, disabled, incorrect }: { selected?: ReviewRating; setSelected: (rating: ReviewRating) => void; disabled: boolean; incorrect: boolean }) {
  const ratings: ReviewRating[] = ["missed", "hard", "good", "easy"];
  return <div className="rating-buttons">{ratings.map((rating) => <button key={rating} className={selected === rating ? `selected ${rating}` : ""} disabled={disabled || (incorrect && rating !== "missed")} onClick={() => setSelected(rating)}>{capitalize(rating)}</button>)}</div>;
}

function SettingsDialog({ snapshot, onSnapshot, onClose }: { snapshot: AppSnapshot; onSnapshot: (snapshot: AppSnapshot) => void; onClose: () => void }) {
  const invoke = async (operation: () => Promise<AppSnapshot>) => onSnapshot(await operation());
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-dialog"><header><div><Settings /><h2>Revember Settings</h2></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="settings-section"><Eyebrow>Knowledge Store</Eyebrow><code>{snapshot.settings.knowledgeRootPath}</code><div className="settings-actions"><button onClick={() => void invoke(window.revember.chooseKnowledgeRoot)}><Folder /> Choose Folder</button><button onClick={() => void window.revember.openKnowledgeRoot()}><ExternalLink /> Open Folder</button><button onClick={() => void invoke(window.revember.resetKnowledgeRoot)}><RotateCcw /> Reset</button></div></div>
    <div className="settings-section"><Eyebrow>Progress</Eyebrow><p>Progress stays readable and local at:</p><code>{snapshot.settings.progressPath}</code></div>
    <div className="settings-section notification-row"><div><Eyebrow>Review Reminders</Eyebrow><p>Notify you while Revember is running when a scheduled check becomes due.</p></div><button className={`toggle ${snapshot.settings.notificationsEnabled ? "on" : ""}`} role="switch" aria-checked={snapshot.settings.notificationsEnabled} onClick={() => void invoke(() => window.revember.setNotificationsEnabled(!snapshot.settings.notificationsEnabled))}><span /></button></div>
  </section></div>;
}

function CheckpointDialog({ snapshot, onClose }: { snapshot: AppSnapshot; onClose: () => void }) {
  const [summary, setSummary] = useState("");
  const [topicID, setTopicID] = useState(snapshot.topics[0]?.id ?? "");
  const [openQuestion, setOpenQuestion] = useState("");
  const [savedPath, setSavedPath] = useState<string>();
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      const result = await window.revember.captureCheckpoint({ summary, topicID: topicID || undefined, openQuestion: openQuestion || undefined });
      setSavedPath(result.filePath); setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-dialog checkpoint-dialog"><header><div><SquarePen /><h2>Capture Learning Checkpoint</h2></div><button className="icon-button" onClick={onClose}><X /></button></header>
    {savedPath ? <div className="checkpoint-saved"><Check /><h3>Checkpoint saved</h3><p>Your learning evidence is now available to Revember and the local MCP server.</p><code>{savedPath}</code><button className="primary" onClick={onClose}>Done</button></div> : <div className="checkpoint-form">
      <label><span>What changed in your understanding?</span><textarea autoFocus value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Write one concrete thing you can now explain or distinguish…" /></label>
      <label><span>Topic</span><select value={topicID} onChange={(event) => setTopicID(event.target.value)}><option value="">General checkpoint</option>{snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
      <label><span>Open question <small>optional</small></span><input value={openQuestion} onChange={(event) => setOpenQuestion(event.target.value)} placeholder="What still feels unresolved?" /></label>
      {error && <div className="inline-error"><CircleAlert /> {error}</div>}<div className="dialog-footer"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!summary.trim()} onClick={save}>Save Checkpoint</button></div>
    </div>}
  </section></div>;
}

async function commit(question: Question, topic: KnowledgeTopic, choice: AnswerChoice, rating: ReviewRating): Promise<CommitReviewResult> {
  return window.revember.commitReview({ topicID: topic.id, questionID: question.id, questionRevision: question.revision, choiceID: choice.id, rating, eventID: crypto.randomUUID() });
}

function Logo() { return <div className="logo"><div className="logo-mark"><i /><i /><i /></div><div><strong>Revember</strong><span>Fundamentals cockpit</span></div></div>; }
function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="eyebrow">{children}</div>; }
function Tag({ children }: { children: React.ReactNode }) { return <span className="tag">{children}</span>; }
function MasteryRing({ value, size }: { value: number; size: number }) { const progress = Math.max(0, Math.min(1, value)); return <div className="mastery-ring" style={{ width: size, height: size, background: `conic-gradient(var(--cyan) ${progress * 360}deg, #242730 0deg)` }}><div><strong>{Math.round(progress * 100)}%</strong></div></div>; }
function Metric({ icon, label, value, caption, color }: { icon: React.ReactNode; label: string; value: string; caption: string; color: string }) { return <section className={`surface metric ${color}`}><div>{icon}</div><span><Eyebrow>{label}</Eyebrow><strong>{value}</strong><small>{caption}</small></span></section>; }
function ErrorToast({ message }: { message: string }) { return <div className="error-toast"><CircleAlert /> <span>{message}</span></div>; }
function LoadingScreen() { return <div className="loading"><Logo /><RefreshCw className="spin" /></div>; }
function EmptyKnowledge({ root }: { root: string }) { return <div className="empty-state"><BookOpen /><h1>No Topics</h1><p>Add JSON topic files to <code>{root}/topics</code>, then reload.</p></div>; }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replace(/([A-Z])/g, " $1"); }
function truncate(value: string, max: number) { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function relativeDate(value: string) { const delta = new Date(value).getTime() - Date.now(); const minutes = Math.round(delta / 60_000); if (Math.abs(minutes) < 60) return minutes <= 0 ? "now" : `in ${minutes} min`; const days = Math.round(delta / 86_400_000); return days <= 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`; }
