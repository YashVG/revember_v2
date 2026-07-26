import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  CircleAlert,
  Clock3,
  ChevronDown,
  Cog,
  ExternalLink,
  FileJson,
  Folder,
  Gauge,
  GitBranch,
  House,
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
  Question
} from "../../../shared/types";
import {
  activeQuestions,
  currentEvidence,
  dueReviewItems,
  progressSummary,
  weakConceptIDs
} from "../../../shared/domain";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { CardWorkspace } from "./components/CardWorkspace";
import { NotesPage } from "./components/NotesPage";
import { HomePage } from "./components/HomePage";
import { capitalize, Eyebrow, MasteryRing, Tag } from "./components/ui";
import { Modal } from "./components/modal";
import { CheckIn, ReviewSession } from "./components/ReviewFlow";
import { InlineError } from "./components/review-ui";
import { isKnowledgeRootChangeAllowed, runGuardedKnowledgeRootChange } from "./knowledgeRootChange";
import { runBeforeLeaveGuards, runGuardedTransition, type BeforeLeaveGuard } from "./navigationGuard";
import { toErrorMessage } from "./utils";

type TopicMode = "concepts" | "graph" | "cards" | "check-in";
type GlobalView = "home" | "topic" | "notes";

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [snapshotError, setSnapshotError] = useState<string>();
  const [selectedTopicID, setSelectedTopicID] = useState<string>();
  const [mode, setMode] = useState<TopicMode>("concepts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<DueReviewItem[] | null>(null);
  const [globalView, setGlobalView] = useState<GlobalView>("home");
  const [cardSeed, setCardSeed] = useState<{ topicID: string; sentence: string; token: string }>();
  const beforeLeaveGuards = useRef(new Map<string, BeforeLeaveGuard>());

  const registerBeforeLeave = useCallback((key: string, handler: BeforeLeaveGuard | undefined) => {
    if (handler) beforeLeaveGuards.current.set(key, handler);
    else beforeLeaveGuards.current.delete(key);
  }, []);

  const registerHomeBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("home", handler);
  }, [registerBeforeLeave]);

  const registerNotesBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("notes-editor", handler);
  }, [registerBeforeLeave]);

  const registerCardsBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("card-editor", handler);
  }, [registerBeforeLeave]);

  const canLeaveCurrent = useCallback(
    () => runBeforeLeaveGuards(beforeLeaveGuards.current.values()),
    []
  );

  const leaveCurrent = useCallback(async (action: () => void) => {
    if (!await canLeaveCurrent()) return;
    action();
  }, [canLeaveCurrent]);

  const changeMode = useCallback(
    (next: TopicMode) => runGuardedTransition(mode, next, canLeaveCurrent, setMode),
    [canLeaveCurrent, mode]
  );

  const openReview = useCallback((items: DueReviewItem[], limit = 4) => {
    setReviewItems(items.slice(0, limit));
  }, []);

  const startReview = useCallback((minutes = 3) => {
    if (!snapshot) return;
    const capacity = Math.max(1, Math.floor(minutes * 60 / 45));
    openReview(dueReviewItems(snapshot), capacity);
  }, [openReview, snapshot]);

  const startQuestionReview = useCallback((topic: KnowledgeTopic, question: Question) => {
    const state = snapshot?.progress.topics[topic.id]?.reviewCardsByQuestionID?.[question.id];
    openReview([{
      id: `direct:${topic.id}:${question.id}`,
      topicID: topic.id,
      questionID: question.id,
      topic,
      question,
      ...(state?.dueAt ? { dueAt: state.dueAt } : {}),
      isNew: !state,
      isRevised: Boolean(state && state.questionRevision !== question.revision)
    }], 1);
  }, [openReview, snapshot]);

  const loadInitialSnapshot = useCallback(async () => {
    setSnapshotError(undefined);
    try {
      const next = await window.revember.getSnapshot();
      setSnapshot(next);
      setSelectedTopicID(next.topics[0]?.id);
    } catch (cause) {
      setSnapshotError(toErrorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadInitialSnapshot();
    return window.revember.onSnapshot((next) => {
      setSnapshotError(undefined);
      setSnapshot(next);
      setSelectedTopicID((current) => next.topics.some((topic) => topic.id === current) ? current : next.topics[0]?.id);
    });
  }, [loadInitialSnapshot]);

  useEffect(() => window.revember.onNavigate((route) => {
    if (route === "settings") setSettingsOpen(true);
    else if (route === "checkpoint") setCheckpointOpen(true);
    else if (route.startsWith("review:")) void leaveCurrent(() => startReview(Number(route.split(":")[1]) || 3));
    else if (route.startsWith("topic:")) {
      const topicID = route.slice("topic:".length);
      if (globalView === "topic" && selectedTopicID === topicID) return;
      void leaveCurrent(() => {
        setReviewItems(null);
        setGlobalView("topic");
        setSelectedTopicID(topicID);
      });
    }
  }), [globalView, leaveCurrent, selectedTopicID, startReview]);

  if (!snapshot) {
    return snapshotError
      ? <StartupError message={snapshotError} onRetry={() => void loadInitialSnapshot()} />
      : <LoadingScreen />;
  }
  const selectedTopic = snapshot.topics.find((topic) => topic.id === selectedTopicID) ?? snapshot.topics[0];
  const knowledgeRootChangeAllowed = isKnowledgeRootChangeAllowed(
    globalView,
    reviewItems !== null || checkpointOpen
  );
  const applyKnowledgeRootSnapshot = (next: AppSnapshot) => {
    setSnapshot(next);
    setReviewItems(null);
    setCheckpointOpen(false);
    setCardSeed(undefined);
    setMode("concepts");
    setSelectedTopicID(next.topics[0]?.id);
    setGlobalView("home");
  };

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
            selectedTopicID={globalView === "topic" ? selectedTopic?.id : undefined}
            onSelect={(id) => {
              if (globalView === "topic" && selectedTopic?.id === id) return;
              void leaveCurrent(() => { setGlobalView("topic"); setSelectedTopicID(id); });
            }}
            onOpenHome={() => {
              if (globalView !== "home") void leaveCurrent(() => setGlobalView("home"));
            }}
            onOpenNotes={() => {
              if (globalView !== "notes") void leaveCurrent(() => setGlobalView("notes"));
            }}
            globalView={globalView}
          />
          <main className="main-stage">
            <div className="toolbar-actions">
              <button className="icon-button" title="Reload topics" onClick={() => void window.revember.reload()}><RefreshCw size={16} /></button>
              <button className="icon-button" title="Capture learning checkpoint" onClick={() => setCheckpointOpen(true)}><SquarePen size={16} /></button>
              <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Cog size={16} /></button>
            </div>
            {globalView === "home" && snapshot.topics.length === 0 ? (
              <EmptyKnowledge
                root={snapshot.settings.knowledgeRootPath}
                onOpenSettings={() => setSettingsOpen(true)}
                onReload={async () => setSnapshot(await window.revember.reload())}
              />
            ) : globalView === "home" ? <HomePage
              key={snapshot.settings.knowledgeRootPath}
              snapshot={snapshot}
              onStartReview={(items) => void leaveCurrent(() => openReview(items))}
              onOpenNotes={() => void leaveCurrent(() => setGlobalView("notes"))}
              onRegisterBeforeLeave={registerHomeBeforeLeave}
            /> : globalView === "notes" ? <NotesPage
              key={snapshot.settings.knowledgeRootPath}
              snapshot={snapshot}
              onRegisterBeforeLeave={registerNotesBeforeLeave}
              onCreateCardFromPoint={(topicID, sentence) => void leaveCurrent(() => {
                setSelectedTopicID(topicID);
                setMode("cards");
                setCardSeed({ topicID, sentence, token: crypto.randomUUID() });
                setGlobalView("topic");
              })}
            /> : selectedTopic ? (
              <TopicDetail
                topic={selectedTopic}
                snapshot={snapshot}
                mode={mode}
                onModeChange={(next) => void changeMode(next)}
                onSnapshot={setSnapshot}
                onStart={() => void changeMode("check-in")}
                onReviewQuestion={(topic, question) => void leaveCurrent(() => startQuestionReview(topic, question))}
                onRegisterCardsBeforeLeave={registerCardsBeforeLeave}
                cardSeed={cardSeed?.topicID === selectedTopic.id ? cardSeed : undefined}
                onCardSeedConsumed={() => setCardSeed(undefined)}
              />
            ) : <EmptyKnowledge
              root={snapshot.settings.knowledgeRootPath}
              onOpenSettings={() => setSettingsOpen(true)}
              onReload={async () => setSnapshot(await window.revember.reload())}
            />}
          </main>
        </div>
      )}
      {snapshot.errorMessage && <ErrorToast message={snapshot.errorMessage} />}
      {settingsOpen && <SettingsDialog
        snapshot={snapshot}
        onSnapshot={setSnapshot}
        onKnowledgeRootChanged={applyKnowledgeRootSnapshot}
        onBeforeKnowledgeRootChange={canLeaveCurrent}
        knowledgeRootChangeAllowed={knowledgeRootChangeAllowed}
        onClose={() => setSettingsOpen(false)}
      />}
      {checkpointOpen && <CheckpointDialog snapshot={snapshot} onClose={() => setCheckpointOpen(false)} />}
    </div>
  );
}

function Sidebar({ snapshot, selectedTopicID, onSelect, onOpenHome, onOpenNotes, globalView }: {
  snapshot: AppSnapshot;
  selectedTopicID?: string;
  onSelect: (id: string) => void;
  onOpenHome: () => void;
  onOpenNotes: () => void;
  globalView: GlobalView;
}) {
  const [topicsOpen, setTopicsOpen] = useState(globalView === "topic");
  useEffect(() => {
    if (globalView === "topic") setTopicsOpen(true);
  }, [globalView]);
  return (
    <aside className="sidebar">
      <Logo />
      <button className={`plan-nav ${globalView === "home" ? "selected" : ""}`} aria-current={globalView === "home" ? "page" : undefined} onClick={onOpenHome}><House /><span>Home</span></button>
      <button className={`plan-nav ${globalView === "notes" ? "selected" : ""}`} aria-current={globalView === "notes" ? "page" : undefined} onClick={onOpenNotes}><SquarePen /><span>Notes</span></button>
      <button
        className="plan-nav topics-nav"
        aria-expanded={topicsOpen}
        aria-controls="sidebar-topic-list"
        onClick={() => setTopicsOpen((current) => !current)}
      >
        <BookOpen /><span>Topics</span><ChevronDown className={topicsOpen ? "rotated" : ""} />
      </button>
      {topicsOpen && <div className="topic-list" id="sidebar-topic-list">
        {snapshot.topics.map((topic) => {
          const evidence = currentEvidence(topic, snapshot.progress);
          return (
            <button
              key={topic.id}
              className={`topic-item ${selectedTopicID === topic.id ? "selected" : ""}`}
              aria-current={selectedTopicID === topic.id ? "page" : undefined}
              onClick={() => onSelect(topic.id)}
            >
              <i />
              <div><strong>{topic.title}</strong><span>{evidence.attempts ? `${Math.round(evidence.score * 100)}% across ${evidence.attempts} answers` : "No check-ins yet"}</span>
                <small>{topic.concepts.length} concepts <b>·</b> {activeQuestions(topic).length} checks</small></div>
            </button>
          );
        })}
      </div>}
    </aside>
  );
}

function TopicDetail({ topic, snapshot, mode, onModeChange, onSnapshot, onStart, onReviewQuestion, onRegisterCardsBeforeLeave, cardSeed, onCardSeedConsumed }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  mode: TopicMode;
  onModeChange: (mode: TopicMode) => void;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onStart: () => void;
  onReviewQuestion: (topic: KnowledgeTopic, question: Question) => void;
  onRegisterCardsBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
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
          <button className={mode === "concepts" ? "active" : ""} onClick={() => onModeChange("concepts")}>Concept Map</button>
          <button className={mode === "graph" ? "active" : ""} onClick={() => onModeChange("graph")}>Graph</button>
          <button className={mode === "cards" ? "active" : ""} onClick={() => onModeChange("cards")}>Cards</button>
          <button className={mode === "check-in" ? "active" : ""} onClick={() => onModeChange("check-in")}>Check-In</button>
        </div><button className="primary compact" onClick={onStart}><Play size={13} fill="currentColor" /> Start</button></div>
        <div className="topic-meta"><span><FileJson /> Local JSON</span><span><Lightbulb /> {topic.concepts.length} concepts</span><span><Check /> {activeQuestions(topic).length} checks</span><span><Lock /> Local-first</span></div>
        {weakIDs.length > 0 && <div className="weak-row"><span>Weak now</span>{weakIDs.map((id) => <Tag key={id}>{topic.concepts.find((concept) => concept.id === id)?.title ?? id}</Tag>)}</div>}
      </header>
      {mode === "concepts" && <>
        <div className="metric-row">
          <Metric icon={<Clock3 />} label="Due now" value={String(due)} caption="scheduled + new" color="amber" />
          <Metric icon={<Gauge />} label="Current accuracy" value={`${Math.round(evidence.score * 100)}%`} caption={progressSummary(topic, snapshot.progress)} color="cyan" />
          <Metric icon={<GitBranch />} label="Fragile links" value={String(weakIDs.length)} caption="from current evidence" color="magenta" />
        </div>
        <ConceptMap topic={topic} snapshot={snapshot} />
      </>}
      {mode === "graph" && <KnowledgeGraph topic={topic} snapshot={snapshot} />}
      {mode === "cards" && <CardWorkspace key={topic.id} topic={topic} snapshot={snapshot} onSnapshot={onSnapshot} onReview={(question) => onReviewQuestion(topic, question)} onRegisterBeforeLeave={onRegisterCardsBeforeLeave} seedSentence={cardSeed?.sentence} seedToken={cardSeed?.token} onSeedConsumed={onCardSeedConsumed} />}
      {mode === "check-in" && <CheckIn topic={topic} snapshot={snapshot} onSnapshot={onSnapshot} />}
    </div>
  );
}

function ConceptMap({ topic, snapshot }: { topic: KnowledgeTopic; snapshot: AppSnapshot }) {
  const weak = new Set(weakConceptIDs(topic, snapshot.progress));
  return <div className="scroll-content">
    <section className="surface ladder"><div><Eyebrow>Concept Ladder</Eyebrow><h3>Key ideas in {topic.title}</h3></div><MasteryRing value={currentEvidence(topic, snapshot.progress).score} size={70} />
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

function SettingsDialog({ snapshot, onSnapshot, onKnowledgeRootChanged, onBeforeKnowledgeRootChange, knowledgeRootChangeAllowed, onClose }: {
  snapshot: AppSnapshot;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onKnowledgeRootChanged: (snapshot: AppSnapshot) => void;
  onBeforeKnowledgeRootChange: () => Promise<boolean>;
  knowledgeRootChangeAllowed: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const invoke = async (operation: () => Promise<AppSnapshot | void>) => {
    if (busy) return;
    try {
      setBusy(true);
      setError(undefined);
      const next = await operation();
      if (next) onSnapshot(next);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const changeKnowledgeRoot = async (operation: () => Promise<AppSnapshot>) => {
    if (busy) return;
    if (!knowledgeRootChangeAllowed) {
      setError("Return Home and finish or exit the current workflow before changing knowledge folders.");
      return;
    }
    try {
      setBusy(true);
      setError(undefined);
      const result = await runGuardedKnowledgeRootChange(onBeforeKnowledgeRootChange, operation);
      if (!result.changed) {
        setError("The knowledge folder was not changed because the current lecture note could not be saved.");
        return;
      }
      if (result.snapshot.settings.knowledgeRootPath === snapshot.settings.knowledgeRootPath) {
        onSnapshot(result.snapshot);
      } else {
        onKnowledgeRootChanged(result.snapshot);
      }
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return <Modal title="Revember Settings" icon={<Settings />} onClose={onClose}>
    <div className="settings-section">
      <Eyebrow>Knowledge Store</Eyebrow>
      <code>{snapshot.settings.knowledgeRootPath}</code>
      {!knowledgeRootChangeAllowed && <p className="settings-guidance">To change knowledge folders, finish or exit the current workflow and return Home.</p>}
      <div className="settings-actions">
        <button disabled={busy || !knowledgeRootChangeAllowed} onClick={() => void changeKnowledgeRoot(window.revember.chooseKnowledgeRoot)}><Folder /> Choose Folder</button>
        <button disabled={busy} onClick={() => void invoke(window.revember.openKnowledgeRoot)}><ExternalLink /> Open Folder</button>
        <button disabled={busy || !knowledgeRootChangeAllowed} onClick={() => void changeKnowledgeRoot(window.revember.resetKnowledgeRoot)}><RotateCcw /> Reset</button>
      </div>
    </div>
    <div className="settings-section"><Eyebrow>Progress</Eyebrow><p>Progress stays readable and local at:</p><code>{snapshot.settings.progressPath}</code></div>
    <div className="settings-section notification-row"><div><Eyebrow>Review Reminders</Eyebrow><p>Notify you while Revember is running when a scheduled check becomes due.</p></div><button className={`toggle ${snapshot.settings.notificationsEnabled ? "on" : ""}`} type="button" role="switch" aria-label="Review reminders" aria-checked={snapshot.settings.notificationsEnabled} disabled={busy} onClick={() => void invoke(() => window.revember.setNotificationsEnabled(!snapshot.settings.notificationsEnabled))}><span /></button></div>
    {error && <div className="settings-error"><InlineError message={error} /></div>}
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

function Logo() {
  const wordmark = <span>Revember</span>;
  return <div className="logo">{wordmark}</div>;
}
function Metric({ icon, label, value, caption, color }: { icon: ReactNode; label: string; value: string; caption: string; color: string }) { return <section className={`surface metric ${color}`}><div>{icon}</div><span><Eyebrow>{label}</Eyebrow><strong>{value}</strong><small>{caption}</small></span></section>; }
function ErrorToast({ message }: { message: string }) { return <div className="error-toast" role="alert" aria-live="assertive"><CircleAlert /> <span>{message}</span></div>; }
function LoadingScreen() { return <div className="loading"><Logo /><RefreshCw className="spin" /></div>; }
function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="loading startup-error" role="alert">
    <CircleAlert />
    <h1>Revember could not start</h1>
    <p>{message}</p>
    <p>Check that the local knowledge and progress files are readable, then try again.</p>
    <button className="primary" type="button" onClick={onRetry}><RefreshCw /> Retry startup</button>
  </div>;
}
function EmptyKnowledge({ root, onOpenSettings, onReload }: { root: string; onOpenSettings: () => void; onReload: () => Promise<void> }) {
  const [error, setError] = useState<string>();
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    try {
      setReloading(true);
      setError(undefined);
      await onReload();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setReloading(false);
    }
  };
  return <div className="empty-state">
    <BookOpen />
    <h1>Set up your knowledge folder</h1>
    <p>Revember needs at least one valid topic before it can save lecture notes. Add topic JSON files to <code>{root}/topics</code>, or choose another folder.</p>
    <div className="empty-state-actions">
      <button className="primary" type="button" onClick={onOpenSettings}><Folder /> Choose folder</button>
      <button type="button" disabled={reloading} onClick={() => void reload()}><RefreshCw className={reloading ? "spin" : undefined} /> {reloading ? "Reloading…" : "Reload topics"}</button>
    </div>
    {error && <InlineError message={error} />}
  </div>;
}
