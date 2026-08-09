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

type ChoiceListProps = {
  question: Question;
  selectedChoiceID?: string;
  onChoose: (choice: AnswerChoice) => void;
};

function ChoiceList({ question, selectedChoiceID, onChoose }: ChoiceListProps) {
  return (
    <div className="choice-list">
      {question.choices.map((choice, index) => {
        const selected = choice.id === selectedChoiceID;
        const resultClass = selected ? (choice.isCorrect ? "correct" : "incorrect") : "";

        return (
          <button
            key={choice.id}
            className={`${selected ? "selected" : ""} ${resultClass}`}
            disabled={Boolean(selectedChoiceID)}
            onClick={() => onChoose(choice)}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{choice.text}</strong>
              {selected && choice.rationale && <small>{choice.rationale}</small>}
            </div>
            {selected && (choice.isCorrect ? <Check /> : <X />)}
          </button>
        );
      })}
    </div>
  );
}

type ReviewSessionProps = {
  items: DueReviewItem[];
  sessionLabel: string;
  returnLabel: string;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onFinish: () => void;
};

export function ReviewSession({ items, sessionLabel, returnLabel, onSnapshot, onFinish }: ReviewSessionProps) {
  const [index, setIndex] = useState(0);
  const [schedules, setSchedules] = useState<ReviewCardState[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const submissions = useRef(new Map<string, ReviewSubmissionIdentity>());
  const item = items[index];
  const {
    choice,
    selectedChoiceID,
    rating,
    responseTimeMs,
    revealed,
    setRevealed,
    error,
    setError,
    choose,
    reset
  } = useQuestionAttempt(item?.question);

  if (!item) {
    return (
      <ReviewCompletion
        empty={!items.length}
        completed={schedules.length}
        schedules={schedules}
        returnLabel={returnLabel}
        onFinish={onFinish}
      />
    );
  }

  const save = async () => {
    if (!choice || !rating || responseTimeMs === undefined || saveInFlight.current) return;

    const submissionKey = reviewSubmissionKey(
      item.topic.id,
      item.question,
      choice.id,
      rating,
      responseTimeMs
    );
    const submission = getOrCreateReviewSubmission(submissions.current, submissionKey);
    saveInFlight.current = true;
    setSaving(true);
    try {
      const result = await commit(
        item.question,
        item.topic,
        choice,
        rating,
        responseTimeMs,
        submission
      );
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

  const prompt = item.question;
  const shouldRevealChoices = prompt.kind !== "freeRecall" || revealed;
  const saveLabel = saving
    ? "Saving…"
    : index === items.length - 1
      ? "Finish Review"
      : "Save & Continue";

  return (
    <div className="review-shell">
      <header className="review-top">
        <button disabled={saving} onClick={onFinish}>
          <X /> Return to {returnLabel}
        </button>
        <span><Timer /> {sessionLabel} · {index + 1} of {items.length}</span>
      </header>

      <section className="surface review-card">
        <div className="review-context">
          <div>
            <Eyebrow>{reviewItemLabel(item)}</Eyebrow>
            <strong>{item.topic.title}</strong>
          </div>
          <span>{capitalize(prompt.transferLevel)}</span>
        </div>

        <h2>{prompt.prompt}</h2>
        {shouldRevealChoices ? (
          <ChoiceList question={prompt} selectedChoiceID={selectedChoiceID} onChoose={choose} />
        ) : (
          <RecallGate
            description="Answer mentally or aloud, then reveal the choices to score what you recalled."
            onReveal={() => setRevealed(true)}
          />
        )}

        {choice && rating && responseTimeMs !== undefined && (
          <div className="review-answer">
            <div className="review-explanation">
              <div className="review-explanation-heading">
                <Lightbulb />
                <span>Why this is correct</span>
              </div>
              <p>{prompt.explanation}</p>
            </div>
            <AutomaticRating
              rating={rating}
              responseTimeMs={responseTimeMs}
              isCorrect={choice.isCorrect}
            />
          </div>
        )}

        {error && <InlineError message={error} />}

        <div className="review-save">
          <span>
            {choice
              ? "Difficulty was inferred automatically from your first answer."
              : "Choose the answer you would use without hints."}
          </span>
          <button
            className="primary"
            disabled={!choice || !rating || responseTimeMs === undefined || saving}
            aria-busy={saving}
            onClick={save}
          >
            {saveLabel}
            {!saving && <ArrowRight />}
          </button>
        </div>
      </section>
    </div>
  );
}

type ReviewCompletionProps = {
  empty: boolean;
  completed: number;
  schedules: ReviewCardState[];
  returnLabel: string;
  onFinish: () => void;
};

function ReviewCompletion({ empty, completed, schedules, returnLabel, onFinish }: ReviewCompletionProps) {
  const earliest = [...schedules].sort((left, right) => left.dueAt.localeCompare(right.dueAt))[0];

  return (
    <div className="review-shell completion-wrap">
      <section className="surface completion">
        <Brain />
        <h1>{empty ? "Nothing is due" : "Review complete"}</h1>
        <p>
          {empty
            ? "New and scheduled checks will appear here when they are ready."
            : `You saved ${completed} retrieval ${completed === 1 ? "event" : "events"} to your local learner record.`}
        </p>
        {earliest && (
          <div>
            <Eyebrow>Earliest next review</Eyebrow>
            <strong>{relativeDate(earliest.dueAt)}</strong>
            <span>{intervalLabel(earliest)}</span>
          </div>
        )}
        <div className="completion-actions">
          <button className="primary" onClick={onFinish}>Return to {returnLabel}</button>
        </div>
      </section>
    </div>
  );
}

type AutomaticRatingProps = {
  rating: ReviewRating;
  responseTimeMs: number;
  isCorrect: boolean;
};

function AutomaticRating({ rating, responseTimeMs, isCorrect }: AutomaticRatingProps) {
  return (
    <div className={`automatic-rating ${rating}`} role="status" aria-live="polite">
      <div>
        <Timer />
        <span>Automatic difficulty</span>
        <strong>{reviewRatingLabel(rating)}</strong>
      </div>
      <small>
        {responseTimeLabel(responseTimeMs)} active response time. {isCorrect
          ? "No extra input needed."
          : "Incorrect answers are always Missed."}
      </small>
    </div>
  );
}

function reviewItemLabel(item: DueReviewItem): string {
  if (item.isRevised) return "Revised Check";
  if (item.isNew) return "New Check";
  return item.isScheduled ? "Scheduled Check" : "Due Check";
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
