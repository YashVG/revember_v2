import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, FileText, LoaderCircle, Pencil, Plus, Save, X } from "lucide-react";
import type { AppSnapshot, CaptureConcisePointInput, CaptureStatus, CaptureSummary, LearnerCapture } from "../../../../shared/types";
import { Eyebrow, Tag } from "./ui";
import { InlineError } from "./review-ui";
import { useDialogFocus } from "./useDialogFocus";
import { toErrorMessage } from "../utils";

type EditorPoint = CaptureConcisePointInput;
type SaveState = "draft" | "saving" | "saved" | "conflict" | "error";

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

function wordCount(text: string): number { return text.trim().match(/\S+/gu)?.length ?? 0; }
function friendlyCaptureError(cause: unknown): { message: string; conflict: boolean } {
  const message = toErrorMessage(cause);
  const conflict = /revision conflict|changed while/i.test(message);
  return {
    conflict,
    message: conflict
      ? "This note changed somewhere else. Reload it before retrying; every local edit is still in this form."
      : message
  };
}

export function NotesPage({ snapshot, onCreateCardFromPoint }: {
  snapshot: AppSnapshot;
  onCreateCardFromPoint: (topicID: string, sentence: string) => void;
}) {
  const [summaries, setSummaries] = useState<CaptureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [loadingID, setLoadingID] = useState<string>();
  const [editor, setEditor] = useState<LearnerCapture | "new">();
  const [archiveTarget, setArchiveTarget] = useState<CaptureSummary>();

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

  const openCapture = async (id: string) => {
    try {
      setLoadingID(id);
      // The list is metadata-only. This is the one deliberate full-record read.
      setEditor(await window.revember.getCapture(id));
    } catch (cause) { setListError(toErrorMessage(cause)); }
    finally { setLoadingID(undefined); }
  };
  const replaceSummary = (capture: LearnerCapture) => setSummaries((current) => [...current.filter((item) => item.id !== capture.id), summaryOf(capture)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)));
  const active = summaries.filter((item) => item.status !== "archived");
  const archived = summaries.filter((item) => item.status === "archived");

  return <div className="notes-page">
    <header className="planner-heading notes-heading"><div><Eyebrow>Local learning notes</Eyebrow><h1>Notes</h1><p>Keep original wording and a small set of concise points. Nothing is sent to a network or generated automatically.</p></div><button className="primary" onClick={() => setEditor("new")}><Plus /> New note</button></header>
    {listError && <InlineError message={listError} />}
    {loading ? <div className="surface notes-loading"><LoaderCircle className="spin" /> Loading note metadata…</div> : active.length ? <div className="notes-list">{active.map((note) => <NoteRow key={note.id} note={note} snapshot={snapshot} loading={loadingID === note.id} onOpen={() => void openCapture(note.id)} onArchive={() => setArchiveTarget(note)} />)}</div> : <div className="surface notes-empty"><FileText /><h2>No notes yet</h2><p>Capture the original material first, then add concise points in your own words.</p><button className="primary" onClick={() => setEditor("new")}><Plus /> Create note</button></div>}
    {archived.length > 0 && <details className="retired-cards notes-archived"><summary>{archived.length} archived {archived.length === 1 ? "note" : "notes"}</summary><ul>{archived.map((note) => <li key={note.id}>{note.title} · {topicTitle(snapshot, note.topicID)}</li>)}</ul></details>}
    {editor && <NoteEditor snapshot={snapshot} capture={editor === "new" ? undefined : editor} onClose={() => setEditor(undefined)} onSaved={replaceSummary} onCreateCardFromPoint={onCreateCardFromPoint} />}
    {archiveTarget && <ArchiveNoteDialog note={archiveTarget} onArchived={replaceSummary} onClose={() => setArchiveTarget(undefined)} />}
  </div>;
}

function NoteRow({ note, snapshot, loading, onOpen, onArchive }: { note: CaptureSummary; snapshot: AppSnapshot; loading: boolean; onOpen: () => void; onArchive: () => void }) {
  return <article className="surface note-row"><div className="note-row-copy"><Eyebrow>{note.status === "ready" ? "Ready" : "Draft"} · Revision {note.revision}</Eyebrow><h2>{note.title}</h2><p><Tag>{topicTitle(snapshot, note.topicID)}</Tag> <span>{note.concisePointCount} concise {note.concisePointCount === 1 ? "point" : "points"}</span><span>Updated {new Date(note.updatedAt).toLocaleDateString()}</span></p></div><div className="card-actions"><button disabled={loading} onClick={onOpen}>{loading ? <LoaderCircle className="spin" /> : <Pencil />} {loading ? "Opening…" : "Open"}</button><button className="danger-button" onClick={onArchive}><Archive /> Archive</button></div></article>;
}

function NoteEditor({ snapshot, capture, onClose, onSaved, onCreateCardFromPoint }: {
  snapshot: AppSnapshot;
  capture?: LearnerCapture;
  onClose: () => void;
  onSaved: (capture: LearnerCapture) => void;
  onCreateCardFromPoint: (topicID: string, sentence: string) => void;
}) {
  const [savedCapture, setSavedCapture] = useState(capture);
  const [initial, setInitial] = useState(() => formFromCapture(capture, snapshot));
  const [topicID, setTopicID] = useState(initial.topicID);
  const [title, setTitle] = useState(initial.title);
  const [rawText, setRawText] = useState(initial.rawText);
  const [points, setPoints] = useState<EditorPoint[]>(initial.points);
  const [status, setStatus] = useState<Exclude<CaptureStatus, "archived">>(initial.status);
  const [saveState, setSaveState] = useState<SaveState>(() => capture ? "saved" : "draft");
  const [error, setError] = useState<string>();
  const saveInFlight = useRef(false);
  const dirty = topicID !== initial.topicID || title !== initial.title || rawText !== initial.rawText || status !== initial.status || JSON.stringify(points) !== JSON.stringify(initial.points);
  const resetToDraft = () => { if (saveState !== "saving") { setSaveState("draft"); setError(undefined); } };
  const requestClose = useCallback(() => {
    if (!dirty || window.confirm("Discard your unsaved note changes?")) onClose();
  }, [dirty, onClose]);
  const dialog = useDialogFocus(requestClose);
  const updatePoint = (index: number, text: string) => { resetToDraft(); setPoints((current) => current.map((point, itemIndex) => itemIndex === index ? { ...point, text } : point)); };
  const save = useCallback(async () => {
    if (saveInFlight.current) return;
    if (!topicID || !title.trim() || points.some((point) => !point.text.trim())) {
      setSaveState("error");
      setError("Choose a topic, add a title, and give every concise point some text.");
      return;
    }
    try {
      saveInFlight.current = true;
      setSaveState("saving"); setError(undefined);
      const saved = await window.revember.saveCapture({
        ...(savedCapture ? { id: savedCapture.id } : {}),
        expectedRevision: savedCapture?.revision ?? 0,
        topicID,
        title,
        rawText,
        concisePoints: points.map((point) => point.id === undefined ? { text: point.text } : { id: point.id, text: point.text }),
        status
      });
      const next = formFromCapture(saved, snapshot);
      setSavedCapture(saved); setInitial(next); setTopicID(next.topicID); setTitle(next.title); setRawText(next.rawText); setPoints(next.points); setStatus(next.status);
      setSaveState("saved"); onSaved(saved);
    } catch (cause) {
      const next = friendlyCaptureError(cause);
      setSaveState(next.conflict ? "conflict" : "error"); setError(next.message);
    } finally { saveInFlight.current = false; }
  }, [onSaved, points, rawText, savedCapture, snapshot, status, title, topicID]);
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

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section ref={dialog.ref} onKeyDown={dialog.onKeyDown} className="settings-dialog note-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">
    <header><div><FileText /><h2 id="note-editor-title">{savedCapture ? "Edit note" : "New note"}</h2></div><span className={`save-state ${saveState}`} role="status" aria-live="polite">{saveState === "saving" && <LoaderCircle className="spin" />}{saveState[0].toUpperCase() + saveState.slice(1)}</span><button className="icon-button" aria-label="Close note editor" onClick={requestClose}><X /></button></header>
    <form className="note-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label><span>Topic</span><select autoFocus disabled={isSaving} value={topicID} onChange={(event) => { resetToDraft(); setTopicID(event.target.value); }}><option value="">Choose a topic</option>{snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
      <label><span>Title</span><input disabled={isSaving} value={title} onChange={(event) => { resetToDraft(); setTitle(event.target.value); }} placeholder="What this note is about" /></label>
      <label><span>Status</span><select disabled={isSaving} value={status} onChange={(event) => { resetToDraft(); setStatus(event.target.value as Exclude<CaptureStatus, "archived">); }}><option value="draft">Draft</option><option value="ready">Ready</option></select></label>
      <label><span>Raw text</span><textarea disabled={isSaving} value={rawText} onChange={(event) => { resetToDraft(); setRawText(event.target.value); }} placeholder="Paste or write the original material exactly as you want to keep it." /><small>{wordCount(rawText)} words · size only; wording, whitespace, and Unicode are preserved exactly.</small></label>
      <fieldset disabled={isSaving}><legend>Concise points</legend><p className="field-hint">Your explicit, short takeaways. These counts describe size only.</p>{points.map((point, index) => <div className="point-row" key={point.id ?? `new-${index}`}><textarea aria-label={`Concise point ${index + 1}`} value={point.text} onChange={(event) => updatePoint(index, event.target.value)} placeholder="One concise point" /><button type="button" aria-label={`Remove concise point ${index + 1}`} onClick={() => { resetToDraft(); setPoints((current) => current.filter((_, itemIndex) => itemIndex !== index)); }}><X /></button>{savedCapture && !dirty && point.id && persistedPointIDs.has(point.id) && <button type="button" className="point-card-button" onClick={() => onCreateCardFromPoint(topicID, point.text)}><Plus /> Create Card from Point</button>}<small>{wordCount(point.text)} words · size only</small></div>)}<button type="button" className="text-button" onClick={() => { resetToDraft(); setPoints((current) => [...current, { text: "" }]); }}><Plus /> Add concise point</button></fieldset>
      {error && <InlineError message={error} />}<div className="dialog-footer"><button type="button" onClick={requestClose}>Cancel</button><button className="primary" disabled={isSaving} type="submit"><Save /> {isSaving ? "Saving…" : "Save note"}</button></div><p className="save-shortcut">Save explicitly with <kbd>⌘S</kbd> or <kbd>Ctrl+S</kbd>. No autosave, network, or LLM is used.</p>
    </form>
  </section></div>;
}

function ArchiveNoteDialog({ note, onArchived, onClose }: { note: CaptureSummary; onArchived: (capture: LearnerCapture) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string>();
  const dialog = useDialogFocus(onClose);
  const archive = async () => {
    try { setSaving(true); const saved = await window.revember.archiveCapture(note.id, note.revision); onArchived(saved); onClose(); }
    catch (cause) { setError(friendlyCaptureError(cause).message); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation"><section ref={dialog.ref} onKeyDown={dialog.onKeyDown} className="settings-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-note-title"><header><div><Archive /><h2 id="archive-note-title">Archive note</h2></div><button className="icon-button" aria-label="Close archive dialog" onClick={onClose}><X /></button></header><div className="confirm-body"><p>Archive <strong>{note.title}</strong>? It will remain in local archived notes.</p>{error && <InlineError message={error} />}<div className="dialog-footer"><button onClick={onClose}>Cancel</button><button className="danger-button" disabled={saving} onClick={() => void archive()}>{saving ? "Archiving…" : "Archive note"}</button></div></div></section></div>;
}

function formFromCapture(capture: LearnerCapture | undefined, snapshot: AppSnapshot) {
  return {
    topicID: capture?.topicID ?? snapshot.topics[0]?.id ?? "",
    title: capture?.title ?? "",
    rawText: capture?.rawText ?? "",
    points: capture?.concisePoints.map((point) => ({ id: point.id, text: point.text })) ?? [],
    status: (capture?.status === "ready" ? "ready" : "draft") as Exclude<CaptureStatus, "archived">
  };
}
function topicTitle(snapshot: AppSnapshot, topicID: string): string { return snapshot.topics.find((topic) => topic.id === topicID)?.title ?? topicID; }
