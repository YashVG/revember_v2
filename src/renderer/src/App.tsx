import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  CircleHelp,
  Cog,
  ExternalLink,
  FileText,
  Folder,
  House,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Settings,
  SquarePen,
} from "lucide-react";
import type {
  AppSnapshot,
  AuthState,
  DueReviewItem,
  KnowledgeTopic,
  Question
} from "../../../shared/types";
import { dueReviewItems } from "../../../shared/domain";
import { CardWorkspace } from "./components/CardWorkspace";
import { NotesPage } from "./components/NotesPage";
import { HomePage } from "./components/HomePage";
import { QuestionsPage } from "./components/QuestionsPage";
import { Eyebrow } from "./components/ui";
import { Modal } from "./components/modal";
import { ReviewSession } from "./components/ReviewFlow";
import { InlineError } from "./components/review-ui";
import { CreateTopicDialog } from "./components/CreateTopicDialog";
import { AuthPage } from "./components/AuthPage";
import { isKnowledgeRootChangeAllowed, runGuardedKnowledgeRootChange } from "./knowledgeRootChange";
import { runBeforeLeaveGuards, type BeforeLeaveGuard } from "./navigationGuard";
import { toErrorMessage } from "./utils";

type TopicView = "overview" | "questions";
type GlobalView = "home" | "topic" | "notes" | "questions";

export function App() {
  const [authState, setAuthState] = useState<AuthState>();
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
  const [notesVisitKey, setNotesVisitKey] = useState(0);
  const [notesTopicID, setNotesTopicID] = useState<string>();
  const [notesCaptureID, setNotesCaptureID] = useState<string>();
  const [notesCreateRequested, setNotesCreateRequested] = useState(false);
  const [cardSeed, setCardSeed] = useState<{ topicID: string; sentence?: string; token: string }>();
  const beforeLeaveGuards = useRef(new Map<string, BeforeLeaveGuard>());

  useEffect(() => {
    void window.revember.getAuthState().then(setAuthState).catch((cause) => {
      setAuthState({ configured: false, configurationError: toErrorMessage(cause) });
    });
    return window.revember.onAuthState(setAuthState);
  }, []);

  const registerBeforeLeave = useCallback((key: string, handler: BeforeLeaveGuard | undefined) => {
    if (handler) beforeLeaveGuards.current.set(key, handler);
    else beforeLeaveGuards.current.delete(key);
  }, []);

  const registerCardsBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("card-editor", handler);
  }, [registerBeforeLeave]);

  const registerHomeBeforeLeave = useCallback((handler: BeforeLeaveGuard | undefined) => {
    registerBeforeLeave("home", handler);
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

  const openReview = useCallback((items: DueReviewItem[], limit = 4) => {
    setReviewItems(items.slice(0, limit));
  }, []);

  const openNotes = useCallback((topicID?: string, create = false) => {
    setNotesTopicID(topicID);
    setNotesCaptureID(undefined);
    setNotesCreateRequested(create);
    setNotesVisitKey((current) => current + 1);
    setGlobalView("notes");
  }, []);

  const openTopic = useCallback((topicID: string, view: TopicView = "overview") => {
    setGlobalView("topic");
    setSelectedTopicID(topicID);
    setTopicView(view);
  }, []);

  const startQuestionAuthoring = useCallback((topicID: string, sentence?: string) => {
    setSelectedTopicID(topicID);
    setTopicView("questions");
    setCardSeed({ topicID, ...(sentence ? { sentence } : {}), token: crypto.randomUUID() });
    setGlobalView("topic");
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
        openTopic(topicID);
      });
    }
  }), [globalView, leaveCurrent, openTopic, selectedTopicID, startReview]);

  if (!authState) return <LoadingScreen />;
  if (!authState.user) return <AuthPage state={authState} onState={setAuthState} />;
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
    setNotesTopicID(undefined);
    setNotesCaptureID(undefined);
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
          onFinish={() => {
            setReviewItems(null);
            setGlobalView("home");
          }}
          onOpenCheckpoint={() => setCheckpointOpen(true)}
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
              onStartReview={(items) => void leaveCurrent(() => openReview(items, items.length))}
              onOpenNotes={(topicID) => void leaveCurrent(() => openNotes(topicID))}
              onCreateNote={() => void leaveCurrent(() => openNotes(undefined, true))}
              onRegisterBeforeLeave={registerHomeBeforeLeave}
              onOpenTopic={(topicID) => void leaveCurrent(() => openTopic(topicID))}
              onCreateTopic={() => setCreateTopicOpen(true)}
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
              onReview={(topic, question) => void leaveCurrent(() => startQuestionReview(topic, question))}
              onStartReview={(items) => void leaveCurrent(() => openReview(items, items.length))}
              onCreateQuestion={(topic) => void leaveCurrent(() => startQuestionAuthoring(topic.id))}
              onOpenTopic={(topic) => void leaveCurrent(() => {
                openTopic(topic.id, "questions");
                setCardSeed(undefined);
              })}
            /> : selectedTopic ? (
              <TopicDetail
                topic={selectedTopic}
                snapshot={snapshot}
                view={topicView}
                onOpenQuestions={() => void leaveCurrent(() => setTopicView("questions"))}
                onOpenNotes={() => void leaveCurrent(() => openNotes(selectedTopic.id))}
                onCreateQuestion={() => void leaveCurrent(() => startQuestionAuthoring(selectedTopic.id))}
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
        authState={authState}
        onSnapshot={setSnapshot}
        onSignOut={async () => {
          setAuthState(await window.revember.signOut());
          setSettingsOpen(false);
        }}
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

function Sidebar({ collapsed, onToggleCollapsed, onOpenHome, onOpenNotes, onOpenQuestions, globalView }: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenHome: () => void;
  onOpenNotes: () => void;
  onOpenQuestions: () => void;
  globalView: GlobalView;
}) {
  const navigation = [
    { key: "home", label: "Home", icon: <House />, onClick: onOpenHome },
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

function TopicDetail({ topic, snapshot, view, onOpenQuestions, onOpenNotes, onCreateQuestion, onBackToOverview, onSnapshot, onStartReview, onReviewQuestion, onRegisterCardsBeforeLeave, cardSeed, onCardSeedConsumed }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  view: TopicView;
  onOpenQuestions: () => void;
  onOpenNotes: () => void;
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

  const actions = [
    { key: "create", icon: <SquarePen />, title: "Create question", description: "Turn a concept into a retrieval check.", onClick: onCreateQuestion },
    { key: "manage", icon: <BookOpen />, title: "Manage questions", description: "Browse, edit, or add review cards.", onClick: onOpenQuestions },
    { key: "notes", icon: <FileText />, title: "View notes", description: "Open the notes connected to this topic.", onClick: onOpenNotes }
  ] as const;

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
            {actions.map(({ key, icon, title, description, onClick }) => (
              <button key={key} className="topic-action-card" type="button" onClick={onClick}>
                <span className="topic-action-icon">{icon}</span>
                <span className="topic-action-copy"><strong>{title}</strong><small>{description}</small></span>
                <ArrowRight />
              </button>
            ))}
          </div>
        </div>
      </header>
    </div>
  );
}

function SettingsDialog({ snapshot, authState, onSnapshot, onSignOut, onKnowledgeRootChanged, onBeforeKnowledgeRootChange, knowledgeRootChangeAllowed, onClose }: {
  snapshot: AppSnapshot;
  authState: AuthState;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onSignOut: () => Promise<void>;
  onKnowledgeRootChanged: (snapshot: AppSnapshot) => void;
  onBeforeKnowledgeRootChange: () => Promise<boolean>;
  knowledgeRootChangeAllowed: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const [mcpMessage, setMcpMessage] = useState<string>();
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
  const configureMcp = async (client: "codex" | "claude", action: "connect" | "disconnect") => {
    if (busy) return;
    try {
      setBusy(true);
      setError(undefined);
      setMcpMessage(undefined);
      const result = await window.revember.configureMcpClient(client, action);
      const clientName = result.client === "codex" ? "Codex" : "Claude";
      setMcpMessage(action === "connect"
        ? `${clientName} is connected. Restart ${clientName} to load Revember's MCP tools.`
        : `${clientName}'s Revember connection was removed.`);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return <Modal title="Revember Settings" icon={<Settings />} onClose={onClose}>
    <div className="settings-section">
      <Eyebrow>Account</Eyebrow>
      <p>Signed in as <strong>{authState.user?.email}</strong>. When cloud vault sync is enabled, it will remain private to this account.</p>
      <div className="settings-actions"><button className="text-button" disabled={busy} onClick={() => void onSignOut()}>Sign out</button></div>
    </div>
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
    <div className="settings-section">
      <Eyebrow>AI study partner</Eyebrow>
      <p>Connect Codex or Claude to this local knowledge vault. Revember supplies the MCP runtime and follows the vault selected above.</p>
      <div className="settings-actions">
        <button disabled={busy} onClick={() => void configureMcp("codex", "connect")}>Connect Codex</button>
        <button disabled={busy} onClick={() => void configureMcp("claude", "connect")}>Connect Claude</button>
      </div>
      <div className="settings-actions">
        <button className="text-button" disabled={busy} onClick={() => void configureMcp("codex", "disconnect")}>Disconnect Codex</button>
        <button className="text-button" disabled={busy} onClick={() => void configureMcp("claude", "disconnect")}>Disconnect Claude</button>
      </div>
      {mcpMessage && <p className="settings-guidance">{mcpMessage}</p>}
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
  return <Modal title="Reflect on this session" icon={<SquarePen />} className="checkpoint-dialog" onClose={onClose}>
    {savedPath ? <div className="checkpoint-saved"><Check /><h3>Reflection saved</h3><p>Your learning reflection is now available to Revember and the local MCP server.</p><code>{savedPath}</code><button className="primary" onClick={onClose}>Done</button></div> : <div className="checkpoint-form">
      <label><span>What changed in your understanding?</span><textarea autoFocus value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Write one concrete thing you can now explain or distinguish…" /></label>
      <label><span>Topic</span><select value={topicID} onChange={(event) => setTopicID(event.target.value)}><option value="">General checkpoint</option>{snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
      <label><span>Open question <small>optional</small></span><input value={openQuestion} onChange={(event) => setOpenQuestion(event.target.value)} placeholder="What still feels unresolved?" /></label>
      {error && <InlineError message={error} />}<div className="dialog-footer"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!summary.trim()} onClick={save}>Save reflection</button></div>
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
