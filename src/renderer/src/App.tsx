import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
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
} from "lucide-react";
import type {
  AppSnapshot,
  DueReviewItem,
  KnowledgeTopic,
  Question,
  StoredExamPlan
} from "../../../shared/types";
import {
  activeQuestions,
  currentEvidence,
  dueReviewItems,
  progressSummary,
  weakConceptIDs
} from "../../../shared/domain";
import { examSessionDates } from "../../../shared/planner";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { PlannerPage } from "./components/PlannerPage";
import { CardWorkspace } from "./components/CardWorkspace";
import { NotesPage } from "./components/NotesPage";
import { capitalize, Eyebrow, MasteryRing, Tag } from "./components/ui";
import { Modal } from "./components/modal";
import { CheckIn, ReviewSession } from "./components/ReviewFlow";
import { InlineError } from "./components/review-ui";
import { toErrorMessage } from "./utils";

type TopicMode = "concepts" | "graph" | "cards" | "check-in";
type GlobalView = "topic" | "plan" | "notes";

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [selectedTopicID, setSelectedTopicID] = useState<string>();
  const [mode, setMode] = useState<TopicMode>("concepts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<DueReviewItem[] | null>(null);
  const [globalView, setGlobalView] = useState<GlobalView>("topic");
  const [cardSeed, setCardSeed] = useState<{ topicID: string; sentence: string; token: string }>();

  const startReview = useCallback((minutes = 3) => {
    if (!snapshot) return;
    const capacity = Math.max(1, Math.floor(minutes * 60 / 45));
    setReviewItems(dueReviewItems(snapshot).slice(0, capacity));
  }, [snapshot]);

  const startPlanReview = useCallback((plan: StoredExamPlan) => {
    if (!snapshot) return;
    setReviewItems(dueReviewItems(snapshot).filter((item) => plan.topicIDs.includes(item.topicID)).slice(0, 4));
  }, [snapshot]);

  const startQuestionReview = useCallback((topic: KnowledgeTopic, question: Question) => {
    const state = snapshot?.progress.topics[topic.id]?.reviewCardsByQuestionID?.[question.id];
    setReviewItems([{
      id: `direct:${topic.id}:${question.id}`,
      topicID: topic.id,
      questionID: question.id,
      topic,
      question,
      ...(state?.dueAt ? { dueAt: state.dueAt } : {}),
      isNew: !state,
      isRevised: Boolean(state && state.questionRevision !== question.revision)
    }]);
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
      setGlobalView("topic");
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
          onSnapshot={setSnapshot}
          onFinish={() => setReviewItems(null)}
        />
      ) : (
        <div className="workspace">
          <Sidebar
            snapshot={snapshot}
            selectedTopicID={selectedTopic?.id}
            onSelect={(id) => { setGlobalView("topic"); setSelectedTopicID(id); }}
            onStartReview={() => startReview(3)}
            onOpenPlanner={() => setGlobalView("plan")}
            onOpenNotes={() => setGlobalView("notes")}
            globalView={globalView}
            onStartPlanSession={startPlanReview}
          />
          <main className="main-stage">
            <div className="toolbar-actions">
              <button className="icon-button" title="Reload topics" onClick={() => void window.revember.reload()}><RefreshCw size={16} /></button>
              <button className="icon-button" title="Capture learning checkpoint" onClick={() => setCheckpointOpen(true)}><SquarePen size={16} /></button>
              <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Cog size={16} /></button>
            </div>
            {globalView === "plan" ? <PlannerPage snapshot={snapshot} onSnapshot={setSnapshot} onStartSession={startPlanReview} /> : globalView === "notes" ? <NotesPage snapshot={snapshot} onCreateCardFromPoint={(topicID, sentence) => {
              setSelectedTopicID(topicID);
              setMode("cards");
              setCardSeed({ topicID, sentence, token: crypto.randomUUID() });
              setGlobalView("topic");
            }} /> : selectedTopic ? (
              <TopicDetail
                topic={selectedTopic}
                snapshot={snapshot}
                mode={mode}
                setMode={setMode}
                onSnapshot={setSnapshot}
                onStart={() => setMode("check-in")}
                onReviewQuestion={startQuestionReview}
                cardSeed={cardSeed?.topicID === selectedTopic.id ? cardSeed : undefined}
                onCardSeedConsumed={() => setCardSeed(undefined)}
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

function Sidebar({ snapshot, selectedTopicID, onSelect, onStartReview, onOpenPlanner, onOpenNotes, globalView, onStartPlanSession }: {
  snapshot: AppSnapshot;
  selectedTopicID?: string;
  onSelect: (id: string) => void;
  onStartReview: () => void;
  onOpenPlanner: () => void;
  onOpenNotes: () => void;
  globalView: GlobalView;
  onStartPlanSession: (plan: StoredExamPlan) => void;
}) {
  const due = dueReviewItems(snapshot);
  const overallAttempts = snapshot.progress.reviewEvents.length;
  const overallCorrect = snapshot.progress.reviewEvents.filter((event) => event.isCorrect).length;
  const mastery = overallAttempts ? overallCorrect / overallAttempts : 0;
  const todayPlans = snapshot.planner.plans.filter((plan) => !plan.archivedAt && planSessionIsToday(plan));
  return (
    <aside className="sidebar">
      <Logo />
      <button className="today-card" onClick={onStartReview}>
        <div><Eyebrow>Today</Eyebrow><strong>{due.length} due {due.length === 1 ? "check" : "checks"}</strong><span>Estimated {Math.max(1, Math.ceil(due.length * 0.75))} min</span></div>
        <MasteryRing value={mastery} size={62} />
      </button>
      {todayPlans.length > 0 && <div className="planned-session-list" aria-label="Today's planned sessions">{todayPlans.map((plan) => <button key={plan.id} className="planned-session" onClick={() => onStartPlanSession(plan)}><span><Eyebrow>Planned session</Eyebrow><strong>{plan.examName}</strong><small>Today · {plan.topicIDs.length} {plan.topicIDs.length === 1 ? "topic" : "topics"}</small></span><Play size={15} fill="currentColor" /></button>)}</div>}
      <button className={`plan-nav ${globalView === "plan" ? "selected" : ""}`} onClick={onOpenPlanner}><CalendarIcon /><span>Plan</span></button>
      <button className={`plan-nav ${globalView === "notes" ? "selected" : ""}`} onClick={onOpenNotes}><SquarePen /><span>Notes</span></button>
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

function TopicDetail({ topic, snapshot, mode, setMode, onSnapshot, onStart, onReviewQuestion, cardSeed, onCardSeedConsumed }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  mode: TopicMode;
  setMode: (mode: TopicMode) => void;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onStart: () => void;
  onReviewQuestion: (topic: KnowledgeTopic, question: Question) => void;
  cardSeed?: { sentence: string; token: string };
  onCardSeedConsumed: () => void;
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
          <button className={mode === "cards" ? "active" : ""} onClick={() => setMode("cards")}>Cards</button>
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
      {mode === "cards" && <CardWorkspace topic={topic} snapshot={snapshot} onSnapshot={onSnapshot} onReview={(question) => onReviewQuestion(topic, question)} seedSentence={cardSeed?.sentence} seedToken={cardSeed?.token} onSeedConsumed={onCardSeedConsumed} />}
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

function SettingsDialog({ snapshot, onSnapshot, onClose }: { snapshot: AppSnapshot; onSnapshot: (snapshot: AppSnapshot) => void; onClose: () => void }) {
  const invoke = async (operation: () => Promise<AppSnapshot>) => onSnapshot(await operation());
  return <Modal title="Revember Settings" icon={<Settings />} onClose={onClose}>
    <div className="settings-section"><Eyebrow>Knowledge Store</Eyebrow><code>{snapshot.settings.knowledgeRootPath}</code><div className="settings-actions"><button onClick={() => void invoke(window.revember.chooseKnowledgeRoot)}><Folder /> Choose Folder</button><button onClick={() => void window.revember.openKnowledgeRoot()}><ExternalLink /> Open Folder</button><button onClick={() => void invoke(window.revember.resetKnowledgeRoot)}><RotateCcw /> Reset</button></div></div>
    <div className="settings-section"><Eyebrow>Progress</Eyebrow><p>Progress stays readable and local at:</p><code>{snapshot.settings.progressPath}</code></div>
    <div className="settings-section notification-row"><div><Eyebrow>Review Reminders</Eyebrow><p>Notify you while Revember is running when a scheduled check becomes due.</p></div><button className={`toggle ${snapshot.settings.notificationsEnabled ? "on" : ""}`} role="switch" aria-checked={snapshot.settings.notificationsEnabled} onClick={() => void invoke(() => window.revember.setNotificationsEnabled(!snapshot.settings.notificationsEnabled))}><span /></button></div>
  </Modal>;
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
    } catch (cause) { setError(toErrorMessage(cause)); }
  };
  return <Modal title="Capture Learning Checkpoint" icon={<SquarePen />} className="checkpoint-dialog" onClose={onClose}>
    {savedPath ? <div className="checkpoint-saved"><Check /><h3>Checkpoint saved</h3><p>Your learning evidence is now available to Revember and the local MCP server.</p><code>{savedPath}</code><button className="primary" onClick={onClose}>Done</button></div> : <div className="checkpoint-form">
      <label><span>What changed in your understanding?</span><textarea autoFocus value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Write one concrete thing you can now explain or distinguish…" /></label>
      <label><span>Topic</span><select value={topicID} onChange={(event) => setTopicID(event.target.value)}><option value="">General checkpoint</option>{snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
      <label><span>Open question <small>optional</small></span><input value={openQuestion} onChange={(event) => setOpenQuestion(event.target.value)} placeholder="What still feels unresolved?" /></label>
      {error && <InlineError message={error} />}<div className="dialog-footer"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!summary.trim()} onClick={save}>Save Checkpoint</button></div>
    </div>}
  </Modal>;
}

function Logo() { return <div className="logo"><div className="logo-mark"><i /><i /><i /></div><div><strong>Revember</strong><span>Fundamentals cockpit</span></div></div>; }
function Metric({ icon, label, value, caption, color }: { icon: ReactNode; label: string; value: string; caption: string; color: string }) { return <section className={`surface metric ${color}`}><div>{icon}</div><span><Eyebrow>{label}</Eyebrow><strong>{value}</strong><small>{caption}</small></span></section>; }
function ErrorToast({ message }: { message: string }) { return <div className="error-toast"><CircleAlert /> <span>{message}</span></div>; }
function LoadingScreen() { return <div className="loading"><Logo /><RefreshCw className="spin" /></div>; }
function EmptyKnowledge({ root }: { root: string }) { return <div className="empty-state"><BookOpen /><h1>No Topics</h1><p>Add JSON topic files to <code>{root}/topics</code>, then reload.</p></div>; }
function CalendarIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>; }
function planSessionIsToday(plan: StoredExamPlan): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: plan.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  try { return examSessionDates(plan).includes(today); } catch { return false; }
}
