import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, CheckCircle2, Circle, Clock3, FileText, LoaderCircle } from "lucide-react";
import type { AppSnapshot, LearnerCapture } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { examSessionDates } from "../../../../shared/planner";
import { Eyebrow } from "./ui";
import { MiniCalendar } from "./MiniCalendar";
import { toErrorMessage } from "../utils";

type SaveState = "ready" | "saving" | "saved" | "error";

export function HomePage({ snapshot, onOpenNotes }: {
  snapshot: AppSnapshot;
  onOpenNotes: () => void;
}) {
  const [topicID, setTopicID] = useState(snapshot.topics[0]?.id ?? "");
  const [noteText, setNoteText] = useState("");
  const [savedCapture, setSavedCapture] = useState<LearnerCapture>();
  const [saveState, setSaveState] = useState<SaveState>("ready");
  const [saveError, setSaveError] = useState<string>();
  const saveInFlight = useRef(false);
  const lastSavedText = useRef("");
  const today = useMemo(() => new Date(), []);
  const due = dueReviewItems(snapshot);
  const later = snapshot.topics.flatMap((topic) => Object.entries(snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID ?? {})
    .map(([questionID, state]) => ({ topic, question: topic.questions.find((question) => question.id === questionID), dueAt: state.dueAt }))
    .filter((item) => item.question && item.dueAt > new Date().toISOString()))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
    .slice(0, 3);

  useEffect(() => {
    if (!snapshot.topics.some((topic) => topic.id === topicID)) setTopicID(snapshot.topics[0]?.id ?? "");
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
    const timer = window.setTimeout(() => { void saveNote(); }, 700);
    return () => window.clearTimeout(timer);
  }, [noteText, saveNote]);

  const noteStatus = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Could not save";
  return <div className="home-page">
    <section className="home-overview" aria-labelledby="today-heading">
      <TodayEvents snapshot={snapshot} due={due} today={today} />
      <MiniCalendar today={today} />
      <TaskRail due={due} later={later} />
    </section>

    <section className="lecture-note" aria-labelledby="lecture-note-heading">
      <div className="lecture-note-toolbar">
        <div className="lecture-note-title"><FileText /><Eyebrow>Lecture note</Eyebrow></div>
        <label className="lecture-topic"><span className="sr-only">Note topic</span><select value={topicID} onChange={(event) => setTopicID(event.target.value)}>{snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
        {saveState !== "ready" && <span className={`lecture-save-state ${saveState}`} role="status" aria-live="polite">{saveState === "saving" && <LoaderCircle className="spin" />}{noteStatus}</span>}
        <button className="home-link" onClick={() => { void saveNote().finally(onOpenNotes); }}>Open notes <ArrowUpRight /></button>
      </div>
      <textarea
        aria-label="Lecture note"
        autoFocus
        value={noteText}
        onChange={(event) => { setNoteText(event.target.value); if (saveState === "saved") setSaveState("ready"); }}
        onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveNote(); } }}
        placeholder="Start typing…"
        spellCheck
      />
      {saveError && <p className="lecture-save-error">{saveError}</p>}
    </section>
  </div>;
}

function TodayEvents({ snapshot, due, today }: { snapshot: AppSnapshot; due: ReturnType<typeof dueReviewItems>; today: Date }) {
  const events = eventsForToday(snapshot, due, today);
  const dateLabel = today.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return <section className="today-events">
    <Eyebrow>Today</Eyebrow>
    <h1 id="today-heading">{dateLabel}</h1>
    {events.length ? <ul className="today-event-list">{events.map((event) => <li key={event.id}><event.Icon /><span><strong>{event.title}</strong><small>{event.detail}</small></span></li>)}</ul> : <p className="today-events-empty">Nothing scheduled.</p>}
  </section>;
}

function TaskRail({ due, later }: { due: ReturnType<typeof dueReviewItems>; later: { topic: AppSnapshot["topics"][number]; question: AppSnapshot["topics"][number]["questions"][number] | undefined; dueAt: string }[] }) {
  return <aside className="task-rail" aria-label="Today's study tasks">
    <section><Eyebrow>Need attention</Eyebrow>{due.length ? <ul>{due.slice(0, 3).map((item) => <li key={item.id}><CheckCircle2 /><span>{item.question.prompt}</span></li>)}</ul> : <p className="task-empty">Nothing is due right now.</p>}</section>
    <section className="later-list"><Eyebrow>Later, not today</Eyebrow>{later.length ? <ul>{later.map((item) => <li key={`${item.topic.id}:${item.question?.id}`}><Circle /><span>{item.question?.prompt}</span><time>{formatShortDate(item.dueAt)}</time></li>)}</ul> : <p className="task-empty">Nothing later.</p>}</section>
  </aside>;
}

function eventsForToday(snapshot: AppSnapshot, due: ReturnType<typeof dueReviewItems>, today: Date) {
  const events: { id: string; title: string; detail: string; Icon: typeof Clock3 }[] = [];
  if (due.length) events.push({ id: "due", title: `${due.length} due ${due.length === 1 ? "check" : "checks"}`, detail: `${Math.max(1, Math.ceil(due.length * 0.75))} min`, Icon: Clock3 });
  for (const plan of snapshot.planner.plans.filter((item) => !item.archivedAt)) {
    const planToday = localDateInTimeZone(today, plan.timeZone);
    if (plan.targetDate === planToday) events.push({ id: `exam:${plan.id}`, title: plan.examName, detail: "Exam day", Icon: CalendarDays });
    else {
      try {
        if (examSessionDates(plan, today).includes(planToday)) {
          events.push({ id: `session:${plan.id}`, title: plan.examName, detail: `${plan.topicIDs.length} ${plan.topicIDs.length === 1 ? "topic" : "topics"} planned`, Icon: CalendarDays });
        }
      } catch {
        // A stale plan should not prevent the rest of today's local events from rendering.
      }
    }
  }
  return events;
}

function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function formatShortDate(value: string): string { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
