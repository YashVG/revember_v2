import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, FileText, LoaderCircle, Play, Sparkles } from "lucide-react";
import type { AppSnapshot, DueReviewItem, LearnerCapture } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { Eyebrow } from "./ui";
import { toErrorMessage } from "../utils";
import { useBeforeUnloadGuard } from "../hooks/useBeforeUnloadGuard";

const NOTE_SAVE_DELAY_MS = 700;

type SaveState = "ready" | "saving" | "saved" | "error";
type ReviewItems = ReturnType<typeof dueReviewItems>;

type HomePageProps = {
  snapshot: AppSnapshot;
  onOpenNotes: (topicID?: string) => void;
  onCreateNote: () => void;
  onStartReview: (items: DueReviewItem[]) => void;
  onRegisterBeforeLeave: (handler: (() => Promise<boolean>) | undefined) => void;
};

export function HomePage({ snapshot, onOpenNotes, onCreateNote, onStartReview, onRegisterBeforeLeave }: HomePageProps) {
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
    <div className={`home-page home-study-page ${due.length ? "has-review" : "has-capture"}`}>
      <StudyFocus
        due={due}
        onStartReview={onStartReview}
        onCreateNote={onCreateNote}
      />

      {!due.length && (
        <div className="home-capture-followup">
          <section className="home-capture-intro" aria-labelledby="home-capture-heading">
            <Eyebrow>Nothing due</Eyebrow>
            <h2 id="home-capture-heading">Capture what you learned</h2>
            <p>Write a note now. When you are ready, turn its strongest ideas into questions.</p>
          </section>

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
              <button className="home-link" type="button" onClick={() => onOpenNotes(topicID)}>
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
      )}
    </div>
  );
}

type StudyFocusProps = {
  due: ReviewItems;
  onStartReview: (items: DueReviewItem[]) => void;
  onCreateNote: () => void;
};

function StudyFocus({
  due,
  onStartReview,
  onCreateNote
}: StudyFocusProps) {
  const focus = useMemo(() => buildHomeStudyFocus(due), [due]);
  const hasReview = focus.reviewItems.length > 0;
  const reviewDescription = `${estimateReviewMinutes(focus.reviewItems.length)} · ${formatTopicList(focus.reviewItems)}`;
  const primaryAction = hasReview
    ? () => onStartReview(focus.reviewItems)
    : onCreateNote;

  return (
    <section className="study-focus" aria-labelledby="study-focus-title">
      <header className="study-focus-heading">
        <Eyebrow>Today</Eyebrow>
        <h1 id="study-focus-title">Study focus</h1>
        <p>A clear next step, based on your review.</p>
      </header>

      <article className="study-focus-session surface" aria-labelledby="study-focus-session-title">
        <div className="study-focus-session-heading">
          <div>
            <h2 id="study-focus-session-title">
              {hasReview
                ? `${focus.reviewItems.length} ${focus.reviewItems.length === 1 ? "question" : "questions"} ${focus.reviewState}`
                : "Nothing due"}
            </h2>
            <p>{hasReview ? reviewDescription : "You are caught up. Capture what you learn next, then make it reviewable."}</p>
          </div>
          <button className="primary study-focus-start" type="button" onClick={primaryAction}>
            {hasReview ? <Play /> : <FileText />}
            {hasReview ? "Start review" : "Write a note"}
          </button>
        </div>

        {hasReview && (
          <div className="study-focus-preview" aria-label="Questions in this review">
            {focus.reviewItems.slice(0, 2).map((item, index) => (
              <div className="study-focus-preview-row" key={item.id}>
                <span>{index + 1}</span>
                <strong>{item.question.prompt}</strong>
                <ArrowRight aria-hidden="true" />
              </div>
            ))}
            {focus.reviewItems.length > 2 && <p>+ {focus.reviewItems.length - 2} more</p>}
          </div>
        )}
      </article>

      <section className="study-focus-continue" aria-labelledby="study-focus-continue-title">
        <h2 id="study-focus-continue-title">Keep learning</h2>
        <div>
          <button type="button" onClick={onCreateNote}><FileText />Write a note</button>
        </div>
      </section>

    </section>
  );
}

type HomeStudyFocus = {
  reviewItems: DueReviewItem[];
  reviewState: "due" | "ready";
};

function buildHomeStudyFocus(due: ReviewItems): HomeStudyFocus {
  const scheduled = due.filter((item) => !item.isNew && !item.isRevised);
  const reviewItems = scheduled.length ? scheduled : due;

  return { reviewItems, reviewState: scheduled.length ? "due" : "ready" };
}

function estimateReviewMinutes(questionCount: number): string {
  const minutes = Math.max(1, Math.ceil(questionCount * 0.75));
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function formatTopicList(items: readonly DueReviewItem[]): string {
  const titles = [...new Set(items.map((item) => item.topic.title))];
  if (!titles.length) return "your current topics";
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, 2).join(" and ")} + ${titles.length - 2} more`;
}

function noteFingerprint(topicID: string, rawText: string): string {
  return `${topicID}\u0000${rawText}`;
}
