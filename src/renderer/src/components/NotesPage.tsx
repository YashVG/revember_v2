import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, FileText, LoaderCircle, Pencil, Plus, RefreshCw, Save, Sparkles, X } from "lucide-react";
import type { AppSnapshot, CaptureConcisePointInput, CaptureEnrichment, CaptureStatus, CaptureSummary, LearnerCapture } from "../../../../shared/types";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { Eyebrow, Tag } from "./ui";
import { InlineError } from "./review-ui";
import { useDialogFocus } from "./useDialogFocus";
import type { BeforeLeaveGuard } from "../navigationGuard";
import { useBeforeUnloadGuard } from "../hooks/useBeforeUnloadGuard";
import { resolveRevisionConflict, toErrorMessage } from "../utils";

type EditorPoint = CaptureConcisePointInput;
type SaveState = "draft" | "saving" | "saved" | "conflict" | "error";
type NoteForm = {
  topicID: string;
  title: string;
  rawText: string;
  points: EditorPoint[];
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
    status: capture.status,
    concisePointCount: capture.concisePoints.length,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt
  };
}

type NotesPageProps = {
  snapshot: AppSnapshot;
  onCreateCardFromPoint: (topicID: string, sentence: string) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
};

export function NotesPage({ snapshot, onCreateCardFromPoint, onRegisterBeforeLeave }: NotesPageProps) {
  const [summaries, setSummaries] = useState<CaptureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [loadingID, setLoadingID] = useState<string>();
  const [selectedID, setSelectedID] = useState<string>();
  const [selectedCapture, setSelectedCapture] = useState<LearnerCapture>();
  const [editor, setEditor] = useState<LearnerCapture | "new">();
  const [archiveTarget, setArchiveTarget] = useState<CaptureSummary>();
  const [finishingID, setFinishingID] = useState<string>();
  const finishInFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    void window.revember.listCaptureSummaries().then((next) => {
      if (!alive) return;
      setSummaries(next);
      setSelectedID((current) => current && next.some((item) => item.id === current && item.status !== "archived")
        ? current
        : next.find((item) => item.status !== "archived")?.id);
      setListError(undefined);
    }).catch((cause) => {
      if (alive) setListError(toErrorMessage(cause));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

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
      setSelectedID(summaries.find((item) => item.id !== capture.id && item.status !== "archived")?.id);
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

  if (editor) {
    return (
      <div className="notes-page">
        <NoteEditor
          snapshot={snapshot}
          capture={editor === "new" ? undefined : editor}
          onClose={() => setEditor(undefined)}
          onSaved={replaceSummary}
          onCreateCardFromPoint={onCreateCardFromPoint}
          onRegisterBeforeLeave={onRegisterBeforeLeave}
        />
      </div>
    );
  }

  return (
    <div className="notes-page">
      <header className="notes-heading">
        <div>
          <Eyebrow>Local learning notes</Eyebrow>
          <h1>Notes</h1>
          <p>Pick a note to read it. Edit only when you need to change the source or its concise points.</p>
        </div>
        <button className="primary" type="button" onClick={() => setEditor("new")}>
          <Plus /> New note
        </button>
      </header>
      {listError && <InlineError message={listError} />}
      {loading ? (
        <div className="surface notes-loading"><LoaderCircle className="spin" /> Loading note metadata…</div>
      ) : (
        <div className="notes-workspace">
          <aside className="surface notes-index" aria-label="Notes list">
            <div className="notes-index-heading">
              <Eyebrow>Pages</Eyebrow>
              <span>{active.length}</span>
            </div>
            {active.length > 0 ? (
              <nav className="notes-index-list">
                {active.map((note) => (
                  <NoteListItem
                    key={note.id}
                    note={note}
                    snapshot={snapshot}
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
            {archived.length > 0 && (
              <details className="notes-archived">
                <summary>Archived · {archived.length}</summary>
                <ul>
                  {archived.map((note) => (
                    <li key={note.id}>{note.title}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
          <section className="surface note-reader" aria-live="polite">
            {selectedCapture ? (
              <NoteReader
                capture={selectedCapture}
                snapshot={snapshot}
                onEdit={() => setEditor(selectedCapture)}
                onArchive={() => setArchiveTarget(summaryOf(selectedCapture))}
                onFinish={() => void finishCapture(selectedCapture)}
                finishing={finishingID === selectedCapture.id}
                onCreateCardFromPoint={onCreateCardFromPoint}
              />
            ) : (
              <NoteReaderEmpty hasNotes={active.length > 0} onCreate={() => setEditor("new")} />
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

function NoteListItem({ note, snapshot, selected, loading, onSelect }: {
  note: CaptureSummary;
  snapshot: AppSnapshot;
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
        <small>{topicTitle(snapshot, note.topicID)}</small>
        <small>{note.status === "ready" ? "Ready" : "Draft"} · {note.concisePointCount} points</small>
      </span>
    </button>
  );
}

function NoteReader({ capture, snapshot, onEdit, onArchive, onFinish, finishing, onCreateCardFromPoint }: {
  capture: LearnerCapture;
  snapshot: AppSnapshot;
  onEdit: () => void;
  onArchive: () => void;
  onFinish: () => void;
  finishing: boolean;
  onCreateCardFromPoint: (topicID: string, sentence: string) => void;
}) {
  return (
    <article className="note-reader-content">
      <header className="note-reader-header">
        <div>
          <Eyebrow>{capture.status === "ready" ? "Ready" : "Draft"} · Revision {capture.revision}</Eyebrow>
          <h2>{capture.title}</h2>
          <p className="note-reader-meta">
            <Tag>{topicTitle(snapshot, capture.topicID)}</Tag>
            <span>Updated {new Date(capture.updatedAt).toLocaleDateString()}</span>
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
        <section className="note-source" aria-labelledby="note-source-heading">
          <div className="note-section-heading">
            <Eyebrow id="note-source-heading">Source</Eyebrow>
            <span>Original</span>
          </div>
          <div className="note-source-text">
            {capture.rawText.trim() ? capture.rawText : "This note has no source text yet."}
          </div>
        </section>
        <section className="note-points" aria-labelledby="note-points-heading">
          <div className="note-section-heading">
            <Eyebrow id="note-points-heading">Takeaways</Eyebrow>
            <span>{capture.concisePoints.length} takeaways</span>
          </div>
          {capture.concisePoints.length > 0 ? (
            <ol>
              {capture.concisePoints.map((point) => (
                <li key={point.id}>
                  <span>{point.text}</span>
                  <button type="button" className="point-card-button" onClick={() => onCreateCardFromPoint(capture.topicID, point.text)}>
                    <Plus /> Create card
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="note-reader-empty-points">No takeaways yet.</p>
          )}
          <NoteEnrichmentPanel capture={capture} />
        </section>
      </div>
    </article>
  );
}

function NoteEnrichmentPanel({ capture }: { capture: LearnerCapture }) {
  const [enrichment, setEnrichment] = useState<CaptureEnrichment>();
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    setEnrichment(undefined);
    setError(undefined);
    const refresh = async () => {
      try {
        const next = await window.revember.getCaptureEnrichment(capture.id, capture.revision);
        if (!alive) return;
        setEnrichment(next);
        if (next?.status === "queued" || next?.status === "running") timer = window.setTimeout(() => void refresh(), 1_200);
      } catch (cause) {
        if (alive) setError(toErrorMessage(cause));
      }
    };
    void refresh();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [capture.id, capture.revision, refreshKey]);

  const retry = async () => {
    try {
      setRetrying(true);
      setError(undefined);
      setEnrichment(await window.revember.retryCaptureEnrichment(capture.id, capture.revision));
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="note-enrichment" aria-live="polite" aria-labelledby="note-enrichment-heading">
      <div className="note-section-heading">
        <Eyebrow id="note-enrichment-heading">Local study response</Eyebrow>
        <span>llama3</span>
      </div>
      {error ? <InlineError message={error} /> : enrichment?.status === "ready" && enrichment.result ? (
        <div className="note-enrichment-result">
          <p>{enrichment.result.summary}</p>
          {enrichment.result.takeaways.length > 0 && (
            <ul>
              {enrichment.result.takeaways.map((takeaway, index) => (
                <li key={`${takeaway.evidence}-${index}`}>
                  <strong>{takeaway.text}</strong>
                  <q>{takeaway.evidence}</q>
                </li>
              ))}
            </ul>
          )}
          {enrichment.result.openQuestions.length > 0 && (
            <div className="note-enrichment-questions">
              <span>Questions to revisit</span>
              <ul>{enrichment.result.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
            </div>
          )}
        </div>
      ) : enrichment?.status === "queued" || enrichment?.status === "running" ? (
        <p className="note-enrichment-status"><LoaderCircle className="spin" /> Preparing a grounded response locally…</p>
      ) : enrichment?.status === "failed" || enrichment?.status === "unavailable" ? (
        <div className="note-enrichment-error">
          <p>{enrichment.errorMessage}</p>
          <button type="button" className="text-button" disabled={retrying} onClick={() => void retry()}>
            <RefreshCw className={retrying ? "spin" : undefined} /> {retrying ? "Retrying…" : "Retry local response"}
          </button>
        </div>
      ) : (
        <p className="note-enrichment-status">
          <Sparkles />
          {capture.status === "draft"
            ? "Finish this lecture when the note is ready for local analysis."
            : "Preparing this finished note for local analysis…"}
        </p>
      )}
    </section>
  );
}

function NoteReaderEmpty({ hasNotes, onCreate }: { hasNotes: boolean; onCreate: () => void }) {
  return (
    <div className="note-reader-empty">
      <FileText />
      <h2>{hasNotes ? "Select a note" : "Start your first note"}</h2>
      <p>{hasNotes ? "Choose a page from the left to read the original source and its takeaways." : "Capture the original material first, then distill it into concise points."}</p>
      {!hasNotes && <button type="button" className="primary" onClick={onCreate}><Plus /> New note</button>}
    </div>
  );
}

function NoteEditor({ snapshot, capture, onClose, onSaved, onCreateCardFromPoint, onRegisterBeforeLeave }: {
  snapshot: AppSnapshot;
  capture?: LearnerCapture;
  onClose: () => void;
  onSaved: (capture: LearnerCapture) => void;
  onCreateCardFromPoint: (topicID: string, sentence: string) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
}) {
  const [savedCapture, setSavedCapture] = useState(capture);
  const [initial, setInitial] = useState<NoteForm>(() => formFromCapture(capture, snapshot));
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

  const updatePoint = (index: number, text: string) => {
    updateForm({
      points: form.points.map((point, itemIndex) => itemIndex === index ? { ...point, text } : point)
    });
  };

  const save = useCallback(async () => {
    if (saveInFlight.current) return;
    if (savedCapture && !dirty) {
      setSaveState("saved");
      return;
    }
    if (!form.topicID || !form.title.trim() || form.points.some((point) => !point.text.trim())) {
      setSaveState("error");
      setError("Add a topic and title. Each point needs text.");
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
        concisePoints: form.points.map((point) => point.id === undefined ? { text: point.text } : { id: point.id, text: point.text }),
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

  const persistedPointIDs = useMemo(() => new Set(savedCapture?.concisePoints.map((point) => point.id) ?? []), [savedCapture]);
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

          <fieldset className="note-points-editor" disabled={isSaving}>
            <legend>
              <Eyebrow>Takeaways</Eyebrow>
            </legend>
            {form.points.map((point, index) => (
              <div className="point-row note-point-item" key={point.id ?? `new-${index}`}>
                <textarea
                  aria-label={`Concise point ${index + 1}`}
                  value={point.text}
                  onChange={(event) => updatePoint(index, event.target.value)}
                  placeholder="One concise point"
                />
                <button
                  type="button"
                  aria-label={`Remove concise point ${index + 1}`}
                  onClick={() => updateForm({ points: form.points.filter((_, itemIndex) => itemIndex !== index) })}
                >
                  <X />
                </button>
                {savedCapture && !dirty && point.id && persistedPointIDs.has(point.id) && (
                  <button type="button" className="point-card-button" onClick={() => onCreateCardFromPoint(form.topicID, point.text)}>
                    <Plus /> Create card
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="text-button note-add-point" onClick={() => updateForm({ points: [...form.points, { text: "" }] })}>
              <Plus /> Add point
            </button>
          </fieldset>
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

function formFromCapture(capture: LearnerCapture | undefined, snapshot: AppSnapshot): NoteForm {
  return {
    topicID: capture?.topicID ?? snapshot.topics[0]?.id ?? "",
    title: capture?.title ?? "",
    rawText: capture?.rawText ?? "",
    points: capture?.concisePoints.map((point) => ({ id: point.id, text: point.text })) ?? [],
    status: (capture?.status === "ready" ? "ready" : "draft") as Exclude<CaptureStatus, "archived">
  };
}

function sameNoteForm(left: NoteForm, right: NoteForm): boolean {
  return left.topicID === right.topicID
    && left.title === right.title
    && left.rawText === right.rawText
    && left.status === right.status
    && left.points.length === right.points.length
    && left.points.every((point, index) => point.id === right.points[index]?.id && point.text === right.points[index]?.text);
}

function topicTitle(snapshot: AppSnapshot, topicID: string): string {
  return snapshot.topics.find((topic) => topic.id === topicID)?.title ?? topicID;
}
