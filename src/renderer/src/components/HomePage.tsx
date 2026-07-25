import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Circle, FileText, LoaderCircle } from "lucide-react";
import type { AppSnapshot, DueReviewItem, LearnerCapture } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { Eyebrow } from "./ui";
import { toErrorMessage } from "../utils";

const NOTE_SAVE_DELAY_MS = 700;

type SaveState = "ready" | "saving" | "saved" | "error";
type ReviewItems = ReturnType<typeof dueReviewItems>;

type HomePageProps = {
  snapshot: AppSnapshot;
  onOpenNotes: () => void;
  onStartReview: (items: DueReviewItem[]) => void;
};

export function HomePage({ snapshot, onOpenNotes, onStartReview }: HomePageProps) {
  const [topicID, setTopicID] = useState(snapshot.topics[0]?.id ?? "");
  const [noteText, setNoteText] = useState("");
  const [savedCapture, setSavedCapture] = useState<LearnerCapture>();
  const [saveState, setSaveState] = useState<SaveState>("ready");
  const [saveError, setSaveError] = useState<string>();
  const saveInFlight = useRef(false);
  const lastSavedText = useRef("");
  const today = useMemo(() => new Date(), []);
  const due = useMemo(() => dueReviewItems(snapshot), [snapshot]);

  useEffect(() => {
    if (!snapshot.topics.some((topic) => topic.id === topicID)) {
      setTopicID(snapshot.topics[0]?.id ?? "");
    }
  }, [snapshot.topics, topicID]);

  const saveNote = useCallback(async () => {
    if (saveInFlight.current || !noteText.trim() || !topicID || noteText === lastSavedText.current) return;
    try {
      saveInFlight.current = true;
      setSaveState("saving");
      setSaveError(undefined);
      const saved = await window.revember.saveCapture({
        ...(savedCapture ? { id: savedCapture.id } : {}),
        expectedRevision: savedCapture?.revision ?? 0,
        topicID,
        title: `Lecture note · ${today.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
        rawText: noteText,
        concisePoints: savedCapture?.concisePoints.map((point) => ({ id: point.id, text: point.text })) ?? [],
        status: "draft"
      });
      setSavedCapture(saved);
      lastSavedText.current = noteText;
      setSaveState("saved");
    } catch (cause) {
      setSaveState("error");
      setSaveError(toErrorMessage(cause));
    } finally {
      saveInFlight.current = false;
    }
  }, [noteText, savedCapture, today, topicID]);

  useEffect(() => {
    if (!noteText.trim() || noteText === lastSavedText.current) return;
    const timer = window.setTimeout(() => void saveNote(), NOTE_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [noteText, saveNote]);

  const noteStatus = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Could not save";

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
          <button className="home-link" type="button" onClick={() => void saveNote().finally(onOpenNotes)}>
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
              void saveNote();
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
            due.slice(0, 3).map((item, index) => (
              <button className="focus-task" key={item.id} type="button" onClick={() => onStartReview([item])}>
                <Circle />
                <span>{item.question.prompt}</span>
                <small>{estimateMinutes(index)}m</small>
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

function estimateMinutes(index: number): number {
  return [45, 35, 25][index] ?? 20;
}
