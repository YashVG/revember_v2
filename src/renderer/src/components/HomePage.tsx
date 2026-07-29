import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Bluetooth, BookOpen, FileText, LoaderCircle, MonitorCog, Play, Sparkles } from "lucide-react";
import type { AppSnapshot, DueReviewItem, LearnerCapture } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { Eyebrow } from "./ui";
import { toErrorMessage } from "../utils";
import { REVIEW_SECONDS_PER_ITEM } from "../presentation";
import { useBeforeUnloadGuard } from "../hooks/useBeforeUnloadGuard";

const NOTE_SAVE_DELAY_MS = 700;

type SaveState = "ready" | "saving" | "saved" | "error";
type ReviewItems = ReturnType<typeof dueReviewItems>;

type HomePageProps = {
  snapshot: AppSnapshot;
  onOpenNotes: (topicID?: string) => void;
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

  if (due.length > 0) {
    return (
      <div className="home-page home-review-page">
        <ReviewReadyHome due={due} onStartReview={onStartReview} onOpenNotes={onOpenNotes} />
      </div>
    );
  }

  return (
    <div className="home-page home-capture-page">
      <section className="home-capture-intro" aria-labelledby="home-capture-heading">
        <Eyebrow>Start here</Eyebrow>
        <h1 id="home-capture-heading">Capture what you learned</h1>
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
  );
}

type ReviewReadyHomeProps = {
  due: ReviewItems;
  onStartReview: (items: DueReviewItem[]) => void;
  onOpenNotes: (topicID?: string) => void;
};

function ReviewReadyHome({
  due,
  onStartReview,
  onOpenNotes
}: ReviewReadyHomeProps) {
  const sessionTopics = summarizeSessionTopics(due);
  const reviewMinutes = Math.max(1, Math.round((due.length * REVIEW_SECONDS_PER_ITEM) / 60));
  const continuationTopic = sessionTopics[0]?.title;

  return (
    <section className="home-review-ready" aria-labelledby="home-review-ready-title">
      <div className="home-review-overview">
        <div className="home-review-copy">
          <Eyebrow>Today</Eyebrow>
          <h1 id="home-review-ready-title">Your review is ready</h1>
          <p>
            {due.length} {due.length === 1 ? "question is" : "questions are"} ready. A focused session takes about {reviewMinutes} {reviewMinutes === 1 ? "minute" : "minutes"}.
          </p>
          <button type="button" className="primary home-review-start" onClick={() => onStartReview(due)}>
            <Play />
            Start {reviewMinutes}-minute review
          </button>
        </div>

        <aside className="home-session-preview" aria-label="In this session">
          <h2>In this session</h2>
          <ul>
            {sessionTopics.map((topic) => (
              <li key={topic.id}>
                <SessionTopicIcon title={topic.title} />
                <span>{topic.title}</span>
                <strong>{topic.count}</strong>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="home-after-review">
        <span>After review</span>
        <button type="button" onClick={() => onOpenNotes(sessionTopics[0]?.id)}>
          <FileText />
          {continuationTopic ? `Open ${continuationTopic} notes` : "Open notes"}
          <ArrowRight />
        </button>
      </div>
    </section>
  );
}

type SessionTopic = {
  id: string;
  title: string;
  count: number;
};

function summarizeSessionTopics(items: ReviewItems): SessionTopic[] {
  const topics = new Map<string, SessionTopic>();
  for (const item of items) {
    const current = topics.get(item.topicID);
    if (current) current.count += 1;
    else topics.set(item.topicID, { id: item.topicID, title: item.topic.title, count: 1 });
  }
  return [...topics.values()];
}

function SessionTopicIcon({ title }: { title: string }) {
  const normalizedTitle = title.toLowerCase();
  if (normalizedTitle.includes("bluetooth")) return <Bluetooth aria-hidden="true" />;
  if (normalizedTitle.includes("operating systems") || normalizedTitle.includes("computer architecture")) {
    return <MonitorCog aria-hidden="true" />;
  }
  return <BookOpen aria-hidden="true" />;
}

function noteFingerprint(topicID: string, rawText: string): string {
  return `${topicID}\u0000${rawText}`;
}
