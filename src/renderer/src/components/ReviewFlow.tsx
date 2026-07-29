import { useRef, useState } from "react";
import { ArrowRight, Brain, Check, Lightbulb, Timer, X } from "lucide-react";
import type {
  AnswerChoice,
  AppSnapshot,
  CommitReviewResult,
  DueReviewItem,
  KnowledgeTopic,
  Question,
  ReviewCardState,
  ReviewRating
} from "../../../../shared/types";
import { intervalLabel } from "../../../../shared/domain";
import { responseTimeLabel, reviewRatingLabel } from "../../../../shared/review-timing";
import { InlineError, RecallGate } from "./review-ui";
import { capitalize, Eyebrow } from "./ui";
import { useQuestionAttempt } from "../hooks/useQuestionAttempt";
import {
  getOrCreateReviewSubmission,
  reviewSubmissionKey,
  type ReviewSubmissionIdentity
} from "../reviewSubmission";
import { toErrorMessage } from "../utils";

function ChoiceList({ question, selectedChoiceID, onChoose }: { question: Question; selectedChoiceID?: string; onChoose: (choice: AnswerChoice) => void }) {
  return <div className="choice-list">{question.choices.map((choice, index) => {
    const selected = choice.id === selectedChoiceID;
    return <button key={choice.id} className={`${selected ? "selected" : ""} ${selected ? (choice.isCorrect ? "correct" : "incorrect") : ""}`} onClick={() => onChoose(choice)} disabled={Boolean(selectedChoiceID)}>
      <span>{index + 1}</span><div><strong>{choice.text}</strong>{selected && choice.rationale && <small>{choice.rationale}</small>}</div>{selected && (choice.isCorrect ? <Check /> : <X />)}
    </button>;
  })}</div>;
}

export function ReviewSession({ items, onSnapshot, onFinish }: { items: DueReviewItem[]; onSnapshot: (snapshot: AppSnapshot) => void; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [schedules, setSchedules] = useState<ReviewCardState[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const submissions = useRef(new Map<string, ReviewSubmissionIdentity>());
  const item = items[index];
  const { choice, selectedChoiceID, rating, responseTimeMs, revealed, setRevealed, error, setError, choose, reset } = useQuestionAttempt(item?.question);

  if (!item) return <ReviewCompletion empty={!items.length} completed={schedules.length} schedules={schedules} onFinish={onFinish} />;
  const save = async () => {
    if (!choice || !rating || responseTimeMs === undefined || saveInFlight.current) return;
    const submissionKey = reviewSubmissionKey(item.topic.id, item.question, choice.id, rating, responseTimeMs);
    const submission = getOrCreateReviewSubmission(submissions.current, submissionKey);
    saveInFlight.current = true;
    setSaving(true);
    try {
      const result = await commit(item.question, item.topic, choice, rating, responseTimeMs, submission);
      submissions.current.delete(submissionKey);
      onSnapshot(result.snapshot);
      setSchedules((current) => [...current, result.cardState]);
      reset();
      setIndex((value) => value + 1);
      setError(undefined);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return <div className="review-shell"><div className="review-top"><button disabled={saving} onClick={onFinish}><X /> Exit Review</button><span><Timer /> {index + 1} of {items.length}</span></div><section className="surface review-card"><div className="review-context"><div><Eyebrow>{item.isRevised ? "Revised Check" : item.isNew ? "New Check" : item.isScheduled ? "Scheduled Check" : "Due Check"}</Eyebrow><strong>{item.topic.title}</strong></div><span>{capitalize(item.question.transferLevel)}</span></div>
    <h2>{item.question.prompt}</h2>{item.question.kind === "freeRecall" && !revealed ? <RecallGate description="Answer mentally or aloud, then reveal the choices to score what you recalled." onReveal={() => setRevealed(true)} /> : <ChoiceList question={item.question} selectedChoiceID={selectedChoiceID} onChoose={choose} />}
    {choice && rating && responseTimeMs !== undefined && <div className="review-answer"><div className="review-explanation"><div className="review-explanation-heading"><Lightbulb /><span>Why this is correct</span></div><p>{item.question.explanation}</p></div><AutomaticRating rating={rating} responseTimeMs={responseTimeMs} isCorrect={choice.isCorrect} /></div>}
    {error && <InlineError message={error} />}<div className="review-save"><span>{choice ? "Difficulty was inferred automatically from your first answer." : "Choose the answer you would use without hints."}</span><button className="primary" disabled={!choice || !rating || responseTimeMs === undefined || saving} aria-busy={saving} onClick={save}>{saving ? "Saving…" : index === items.length - 1 ? "Finish Review" : "Save & Continue"} {!saving && <ArrowRight />}</button></div>
  </section></div>;
}

function ReviewCompletion({ empty, completed, schedules, onFinish }: { empty: boolean; completed: number; schedules: ReviewCardState[]; onFinish: () => void }) {
  const earliest = [...schedules].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return <div className="review-shell completion-wrap"><section className="surface completion"><Brain /><h1>{empty ? "Nothing is due" : "Review complete"}</h1><p>{empty ? "New and scheduled checks will appear here when they are ready." : `You saved ${completed} retrieval ${completed === 1 ? "event" : "events"} to your local learner record.`}</p>{earliest && <div><Eyebrow>Earliest next review</Eyebrow><strong>{relativeDate(earliest.dueAt)}</strong><span>{intervalLabel(earliest)}</span></div>}<button className="primary" onClick={onFinish}>Return to Topic</button></section></div>;
}

function AutomaticRating({ rating, responseTimeMs, isCorrect }: {
  rating: ReviewRating;
  responseTimeMs: number;
  isCorrect: boolean;
}) {
  return <div className={`automatic-rating ${rating}`} role="status" aria-live="polite">
    <div><Timer /><span>Automatic difficulty</span><strong>{reviewRatingLabel(rating)}</strong></div>
    <small>{responseTimeLabel(responseTimeMs)} active response time. {isCorrect ? "No extra input needed." : "Incorrect answers are always Missed."}</small>
  </div>;
}

async function commit(
  question: Question,
  topic: KnowledgeTopic,
  choice: AnswerChoice,
  rating: ReviewRating,
  responseTimeMs: number,
  submission: ReviewSubmissionIdentity
): Promise<CommitReviewResult> {
  return window.revember.commitReview({
    topicID: topic.id,
    questionID: question.id,
    questionRevision: question.revision,
    choiceID: choice.id,
    rating,
    responseTimeMs,
    eventID: submission.eventID,
    reviewedAt: submission.reviewedAt
  });
}

function relativeDate(value: string): string {
  const delta = new Date(value).getTime() - Date.now();
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return minutes <= 0 ? "now" : `in ${minutes} min`;
  const days = Math.round(delta / 86_400_000);
  return days <= 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`;
}
