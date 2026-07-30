import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, BookOpen, FileText, LoaderCircle, Pencil, Plus, Save, Sparkles } from "lucide-react";
import type { AppSnapshot, CaptureStatus, CaptureSummary, LearnerCapture } from "../../../../shared/types";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { Eyebrow } from "./ui";
import { InlineError } from "./review-ui";
import { useDialogFocus } from "./useDialogFocus";
import type { BeforeLeaveGuard } from "../navigationGuard";
import { useBeforeUnloadGuard } from "../hooks/useBeforeUnloadGuard";
import { resolveRevisionConflict, toErrorMessage } from "../utils";
import { NoteSourceReader } from "./NoteSourceReader";

export { materializeReadingSections } from "./NoteSourceReader";

type SaveState = "draft" | "saving" | "saved" | "conflict" | "error";
type NoteForm = {
  topicID: string;
  title: string;
  rawText: string;
  status: Exclude<CaptureStatus, "archived">;
};

const CAPTURE_CONFLICT_MESSAGE =
  "This note changed somewhere else. Reload it before retrying; every local edit is still in this form.";

function summaryOf(capture: LearnerCapture): CaptureSummary {
  return {
    id: capture.id,
    revision: capture.revision,
    topicID: capture.topicID,
    title: capture.title,
    origin: capture.origin,
    status: capture.status,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt
  };
}

type NotesPageProps = {
  snapshot: AppSnapshot;
  initialTopicID?: string;
  initialCaptureID?: string;
  initialCreate?: boolean;
  onCreateQuestionForTopic: (topicID: string) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
};

export function NotesPage({ snapshot, initialTopicID, initialCaptureID, initialCreate = false, onCreateQuestionForTopic, onRegisterBeforeLeave }: NotesPageProps) {
  const [summaries, setSummaries] = useState<CaptureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [loadingID, setLoadingID] = useState<string>();
  const [selectedTopicID, setSelectedTopicID] = useState<string | undefined>(initialTopicID);
  const [selectedID, setSelectedID] = useState<string>();
  const [selectedCapture, setSelectedCapture] = useState<LearnerCapture>();
  const [editor, setEditor] = useState<LearnerCapture | "new" | undefined>(initialCreate ? "new" : undefined);
  const [archiveTarget, setArchiveTarget] = useState<CaptureSummary>();
  const [finishingID, setFinishingID] = useState<string>();
  const finishInFlight = useRef(false);
  const initialTopicApplied = useRef(false);

  useEffect(() => {
    let alive = true;
    void window.revember.listCaptureSummaries().then((next) => {
      if (!alive) return;
      setSummaries(next);
      setListError(undefined);
    }).catch((cause) => {
      if (alive) setListError(toErrorMessage(cause));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setSelectedTopicID((current) => current && snapshot.topics.some((topic) => topic.id === current) ? current : undefined);
  }, [snapshot.topics]);

  useEffect(() => {
    if (!selectedID) {
      setSelectedCapture(undefined);
      return;
    }

    let alive = true;
    setSelectedCapture(undefined);
    setLoadingID(selectedID);
    // The list is metadata-only. This is the one deliberate full-record read.
    void window.revember.getCapture(selectedID)
      .then((capture) => {
        if (alive) setSelectedCapture(capture);
      })
      .catch((cause) => {
        if (alive) {
          setSelectedCapture(undefined);
          setListError(toErrorMessage(cause));
        }
      })
      .finally(() => {
        if (alive) setLoadingID(undefined);
      });

    return () => {
      alive = false;
    };
  }, [selectedID]);

  const replaceSummary = useCallback((capture: LearnerCapture) => {
    setSummaries((current) => [...current.filter((item) => item.id !== capture.id), summaryOf(capture)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)));
    setSelectedID(capture.status === "archived" ? undefined : capture.id);
    setSelectedCapture(capture.status === "archived" ? undefined : capture);
  }, []);

  const handleArchive = (capture: LearnerCapture) => {
    replaceSummary(capture);
    if (selectedID === capture.id) {
      setSelectedID(summaries.find((item) => item.id !== capture.id && item.status !== "archived" && item.topicID === capture.topicID)?.id);
    }
  };

  const finishCapture = async (capture: LearnerCapture) => {
    if (finishInFlight.current) return;
    try {
      finishInFlight.current = true;
      setFinishingID(capture.id);
      setListError(undefined);
      replaceSummary(await window.revember.finishCapture(capture.id, capture.revision));
    } catch (cause) {
      setListError(resolveRevisionConflict(cause, CAPTURE_CONFLICT_MESSAGE).message);
    } finally {
      finishInFlight.current = false;
      setFinishingID(undefined);
    }
  };

  const active = summaries.filter((item) => item.status !== "archived");
  const archived = summaries.filter((item) => item.status === "archived");
  const selectedTopic = snapshot.topics.find((topic) => topic.id === selectedTopicID);
  const topicNotes = selectedTopic ? active.filter((item) => item.topicID === selectedTopic.id) : [];
  const topicArchivedNotes = selectedTopic ? archived.filter((item) => item.topicID === selectedTopic.id) : [];

  useEffect(() => {
    if (loading || !initialTopicID || initialTopicApplied.current) return;
    initialTopicApplied.current = true;
    if (!snapshot.topics.some((topic) => topic.id === initialTopicID)) return;
    setSelectedTopicID(initialTopicID);
    setSelectedCapture(undefined);
    const initialCapture = initialCaptureID
      ? active.find((item) => item.id === initialCaptureID && item.topicID === initialTopicID)
      : undefined;
    setSelectedID(initialCapture?.id ?? active.find((item) => item.topicID === initialTopicID)?.id);
  }, [active, initialCaptureID, initialTopicID, loading, snapshot.topics]);

  const selectTopic = (topicID: string) => {
    setSelectedTopicID(topicID);
    setSelectedCapture(undefined);
    setSelectedID(active.find((item) => item.topicID === topicID)?.id);
  };

  const showTopics = () => {
    setSelectedTopicID(undefined);
    setSelectedID(undefined);
    setSelectedCapture(undefined);
  };

  if (editor) {
    return (
      <div className="notes-page">
        <NoteEditor
          snapshot={snapshot}
          capture={editor === "new" ? undefined : editor}
          initialTopicID={selectedTopicID}
          onClose={() => setEditor(undefined)}
          onSaved={(capture) => {
            replaceSummary(capture);
            setSelectedTopicID(capture.topicID);
          }}
          onRegisterBeforeLeave={onRegisterBeforeLeave}
        />
      </div>
    );
  }

  return (
    <div className="notes-page">
      {listError && <InlineError message={listError} />}
      {loading ? (
        <div className="surface notes-loading"><LoaderCircle className="spin" /> Loading note metadata…</div>
      ) : !selectedTopic ? (
        <section className="surface notes-topic-browser" aria-labelledby="notes-topics-heading">
          <div className="notes-topic-browser-heading">
            <div>
              <Eyebrow id="notes-topics-heading">Notes</Eyebrow>
              <h2>Your notes</h2>
              <p className="notes-topic-browser-description">Choose a topic to open its notes, or start writing immediately.</p>
            </div>
            <div className="notes-topic-browser-actions">
              <span>{snapshot.topics.length}</span>
              <button className="primary" type="button" disabled={snapshot.topics.length === 0} onClick={() => setEditor("new")}>
                <Plus /> New note
              </button>
            </div>
          </div>
          {snapshot.topics.length > 0 ? (
            <nav className="notes-topic-list" aria-label="Notes topics">
              {snapshot.topics.map((topic) => {
                const count = active.filter((note) => note.topicID === topic.id).length;
                return (
                  <button key={topic.id} type="button" className="notes-topic-item" onClick={() => selectTopic(topic.id)}>
                    <span className="notes-topic-icon"><BookOpen /></span>
                    <span className="notes-topic-copy">
                      <strong>{topic.title}</strong>
                      <small>{topic.summary || "Browse this topic's captured notes."}</small>
                    </span>
                    <span className="notes-topic-count">{count} {count === 1 ? "note" : "notes"}</span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="notes-topic-empty">
              <BookOpen />
              <p>Add a topic before creating notes.</p>
            </div>
          )}
        </section>
      ) : (
        <div className="notes-workspace">
          <aside className="surface notes-index" aria-label="Notes list">
            <button type="button" className="notes-back-to-topics" onClick={showTopics}><ArrowLeft /> Topics</button>
            <div className="notes-index-heading">
              <div>
                <strong>{selectedTopic.title}</strong>
              </div>
              <span>{topicNotes.length}</span>
            </div>
            {topicNotes.length > 0 && (
              <button className="primary notes-index-new-note" type="button" onClick={() => setEditor("new")}>
                <Plus /> New note
              </button>
            )}
            {topicNotes.length > 0 ? (
              <nav className="notes-index-list">
                {topicNotes.map((note) => (
                  <NoteListItem
                    key={note.id}
                    note={note}
                    selected={selectedID === note.id}
                    loading={loadingID === note.id}
                    onSelect={() => setSelectedID(note.id)}
                  />
                ))}
              </nav>
            ) : (
              <div className="notes-index-empty">
                <FileText />
                <span>No notes yet</span>
                <button type="button" className="text-button" onClick={() => setEditor("new")}><Plus /> Create note</button>
              </div>
            )}
            {topicArchivedNotes.length > 0 && (
              <details className="notes-archived">
                <summary>Archived · {topicArchivedNotes.length}</summary>
                <ul>
                  {topicArchivedNotes.map((note) => (
                    <li key={note.id}>{note.title}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
          <section className="surface note-reader">
            {selectedCapture ? (
              <NoteReader
                capture={selectedCapture}
                snapshot={snapshot}
                onEdit={() => setEditor(selectedCapture)}
                onArchive={() => setArchiveTarget(summaryOf(selectedCapture))}
                onFinish={() => void finishCapture(selectedCapture)}
                finishing={finishingID === selectedCapture.id}
                onCreateQuestionForTopic={onCreateQuestionForTopic}
              />
            ) : (
              <NoteReaderEmpty topicTitle={selectedTopic.title} hasNotes={topicNotes.length > 0} onCreate={() => setEditor("new")} />
            )}
          </section>
        </div>
      )}
      {archiveTarget && (
        <ArchiveNoteDialog
          note={archiveTarget}
          onArchived={handleArchive}
          onClose={() => setArchiveTarget(undefined)}
        />
      )}
    </div>
  );
}

function NoteListItem({ note, selected, loading, onSelect }: {
  note: CaptureSummary;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`note-list-item ${selected ? "selected" : ""}`}
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
    >
      <span className="note-list-icon">{loading ? <LoaderCircle className="spin" /> : <FileText />}</span>
      <span className="note-list-copy">
        <strong>{note.title}</strong>
        <small>{note.origin === "ollama" ? "AI-generated · " : ""}{note.status === "ready" ? "Ready to review" : "Draft"}</small>
      </span>
    </button>
  );
}

function NoteReader({ capture, snapshot, onEdit, onArchive, onFinish, finishing, onCreateQuestionForTopic }: {
  capture: LearnerCapture;
  snapshot: AppSnapshot;
  onEdit: () => void;
  onArchive: () => void;
  onFinish: () => void;
  finishing: boolean;
  onCreateQuestionForTopic: (topicID: string) => void;
}) {
  return (
    <article className="note-reader-content">
      <header className="note-reader-header">
        <div>
          <h2>{capture.title}</h2>
          <p className="note-reader-meta">
            <span>{topicTitle(snapshot, capture.topicID)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={capture.updatedAt}>{new Date(capture.updatedAt).toLocaleDateString()}</time>
          </p>
        </div>
        <div className="note-reader-actions">
          {capture.status === "draft" && (
            <button className="primary" type="button" disabled={finishing || !capture.rawText.trim()} onClick={onFinish}>
              {finishing ? <LoaderCircle className="spin" /> : <Sparkles />}
              {finishing ? "Finishing…" : "Finish lecture"}
            </button>
          )}
          <button type="button" onClick={onEdit}><Pencil /> Edit</button>
          <button type="button" className="danger-button" onClick={onArchive}><Archive /> Archive</button>
        </div>
      </header>
      <div className="note-reader-body">
        <NoteSourceReader capture={capture} />
      </div>
      {capture.status === "ready" && (
        <section className="note-reader-next-step" aria-labelledby="note-reader-next-step-heading">
          <div>
            <Eyebrow id="note-reader-next-step-heading">Next step</Eyebrow>
            <h3>Turn this note into recall</h3>
            <p>Choose the ideas worth remembering and add them to your question bank.</p>
          </div>
          <button className="primary" type="button" onClick={() => onCreateQuestionForTopic(capture.topicID)}>
            <Plus /> Add a question
          </button>
        </section>
      )}
    </article>
  );
}

function NoteReaderEmpty({ topicTitle, hasNotes, onCreate }: { topicTitle: string; hasNotes: boolean; onCreate: () => void }) {
  return (
    <div className="note-reader-empty">
      <FileText />
      <h2>{hasNotes ? "Select a note" : `No notes in ${topicTitle}`}</h2>
      <p>{hasNotes ? "Choose a page from the left to read the original source." : "Capture the original material first."}</p>
      {!hasNotes && <button type="button" className="primary" onClick={onCreate}><Plus /> New note</button>}
    </div>
  );
}

function NoteEditor({ snapshot, capture, initialTopicID, onClose, onSaved, onRegisterBeforeLeave }: {
  snapshot: AppSnapshot;
  capture?: LearnerCapture;
  initialTopicID?: string;
  onClose: () => void;
  onSaved: (capture: LearnerCapture) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
}) {
  const [savedCapture, setSavedCapture] = useState(capture);
  const [initial, setInitial] = useState<NoteForm>(() => formFromCapture(capture, snapshot, initialTopicID));
  const [form, setForm] = useState<NoteForm>(initial);
  const [saveState, setSaveState] = useState<SaveState>(() => capture ? "saved" : "draft");
  const [error, setError] = useState<string>();
  const saveInFlight = useRef(false);
  const dirty = !sameNoteForm(form, initial);
  useBeforeUnloadGuard(dirty);

  const resetToDraft = () => {
    if (saveState !== "saving") {
      setSaveState("draft");
      setError(undefined);
    }
  };

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard your unsaved note changes?"),
    [dirty]
  );
  const requestClose = useCallback(() => {
    if (confirmDiscard()) onClose();
  }, [confirmDiscard, onClose]);
  const dialog = useDialogFocus(requestClose);

  useEffect(() => {
    onRegisterBeforeLeave(dirty ? confirmDiscard : undefined);
    return () => onRegisterBeforeLeave(undefined);
  }, [confirmDiscard, dirty, onRegisterBeforeLeave]);

  const updateForm = (changes: Partial<NoteForm>) => {
    resetToDraft();
    setForm((current) => ({ ...current, ...changes, status: "draft" }));
  };

  const save = useCallback(async () => {
    if (saveInFlight.current) return;
    if (savedCapture && !dirty) {
      setSaveState("saved");
      return;
    }
    if (!form.topicID || !form.title.trim()) {
      setSaveState("error");
      setError("Add a topic and title.");
      return;
    }
    try {
      saveInFlight.current = true;
      setSaveState("saving"); setError(undefined);
      const saved = await window.revember.saveCapture({
        ...(savedCapture ? { id: savedCapture.id } : {}),
        expectedRevision: savedCapture?.revision ?? 0,
        topicID: form.topicID,
        title: form.title,
        rawText: form.rawText,
        status: form.status
      });
      const next = formFromCapture(saved, snapshot);
      setSavedCapture(saved);
      setInitial(next);
      setForm(next);
      setSaveState("saved");
      onSaved(saved);
    } catch (cause) {
      const next = resolveRevisionConflict(cause, CAPTURE_CONFLICT_MESSAGE);
      setSaveState(next.isConflict ? "conflict" : "error");
      setError(next.message);
    } finally {
      saveInFlight.current = false;
    }
  }, [dirty, form, onSaved, savedCapture, snapshot]);

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const isSaving = saveState === "saving";

  return (
    <section
      ref={dialog.ref}
      onKeyDown={dialog.onKeyDown}
      className="note-editor-page"
      role="dialog"
      aria-modal="true"
      aria-label={savedCapture ? "Edit note" : "New note"}
    >
      <header className="note-editor-topbar">
        <button type="button" className="note-editor-back" onClick={requestClose}>
          <ArrowLeft />
          <span>Notes</span>
        </button>
        <div className="note-editor-context">
          <FileText />
          <span>{savedCapture ? "Edit" : "New"}</span>
          {saveState !== "draft" && <span className={`save-state ${saveState}`} role="status" aria-live="polite">
            {saveState === "saving" && <LoaderCircle className="spin" />}
            {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Conflict" : "Error"}
          </span>}
        </div>
        <div className="note-editor-actions">
          <button type="button" onClick={requestClose}>Cancel</button>
          <button className="primary" disabled={isSaving} type="submit" form="note-editor-form">
            <Save /> {isSaving ? "Saving…" : "Save"} <kbd>⌘S</kbd>
          </button>
        </div>
      </header>
      <form
        id="note-editor-form"
        className="note-editor-canvas"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="note-editor-document">
          <label className="note-title-field">
            <span className="sr-only">Title</span>
            <input
              autoFocus
              className="note-title-input"
              disabled={isSaving}
              value={form.title}
              onChange={(event) => updateForm({ title: event.target.value })}
              placeholder="Untitled note"
            />
          </label>
          <div className="note-editor-meta">
            <label className="note-meta-control">
              <span>Topic</span>
              <select disabled={isSaving} value={form.topicID} onChange={(event) => updateForm({ topicID: event.target.value })}>
                <option value="">Choose a topic</option>
                {snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
              </select>
            </label>
          </div>

          <section className="note-writing-section" aria-labelledby="source-editor-heading">
            <header className="note-writing-heading">
              <Eyebrow id="source-editor-heading">Original</Eyebrow>
            </header>
            <textarea
              className="note-source-editor"
              aria-label="Raw text"
              disabled={isSaving}
              value={form.rawText}
              onChange={(event) => updateForm({ rawText: event.target.value })}
              placeholder="Write or paste notes…"
              spellCheck
            />
          </section>

          {error && <InlineError message={error} />}
        </div>
      </form>
    </section>
  );
}

function ArchiveNoteDialog({ note, onArchived, onClose }: { note: CaptureSummary; onArchived: (capture: LearnerCapture) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const archive = async () => {
    try {
      setSaving(true);
      const saved = await window.revember.archiveCapture(note.id, note.revision);
      onArchived(saved);
      onClose();
    } catch (cause) {
      setError(resolveRevisionConflict(cause, CAPTURE_CONFLICT_MESSAGE).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmationDialog
      title="Archive note"
      icon={<Archive />}
      confirmLabel="Archive note"
      pendingLabel="Archiving…"
      isConfirming={saving}
      error={error}
      onConfirm={() => void archive()}
      onClose={onClose}
    >
      <p>Archive <strong>{note.title}</strong>? It will remain in local archived notes.</p>
    </ConfirmationDialog>
  );
}

function formFromCapture(capture: LearnerCapture | undefined, snapshot: AppSnapshot, initialTopicID?: string): NoteForm {
  return {
    topicID: capture?.topicID ?? initialTopicID ?? snapshot.topics[0]?.id ?? "",
    title: capture?.title ?? "",
    rawText: capture?.rawText ?? "",
    status: (capture?.status === "ready" ? "ready" : "draft") as Exclude<CaptureStatus, "archived">
  };
}

function sameNoteForm(left: NoteForm, right: NoteForm): boolean {
  return left.topicID === right.topicID
    && left.title === right.title
    && left.rawText === right.rawText
    && left.status === right.status;
}

function topicTitle(snapshot: AppSnapshot, topicID: string): string {
  return snapshot.topics.find((topic) => topic.id === topicID)?.title ?? topicID;
}
