import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Brain, Check, Timer, X } from "lucide-react";
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
import { activeQuestions, currentEvidence, intervalLabel, progressSummary } from "../../../../shared/domain";
import { InlineError, RecallGate } from "./review-ui";
import { capitalize, Eyebrow, MasteryRing, Tag } from "./ui";
import { useQuestionAttempt } from "../hooks/useQuestionAttempt";
import {
  getOrCreateReviewSubmission,
  reviewQuestionKey,
  reviewSubmissionKey,
  type ReviewSubmissionIdentity
} from "../reviewSubmission";
import { toErrorMessage } from "../utils";

export function CheckIn({ topic, snapshot, onSnapshot }: { topic: KnowledgeTopic; snapshot: AppSnapshot; onSnapshot: (snapshot: AppSnapshot) => void }) {
  const questions = activeQuestions(topic);
  const [index, setIndex] = useState(0);
  const [savedByQuestion, setSavedByQuestion] = useState<Record<string, ReviewCardState>>({});
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const submissions = useRef(new Map<string, ReviewSubmissionIdentity>());
  const question = questions[index];
  const questionKey = question ? reviewQuestionKey(topic.id, question) : "";
  const saved = savedByQuestion[questionKey];
  const { choice, selectedChoiceID, rating, setRating, revealed, setRevealed, error, setError, choose, reset } = useQuestionAttempt(question);

  useEffect(() => {
    setIndex(0);
    setSavedByQuestion({});
    submissions.current.clear();
  }, [topic.id]);
  if (!question) return <div className="surface empty-state">No active checks in this topic.</div>;

  const save = async () => {
    if (!choice || !rating || saved || saveInFlight.current) return;
    const submissionKey = reviewSubmissionKey(topic.id, question, choice.id, rating);
    const submission = getOrCreateReviewSubmission(submissions.current, submissionKey);
    saveInFlight.current = true;
    setSaving(true);
    try {
      const result = await commit(question, topic, choice, rating, submission);
      setSavedByQuestion((current) => ({ ...current, [questionKey]: result.cardState }));
      submissions.current.delete(submissionKey);
      onSnapshot(result.snapshot);
      setError(undefined);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const move = (next: number) => {
    reset();
    setIndex(Math.max(0, Math.min(questions.length - 1, next)));
  };

  return <div className="checkin-layout"><section className="surface checkin-card"><div className="checkin-top"><div><Eyebrow>Focus Check-In</Eyebrow><span>Question {index + 1} of {questions.length}</span></div><Tag>{question.gapTags[0] ?? question.transferLevel}</Tag></div>
    <h2>{question.prompt}</h2>
    {question.kind === "freeRecall" && !revealed ? <RecallGate description="Answer mentally or aloud, then reveal the choices." onReveal={() => setRevealed(true)} /> : <ChoiceList question={question} selectedChoiceID={selectedChoiceID} onChoose={choose} />}
    {choice && <div className="answer-explanation"><strong>{choice.isCorrect ? "Correct" : "Not quite"}</strong><p>{choice.rationale ?? question.explanation}</p><small>{question.explanation}</small></div>}
    {error && <InlineError message={error} />}
    <div className="question-nav"><button disabled={saving || index === 0} onClick={() => move(index - 1)}><ArrowLeft /> Previous</button><button disabled={saving || index === questions.length - 1} onClick={() => move(index + 1)}>Next <ArrowRight /></button></div>
  </section><InsightPanel topic={topic} question={question} snapshot={snapshot} rating={rating} setRating={setRating} answered={Boolean(choice)} correct={choice?.isCorrect} saved={saved} saving={saving} onSave={save} /></div>;
}

function ChoiceList({ question, selectedChoiceID, onChoose }: { question: Question; selectedChoiceID?: string; onChoose: (choice: AnswerChoice) => void }) {
  return <div className="choice-list">{question.choices.map((choice, index) => {
    const selected = choice.id === selectedChoiceID;
    return <button key={choice.id} className={`${selected ? "selected" : ""} ${selected ? (choice.isCorrect ? "correct" : "incorrect") : ""}`} onClick={() => onChoose(choice)} disabled={Boolean(selectedChoiceID)}>
      <span>{index + 1}</span><div><strong>{choice.text}</strong>{selected && choice.rationale && <small>{choice.rationale}</small>}</div>{selected && (choice.isCorrect ? <Check /> : <X />)}
    </button>;
  })}</div>;
}

function InsightPanel({ topic, question, snapshot, rating, setRating, answered, correct, saved, saving, onSave }: {
  topic: KnowledgeTopic; question: Question; snapshot: AppSnapshot; rating?: ReviewRating; setRating: (rating: ReviewRating) => void;
  answered: boolean; correct?: boolean; saved?: ReviewCardState; saving: boolean; onSave: () => void;
}) {
  const evidence = currentEvidence(topic, snapshot.progress);
  return <aside className="insight-panel"><section className="surface"><Eyebrow>Session Signal</Eyebrow><div className="signal"><MasteryRing value={evidence.score} size={64} /><div><strong>{progressSummary(topic, snapshot.progress)}</strong><span>Progress updates only after retrieval.</span></div></div></section>
    <section className="surface"><Eyebrow>Gap Diagnosis</Eyebrow><div>{question.gapTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div><code>{question.conceptIDs.join(" → ")}</code></section>
    <section className="surface"><Eyebrow>{saved ? "Last Saved Schedule" : "Next Review"}</Eyebrow>{saved ? <><strong className="cyan">Saved</strong><span>Due {relativeDate(saved.dueAt)}</span><small>{intervalLabel(saved)}</small></> : <strong>{rating ? "Save to schedule your next review" : "Answer, then rate the effort"}</strong>}
      <RatingButtons selected={rating} setSelected={setRating} disabled={!answered || Boolean(saved) || saving} incorrect={correct === false} /><button className="primary save-rating" disabled={!answered || !rating || Boolean(saved) || saving} aria-busy={saving} onClick={onSave}>{saving ? "Saving…" : saved ? "Saved" : "Save Review"}</button>
      {correct === false && <small className="amber-text">Incorrect retrievals are recorded as Missed so they return soon.</small>}</section></aside>;
}

export function ReviewSession({ items, onSnapshot, onFinish }: { items: DueReviewItem[]; onSnapshot: (snapshot: AppSnapshot) => void; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [schedules, setSchedules] = useState<ReviewCardState[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const submissions = useRef(new Map<string, ReviewSubmissionIdentity>());
  const item = items[index];
  const { choice, selectedChoiceID, rating, setRating, revealed, setRevealed, error, setError, choose, reset } = useQuestionAttempt(item?.question);

  if (!item) return <ReviewCompletion empty={!items.length} completed={schedules.length} schedules={schedules} onFinish={onFinish} />;
  const save = async () => {
    if (!choice || !rating || saveInFlight.current) return;
    const submissionKey = reviewSubmissionKey(item.topic.id, item.question, choice.id, rating);
    const submission = getOrCreateReviewSubmission(submissions.current, submissionKey);
    saveInFlight.current = true;
    setSaving(true);
    try {
      const result = await commit(item.question, item.topic, choice, rating, submission);
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

  return <div className="review-shell"><div className="review-top"><button disabled={saving} onClick={onFinish}><X /> Exit Review</button><span><Timer /> {index + 1} of {items.length}</span></div><section className="surface review-card"><div className="review-context"><div><Eyebrow>{item.isRevised ? "Revised Check" : item.isNew ? "New Check" : "Due Check"}</Eyebrow><strong>{item.topic.title}</strong></div><span>{capitalize(item.question.transferLevel)}</span></div>
    <h2>{item.question.prompt}</h2>{item.question.kind === "freeRecall" && !revealed ? <RecallGate description="Answer mentally or aloud, then reveal the choices to score what you recalled." onReveal={() => setRevealed(true)} /> : <ChoiceList question={item.question} selectedChoiceID={selectedChoiceID} onChoose={choose} />}
    {choice && <div className="review-answer"><p>{item.question.explanation}</p><h3>How hard was retrieval?</h3><RatingButtons selected={rating} setSelected={setRating} disabled={saving} incorrect={!choice.isCorrect} />{!choice.isCorrect && <small className="amber-text">Incorrect retrievals are recorded as Missed.</small>}</div>}
    {error && <InlineError message={error} />}<div className="review-save"><span>The answer and rating are saved together.</span><button className="primary" disabled={!choice || !rating || saving} aria-busy={saving} onClick={save}>{saving ? "Saving…" : index === items.length - 1 ? "Finish Review" : "Save & Continue"} {!saving && <ArrowRight />}</button></div>
  </section></div>;
}

function ReviewCompletion({ empty, completed, schedules, onFinish }: { empty: boolean; completed: number; schedules: ReviewCardState[]; onFinish: () => void }) {
  const earliest = [...schedules].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return <div className="review-shell completion-wrap"><section className="surface completion"><Brain /><h1>{empty ? "Nothing is due" : "Review complete"}</h1><p>{empty ? "New and scheduled checks will appear here when they are ready." : `You saved ${completed} retrieval ${completed === 1 ? "event" : "events"} to your local learner record.`}</p>{earliest && <div><Eyebrow>Earliest next review</Eyebrow><strong>{relativeDate(earliest.dueAt)}</strong><span>{intervalLabel(earliest)}</span></div>}<button className="primary" onClick={onFinish}>Return to Topic</button></section></div>;
}

function RatingButtons({ selected, setSelected, disabled, incorrect }: { selected?: ReviewRating; setSelected: (rating: ReviewRating) => void; disabled: boolean; incorrect: boolean }) {
  const ratings: ReviewRating[] = ["missed", "hard", "good", "easy"];
  return <div className="rating-buttons">{ratings.map((rating) => <button key={rating} className={selected === rating ? `selected ${rating}` : ""} disabled={disabled || (incorrect && rating !== "missed")} onClick={() => setSelected(rating)}>{capitalize(rating)}</button>)}</div>;
}

async function commit(
  question: Question,
  topic: KnowledgeTopic,
  choice: AnswerChoice,
  rating: ReviewRating,
  submission: ReviewSubmissionIdentity
): Promise<CommitReviewResult> {
  return window.revember.commitReview({
    topicID: topic.id,
    questionID: question.id,
    questionRevision: question.revision,
    choiceID: choice.id,
    rating,
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
