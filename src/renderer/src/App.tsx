import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CircleAlert,
  CircleHelp,
  Cog,
  ExternalLink,
  Folder,
  House,
  PanelLeftClose,
  PanelLeftOpen,
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
import { dueReviewItems } from "../../../shared/domain";
import { CardWorkspace } from "./components/CardWorkspace";
import { NotesPage } from "./components/NotesPage";
import { HomePage } from "./components/HomePage";
import { QuestionsPage, type QuestionLibraryFocus } from "./components/QuestionsPage";
import { Eyebrow } from "./components/ui";
import { Modal } from "./components/modal";
import { ReviewSession } from "./components/ReviewFlow";
import { InlineError } from "./components/review-ui";
import { isKnowledgeRootChangeAllowed, runGuardedKnowledgeRootChange } from "./knowledgeRootChange";
import { runBeforeLeaveGuards, type BeforeLeaveGuard } from "./navigationGuard";
import { toErrorMessage } from "./utils";

type GlobalView = "home" | "topic" | "notes" | "questions";

type ReviewReturnTarget =
  | { view: "home"; label: "Study focus" }
  | { view: "questions"; label: "Question Library"; focus: QuestionLibraryFocus }
  | { view: "topic"; label: string; topicID: string };

type ActiveReview = {
  items: DueReviewItem[];
  label: string;
  returnTo: ReviewReturnTarget;
};

type ReviewOptions = {
  label: string;
  returnTo: ReviewReturnTarget;
  limit?: number;
};

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [snapshotError, setSnapshotError] = useState<string>();
  const [selectedTopicID, setSelectedTopicID] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeReview, setActiveReview] = useState<ActiveReview>();
  const [questionLibraryFocus, setQuestionLibraryFocus] = useState<QuestionLibraryFocus>();
  const [globalView, setGlobalView] = useState<GlobalView>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notesVisitKey, setNotesVisitKey] = useState(0);
  const [notesTopicID, setNotesTopicID] = useState<string>();
  const [notesCaptureID, setNotesCaptureID] = useState<string>();
  const [notesCreateRequested, setNotesCreateRequested] = useState(false);
  const [cardSeed, setCardSeed] = useState<{ topicID: string; sentence?: string; token: string }>();
  const beforeLeaveGuards = useRef(new Map<string, BeforeLeaveGuard>());

  const registerBeforeLeave = useCallback((key: string, handler: BeforeLeaveGuard | undefined) => {
    if (handler) beforeLeaveGuards.current.set(key, handler);
    else beforeLeaveGuards.current.delete(key);
  }, []);

  const registerCardsBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("card-editor", handler);
  }, [registerBeforeLeave]);

  const registerNotesBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("notes-editor", handler);
  }, [registerBeforeLeave]);

  const canLeaveCurrent = useCallback(
    () => runBeforeLeaveGuards(beforeLeaveGuards.current.values()),
    []
  );

  const leaveCurrent = useCallback(async (action: () => void) => {
    if (!await canLeaveCurrent()) return;
    action();
  }, [canLeaveCurrent]);

  const openReview = useCallback((items: DueReviewItem[], { label, returnTo, limit = items.length }: ReviewOptions) => {
    setActiveReview({ items: items.slice(0, limit), label, returnTo });
  }, []);

  const finishReview = useCallback((review: ActiveReview) => {
    setActiveReview(undefined);
    const { returnTo } = review;
    if (returnTo.view === "home") {
      setGlobalView("home");
      return;
    }
    if (returnTo.view === "questions") {
      setQuestionLibraryFocus(returnTo.focus);
      setGlobalView("questions");
      return;
    }
    setSelectedTopicID(returnTo.topicID);
    setGlobalView("topic");
  }, []);

  const openNotes = useCallback((topicID?: string, create = false) => {
    setNotesTopicID(topicID);
    setNotesCaptureID(undefined);
    setNotesCreateRequested(create);
    setNotesVisitKey((current) => current + 1);
    setGlobalView("notes");
  }, []);

  const openTopic = useCallback((topicID: string) => {
    setGlobalView("topic");
    setSelectedTopicID(topicID);
  }, []);

  const startQuestionAuthoring = useCallback((topicID: string, sentence?: string) => {
    setSelectedTopicID(topicID);
    setCardSeed({ topicID, ...(sentence ? { sentence } : {}), token: crypto.randomUUID() });
    setGlobalView("topic");
  }, []);

  const startReview = useCallback((minutes = 3) => {
    if (!snapshot) return;
    const capacity = Math.max(1, Math.floor(minutes * 60 / 45));
    openReview(dueReviewItems(snapshot), {
      limit: capacity,
      label: "Study focus",
      returnTo: { view: "home", label: "Study focus" }
    });
  }, [openReview, snapshot]);

  const startQuestionReview = useCallback((topic: KnowledgeTopic, question: Question, returnTo: ReviewReturnTarget) => {
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
    }], { limit: 1, label: "Practice", returnTo });
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
    else if (route.startsWith("review:")) void leaveCurrent(() => startReview(Number(route.split(":")[1]) || 3));
    else if (route.startsWith("topic:")) {
      const topicID = route.slice("topic:".length);
      if (globalView === "topic" && selectedTopicID === topicID) return;
      void leaveCurrent(() => {
        setActiveReview(undefined);
        openTopic(topicID);
      });
    }
  }), [globalView, leaveCurrent, openTopic, selectedTopicID, startReview]);

  if (!snapshot) {
    return snapshotError
      ? <StartupError message={snapshotError} onRetry={() => void loadInitialSnapshot()} />
      : <LoadingScreen />;
  }
  const selectedTopic = snapshot.topics.find((topic) => topic.id === selectedTopicID) ?? snapshot.topics[0];
  const knowledgeRootChangeAllowed = isKnowledgeRootChangeAllowed(
    globalView,
    activeReview !== undefined
  );
  const applyKnowledgeRootSnapshot = (next: AppSnapshot) => {
    setSnapshot(next);
    setActiveReview(undefined);
    setCardSeed(undefined);
    setNotesTopicID(undefined);
    setNotesCaptureID(undefined);
    setSelectedTopicID(next.topics[0]?.id);
    setGlobalView("home");
  };

  return (
    <div className="app-shell">
      <div className="titlebar" aria-hidden="true"><span>Revember</span></div>
      {activeReview ? (
        <ReviewSession
          items={activeReview.items}
          sessionLabel={activeReview.label}
          returnLabel={activeReview.returnTo.label}
          onSnapshot={setSnapshot}
          onFinish={() => finishReview(activeReview)}
        />
      ) : (
        <div className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            onOpenHome={() => {
              if (globalView !== "home") void leaveCurrent(() => setGlobalView("home"));
            }}
            onOpenNotes={() => void leaveCurrent(() => openNotes())}
            onOpenQuestions={() => {
              if (globalView !== "questions") void leaveCurrent(() => setGlobalView("questions"));
            }}
            globalView={globalView}
          />
          <main className="main-stage">
            <div className="toolbar-actions">
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
              onStartReview={(items) => void leaveCurrent(() => openReview(items, {
                label: "Study focus",
                returnTo: { view: "home", label: "Study focus" }
              }))}
              onCreateNote={() => void leaveCurrent(() => openNotes(undefined, true))}
            /> : globalView === "notes" ? <NotesPage
              key={`${snapshot.settings.knowledgeRootPath}:${notesVisitKey}`}
              snapshot={snapshot}
              initialTopicID={notesTopicID}
              initialCaptureID={notesCaptureID}
              initialCreate={notesCreateRequested}
              onCreateQuestionForTopic={(topicID, sentence) => void leaveCurrent(() => startQuestionAuthoring(topicID, sentence))}
              onRegisterBeforeLeave={registerNotesBeforeLeave}
            /> : globalView === "questions" ? <QuestionsPage
              snapshot={snapshot}
              onStartReview={(items, label) => void leaveCurrent(() => openReview(items, {
                label,
                returnTo: { view: "questions", label: "Question Library", focus: { kind: "review-dock" } }
              }))}
              onStartTopicReview={(topic, items) => void leaveCurrent(() => openReview(items, {
                label: topic.title + " review",
                returnTo: { view: "questions", label: "Question Library", focus: { kind: "topic", topicID: topic.id } }
              }))}
              onCreateQuestion={(topic) => void leaveCurrent(() => startQuestionAuthoring(topic.id))}
              onOpenTopic={(topic) => void leaveCurrent(() => {
                openTopic(topic.id);
                setCardSeed(undefined);
              })}
              returnFocus={questionLibraryFocus}
              onReturnFocusHandled={() => setQuestionLibraryFocus(undefined)}
            /> : selectedTopic ? (
              <TopicDetail
                topic={selectedTopic}
                onBack={() => void leaveCurrent(() => setGlobalView("questions"))}
                onSnapshot={setSnapshot}
                onReviewQuestion={(topic, question) => void leaveCurrent(() => startQuestionReview(topic, question, {
                  view: "topic",
                  label: topic.title,
                  topicID: topic.id
                }))}
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
    </div>
  );
}

function Sidebar({ collapsed, onToggleCollapsed, onOpenHome, onOpenNotes, onOpenQuestions, globalView }: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenHome: () => void;
  onOpenNotes: () => void;
  onOpenQuestions: () => void;
  globalView: GlobalView;
}) {
  const navigation = [
    { key: "home", label: "Today", icon: <House />, onClick: onOpenHome },
    { key: "notes", label: "Notes", icon: <SquarePen />, onClick: onOpenNotes },
    { key: "questions", label: "Questions", icon: <CircleHelp />, onClick: onOpenQuestions }
  ] as const;

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
      {navigation.map(({ key, label, icon, onClick }) => (
        <button key={key} className={`plan-nav ${globalView === key ? "selected" : ""}`} aria-label={label} aria-current={globalView === key ? "page" : undefined} onClick={onClick}>
          {icon}<span>{label}</span>
        </button>
      ))}
    </aside>
  );
}

function TopicDetail({ topic, onBack, onSnapshot, onReviewQuestion, onRegisterCardsBeforeLeave, cardSeed, onCardSeedConsumed }: {
  topic: KnowledgeTopic;
  onBack: () => void;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onReviewQuestion: (topic: KnowledgeTopic, question: Question) => void;
  onRegisterCardsBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
  cardSeed?: { sentence?: string; token: string };
  onCardSeedConsumed: () => void;
  }) {
  return (
    <div className="topic-detail questions-topic-detail">
      <button className="topic-back" type="button" onClick={onBack}><ArrowLeft /> Question Library</button>
      <CardWorkspace key={topic.id} topic={topic} onSnapshot={onSnapshot} onReview={(question) => onReviewQuestion(topic, question)} onRegisterBeforeLeave={onRegisterCardsBeforeLeave} seedSentence={cardSeed?.sentence} seedToken={cardSeed?.token} onSeedConsumed={onCardSeedConsumed} />
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
      <Eyebrow>Your learning folder</Eyebrow>
      <p>Revember keeps your editable notes and questions here. It is set up from the included starter vault the first time you open the app.</p>
      <code>{snapshot.settings.knowledgeRootPath}</code>
      {!knowledgeRootChangeAllowed && <p className="settings-guidance">To change knowledge folders, finish or exit the current workflow and return Home.</p>}
      <div className="settings-actions">
        <button disabled={busy || !knowledgeRootChangeAllowed} onClick={() => void changeKnowledgeRoot(window.revember.chooseKnowledgeRoot)}><Folder /> Use another folder</button>
        <button disabled={busy} onClick={() => void invoke(window.revember.openKnowledgeRoot)}><ExternalLink /> Open Folder</button>
        <button disabled={busy || !knowledgeRootChangeAllowed} onClick={() => void changeKnowledgeRoot(window.revember.resetKnowledgeRoot)}><RotateCcw /> Use starter folder</button>
      </div>
    </div>
    <div className="settings-section"><Eyebrow>Progress</Eyebrow><p>Progress stays readable and local at:</p><code>{snapshot.settings.progressPath}</code></div>
    <div className="settings-section notification-row"><div><Eyebrow>Review Reminders</Eyebrow><p>Notify you while Revember is running when a scheduled check becomes due.</p></div><button className={`toggle ${snapshot.settings.notificationsEnabled ? "on" : ""}`} type="button" role="switch" aria-label="Review reminders" aria-checked={snapshot.settings.notificationsEnabled} disabled={busy} onClick={() => void invoke(() => window.revember.setNotificationsEnabled(!snapshot.settings.notificationsEnabled))}><span /></button></div>
    {error && <div className="settings-error"><InlineError message={error} /></div>}
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
