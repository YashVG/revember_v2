import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  CircleHelp,
  ChevronDown,
  Cog,
  ExternalLink,
  Folder,
  House,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
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
  dueReviewItems
} from "../../../shared/domain";
import { CardWorkspace } from "./components/CardWorkspace";
import { HomePage } from "./components/HomePage";
import { QuestionsPage } from "./components/QuestionsPage";
import { Eyebrow } from "./components/ui";
import { Modal } from "./components/modal";
import { ReviewSession } from "./components/ReviewFlow";
import { InlineError } from "./components/review-ui";
import { CreateTopicDialog } from "./components/CreateTopicDialog";
import { isKnowledgeRootChangeAllowed, runGuardedKnowledgeRootChange } from "./knowledgeRootChange";
import { runBeforeLeaveGuards, type BeforeLeaveGuard } from "./navigationGuard";
import { toErrorMessage } from "./utils";

type TopicView = "overview" | "questions";
type GlobalView = "home" | "topic" | "questions";

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [snapshotError, setSnapshotError] = useState<string>();
  const [selectedTopicID, setSelectedTopicID] = useState<string>();
  const [topicView, setTopicView] = useState<TopicView>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [createTopicOpen, setCreateTopicOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<DueReviewItem[] | null>(null);
  const [globalView, setGlobalView] = useState<GlobalView>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [questionTopicPickerRequested, setQuestionTopicPickerRequested] = useState(false);
  const [cardSeed, setCardSeed] = useState<{ topicID: string; sentence?: string; token: string }>();
  const beforeLeaveGuards = useRef(new Map<string, BeforeLeaveGuard>());

  const registerBeforeLeave = useCallback((key: string, handler: BeforeLeaveGuard | undefined) => {
    if (handler) beforeLeaveGuards.current.set(key, handler);
    else beforeLeaveGuards.current.delete(key);
  }, []);

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
        setTopicView("overview");
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
    setTopicView("overview");
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
        <div className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <Sidebar
            snapshot={snapshot}
            selectedTopicID={globalView === "topic" ? selectedTopic?.id : undefined}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            onSelect={(id) => {
              if (globalView === "topic" && selectedTopic?.id === id) return;
              void leaveCurrent(() => {
                setGlobalView("topic");
                setSelectedTopicID(id);
                setTopicView("overview");
              });
            }}
            onOpenHome={() => {
              if (globalView !== "home") void leaveCurrent(() => setGlobalView("home"));
            }}
            onOpenQuestions={() => {
              if (globalView !== "questions") void leaveCurrent(() => setGlobalView("questions"));
            }}
            onCreateTopic={() => setCreateTopicOpen(true)}
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
              onStartReview={(items) => void leaveCurrent(() => openReview(items, items.length))}
              onCreateQuestion={() => void leaveCurrent(() => {
                setQuestionTopicPickerRequested(true);
                setGlobalView("questions");
              })}
            /> : globalView === "questions" ? <QuestionsPage
              snapshot={snapshot}
              onReview={(topic, question) => void leaveCurrent(() => startQuestionReview(topic, question))}
              onStartReview={(items) => void leaveCurrent(() => openReview(items, items.length))}
              openTopicPicker={questionTopicPickerRequested}
              onTopicPickerOpened={() => setQuestionTopicPickerRequested(false)}
              onCreateQuestion={(topic) => void leaveCurrent(() => {
                setSelectedTopicID(topic.id);
                setTopicView("questions");
                setCardSeed({ topicID: topic.id, token: crypto.randomUUID() });
                setGlobalView("topic");
              })}
            /> : selectedTopic ? (
              <TopicDetail
                topic={selectedTopic}
                snapshot={snapshot}
                view={topicView}
                onOpenQuestions={() => void leaveCurrent(() => setTopicView("questions"))}
                onCreateQuestion={() => void leaveCurrent(() => {
                  setCardSeed({ topicID: selectedTopic.id, token: crypto.randomUUID() });
                  setTopicView("questions");
                })}
                onBackToOverview={() => void leaveCurrent(() => setTopicView("overview"))}
                onSnapshot={setSnapshot}
                onStartReview={(items) => void leaveCurrent(() => openReview(items, items.length))}
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
      {createTopicOpen && <CreateTopicDialog
        onClose={() => setCreateTopicOpen(false)}
        onCreated={(result) => {
          setSnapshot(result.snapshot);
          setSelectedTopicID(result.topic.id);
          setCreateTopicOpen(false);
        }}
      />}
    </div>
  );
}

function Sidebar({ snapshot, selectedTopicID, collapsed, onToggleCollapsed, onSelect, onOpenHome, onOpenQuestions, onCreateTopic, globalView }: {
  snapshot: AppSnapshot;
  selectedTopicID?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onOpenHome: () => void;
  onOpenQuestions: () => void;
  onCreateTopic: () => void;
  globalView: GlobalView;
}) {
  const [topicsOpen, setTopicsOpen] = useState(false);

  const toggleTopics = () => {
    if (collapsed) {
      onToggleCollapsed();
      setTopicsOpen(true);
      return;
    }
    setTopicsOpen((current) => !current);
  };

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <Logo />
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>
      <button className={`plan-nav ${globalView === "home" ? "selected" : ""}`} aria-label="Home" aria-current={globalView === "home" ? "page" : undefined} onClick={onOpenHome}><House /><span>Home</span></button>
      <button className={`plan-nav ${globalView === "questions" ? "selected" : ""}`} aria-label="Questions" aria-current={globalView === "questions" ? "page" : undefined} onClick={onOpenQuestions}><CircleHelp /><span>Questions</span></button>
      <button
        className="plan-nav topics-nav"
        aria-label={collapsed ? "Expand sidebar topics" : "Topics"}
        aria-expanded={!collapsed && topicsOpen}
        aria-controls="sidebar-topic-list"
        onClick={toggleTopics}
      >
        <BookOpen /><span>Topics</span><ChevronDown className={topicsOpen ? "rotated" : ""} />
      </button>
      {topicsOpen && <div className="topic-list" id="sidebar-topic-list">
        {snapshot.topics.map((topic) => <button
          key={topic.id}
          className={`topic-item ${selectedTopicID === topic.id ? "selected" : ""}`}
          aria-current={selectedTopicID === topic.id ? "page" : undefined}
          onClick={() => {
            onSelect(topic.id);
          }}
        >
          <i />
          <div><strong>{topic.title}</strong><small>{activeQuestions(topic).length} questions</small></div>
        </button>)}
        <button type="button" className="new-topic-button" onClick={() => {
          setTopicsOpen(false);
          onCreateTopic();
        }}>
          <Plus /><span>New topic</span>
        </button>
      </div>}
    </aside>
  );
}

function TopicDetail({ topic, snapshot, view, onOpenQuestions, onCreateQuestion, onBackToOverview, onSnapshot, onStartReview, onReviewQuestion, onRegisterCardsBeforeLeave, cardSeed, onCardSeedConsumed }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  view: TopicView;
  onOpenQuestions: () => void;
  onCreateQuestion: () => void;
  onBackToOverview: () => void;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onStartReview: (items: DueReviewItem[]) => void;
  onReviewQuestion: (topic: KnowledgeTopic, question: Question) => void;
  onRegisterCardsBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
  cardSeed?: { sentence?: string; token: string };
  onCardSeedConsumed: () => void;
}) {
  const reviewItems = dueReviewItems(snapshot).filter((item) => item.topicID === topic.id);

  if (view === "questions") {
    return <div className="topic-detail questions-topic-detail">
      <button className="topic-back" type="button" onClick={onBackToOverview}><ArrowLeft /> Topic overview</button>
      <CardWorkspace key={topic.id} topic={topic} onSnapshot={onSnapshot} onReview={(question) => onReviewQuestion(topic, question)} onRegisterBeforeLeave={onRegisterCardsBeforeLeave} seedSentence={cardSeed?.sentence} seedToken={cardSeed?.token} onSeedConsumed={onCardSeedConsumed} />
    </div>;
  }

  return (
    <div className="topic-detail topic-overview">
      <header className="topic-overview-header">
        <Eyebrow>Topic overview</Eyebrow>
        <h1>{topic.title}</h1>
        <p>{topic.summary}</p>
        <div className="topic-overview-actions">
          <section className="surface topic-next-step" aria-labelledby="topic-next-step-heading">
            <div>
              <Eyebrow>Next step</Eyebrow>
              <h2 id="topic-next-step-heading">Review what’s ready</h2>
              <p>{reviewItems.length ? `${reviewItems.length} questions are ready for a focused review.` : "Nothing is due right now. You can still build this topic below."}</p>
            </div>
            <button className="primary topic-review-button" type="button" disabled={!reviewItems.length} onClick={() => onStartReview(reviewItems)}><Play fill="currentColor" /> {reviewItems.length ? `Review ${reviewItems.length}` : "Nothing ready"}</button>
          </section>
          <div className="topic-action-grid" aria-label="Topic actions">
            <button className="topic-action-card" type="button" onClick={onCreateQuestion}>
              <span className="topic-action-icon"><SquarePen /></span>
              <span className="topic-action-copy"><strong>Create question</strong><small>Turn a concept into a retrieval check.</small></span>
              <ArrowRight />
            </button>
            <button className="topic-action-card" type="button" onClick={onOpenQuestions}>
              <span className="topic-action-icon"><BookOpen /></span>
              <span className="topic-action-copy"><strong>Manage questions</strong><small>Browse, edit, or add review cards.</small></span>
              <ArrowRight />
            </button>
          </div>
        </div>
      </header>
    </div>
  );
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
        setError("The knowledge folder was not changed because the current workflow could not be closed.");
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
    <p>Revember needs at least one valid topic before it can create review questions. Add topic JSON files to <code>{root}/topics</code>, or choose another folder.</p>
    <div className="empty-state-actions">
      <button className="primary" type="button" onClick={onOpenSettings}><Folder /> Choose folder</button>
      <button type="button" disabled={reloading} onClick={() => void reload()}><RefreshCw className={reloading ? "spin" : undefined} /> {reloading ? "Reloading…" : "Reload topics"}</button>
    </div>
    {error && <InlineError message={error} />}
  </div>;
}
