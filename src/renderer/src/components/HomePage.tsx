import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Circle, FileText, LoaderCircle, Sparkles } from "lucide-react";
import type { AppSnapshot, DueReviewItem, LearnerCapture } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { Eyebrow } from "./ui";
import { toErrorMessage } from "../utils";
import { reviewItemDurationLabel } from "../presentation";
import { useBeforeUnloadGuard } from "../hooks/useBeforeUnloadGuard";

const NOTE_SAVE_DELAY_MS = 700;

type SaveState = "ready" | "saving" | "saved" | "error";
type ReviewItems = ReturnType<typeof dueReviewItems>;

type HomePageProps = {
  snapshot: AppSnapshot;
  onOpenNotes: () => void;
  onStartReview: (items: DueReviewItem[]) => void;
  onRegisterBeforeLeave: (handler: (() => Promise<boolean>) | undefined) => void;
};

export function HomePage({ snapshot, onOpenNotes, onStartReview, onRegisterBeforeLeave }: HomePageProps) {
  const [topicID, setTopicID] = useState(snapshot.topics[0]?.id ?? "");
  const [noteText, setNoteText] = useState("");
  const [savedCapture, setSavedCapture] = useState<LearnerCapture>();
  const [saveState, setSaveState] = useState<SaveState>("ready");
  const [saveError, setSaveError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const noteTextRef = useRef(noteText);
  const topicIDRef = useRef(topicID);
  const savedCaptureRef = useRef<LearnerCapture | undefined>(undefined);
  const lastSavedFingerprint = useRef("");
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const finishInFlight = useRef(false);
  const today = useMemo(() => new Date(), []);
  const due = useMemo(() => dueReviewItems(snapshot), [snapshot]);
  const hasUnsavedChanges = Boolean(noteText.trim() || savedCapture)
    && noteFingerprint(topicID, noteText) !== lastSavedFingerprint.current;
  useBeforeUnloadGuard(hasUnsavedChanges);
  noteTextRef.current = noteText;
  topicIDRef.current = topicID;
  savedCaptureRef.current = savedCapture;

  useEffect(() => {
    if (!snapshot.topics.some((topic) => topic.id === topicID)) {
      setTopicID(snapshot.topics[0]?.id ?? "");
    }
  }, [snapshot.topics, topicID]);

  const saveNote = useCallback((): Promise<LearnerCapture | undefined> => {
    const operation = saveQueue.current.then(async () => {
      const rawText = noteTextRef.current;
      const currentTopicID = topicIDRef.current;
      const fingerprint = noteFingerprint(currentTopicID, rawText);
      if ((!rawText.trim() && !savedCaptureRef.current) || !currentTopicID || fingerprint === lastSavedFingerprint.current) {
        return savedCaptureRef.current;
      }
      try {
        setSaveState("saving");
        setSaveError(undefined);
        const current = savedCaptureRef.current;
        const saved = await window.revember.saveCapture({
          ...(current ? { id: current.id } : {}),
          expectedRevision: current?.revision ?? 0,
          topicID: currentTopicID,
          title: `Lecture note · ${today.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
          rawText,
          concisePoints: current?.concisePoints.map((point) => ({ id: point.id, text: point.text })) ?? [],
          status: "draft"
        });
        savedCaptureRef.current = saved;
        setSavedCapture(saved);
        lastSavedFingerprint.current = fingerprint;
        setSaveState(noteFingerprint(topicIDRef.current, noteTextRef.current) === fingerprint ? "saved" : "ready");
        return saved;
      } catch (cause) {
        setSaveState("error");
        setSaveError(toErrorMessage(cause));
        throw cause;
      }
    });
    saveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [today]);

  useEffect(() => {
    if ((!noteText.trim() && !savedCapture) || noteFingerprint(topicID, noteText) === lastSavedFingerprint.current) return;
    const timer = window.setTimeout(() => void saveNote().catch(() => undefined), NOTE_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [noteText, saveNote, savedCapture, topicID]);

  const beforeLeave = useCallback(async () => {
    try {
      await saveNote();
      return true;
    } catch {
      return false;
    }
  }, [saveNote]);

  useEffect(() => {
    onRegisterBeforeLeave(hasUnsavedChanges ? beforeLeave : undefined);
    return () => onRegisterBeforeLeave(undefined);
  }, [beforeLeave, hasUnsavedChanges, onRegisterBeforeLeave]);

  const finishLecture = async () => {
    if (finishInFlight.current) return;
    try {
      finishInFlight.current = true;
      setFinishing(true);
      setSaveError(undefined);
      const saved = await saveNote();
      if (!saved) throw new Error("Add note text before finishing this lecture.");
      const finished = await window.revember.finishCapture(saved.id, saved.revision);
      savedCaptureRef.current = finished;
      setSavedCapture(finished);
      setSaveState("saved");
    } catch (cause) {
      setSaveState("error");
      setSaveError(toErrorMessage(cause));
    } finally {
      finishInFlight.current = false;
      setFinishing(false);
    }
  };

  const noteStatus = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Could not save";
  const currentReady = savedCapture?.status === "ready"
    && noteFingerprint(topicID, noteText) === lastSavedFingerprint.current;

  return (
    <div className="home-page">
      <FocusDrawer due={due} onStartReview={onStartReview} />

      <section className="lecture-note" aria-labelledby="lecture-note-heading">
        <div className="lecture-note-toolbar">
          <div className="lecture-note-title"><FileText /><Eyebrow>Lecture note</Eyebrow></div>
          <label className="lecture-topic">
            <span className="sr-only">Note topic</span>
            <select value={topicID} onChange={(event) => setTopicID(event.target.value)}>
              {snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
            </select>
          </label>
          {saveState !== "ready" && (
            <span className={`lecture-save-state ${saveState}`} role="status" aria-live="polite">
              {saveState === "saving" && <LoaderCircle className="spin" />}
              {noteStatus}
            </span>
          )}
          <button
            className="primary home-finish-button"
            type="button"
            disabled={!noteText.trim() || saveState === "saving" || finishing || currentReady}
            onClick={() => void finishLecture()}
          >
            {finishing ? <LoaderCircle className="spin" /> : <Sparkles />}
            {finishing ? "Finishing…" : currentReady ? "Lecture finished" : "Finish lecture"}
          </button>
          <button className="home-link" type="button" onClick={onOpenNotes}>
            Open notes <ArrowUpRight />
          </button>
        </div>
        <textarea
          id="lecture-note-heading"
          aria-label="Lecture note"
          value={noteText}
          onChange={(event) => {
            setNoteText(event.target.value);
            if (saveState === "saved") setSaveState("ready");
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              void saveNote().catch(() => undefined);
            }
          }}
          placeholder="Start typing…"
          spellCheck
        />
        {saveError && <p className="lecture-save-error">{saveError}</p>}
      </section>

    </div>
  );
}

type FocusDrawerProps = {
  due: ReviewItems;
  onStartReview: (items: DueReviewItem[]) => void;
};

function FocusDrawer({
  due,
  onStartReview
}: FocusDrawerProps) {
  return (
    <section className="focus-drawer" aria-labelledby="focus-drawer-title">
      <span className="focus-drawer-handle" aria-hidden="true" />
      <header className="focus-drawer-header">
        <div>
          <span className="focus-kicker">Today</span>
          <h1 id="focus-drawer-title">Study focus</h1>
        </div>
        {due.length > 0 && (
          <button type="button" className="focus-review-button" onClick={() => onStartReview(due)}>
            Review
          </button>
        )}
      </header>
      <div className="focus-drawer-body">
        <div className="focus-count">
          <strong>{due.length}</strong>
          <span>due</span>
        </div>
        <div className="focus-task-list" aria-label={`${due.length} due checks`}>
          {due.length > 0 ? (
            due.slice(0, 3).map((item) => (
              <button className="focus-task" key={item.id} type="button" onClick={() => onStartReview([item])}>
                <Circle />
                <span>{item.question.prompt}</span>
                <small>{reviewItemDurationLabel()}</small>
              </button>
            ))
          ) : (
            <p className="focus-empty">Nothing due</p>
          )}
          {due.length > 3 && (
            <button className="focus-more" type="button" onClick={() => onStartReview(due)}>
              + {due.length - 3} more
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function noteFingerprint(topicID: string, rawText: string): string {
  return `${topicID}\u0000${rawText}`;
}
