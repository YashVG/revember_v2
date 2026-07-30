import { useMemo } from "react";
import { ArrowRight, CircleAlert, Play, Plus } from "lucide-react";
import type { AppSnapshot, DueReviewItem } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { Eyebrow } from "./ui";

type ReviewItems = ReturnType<typeof dueReviewItems>;

type HomePageProps = {
  snapshot: AppSnapshot;
  onCreateQuestion: () => void;
  onStartReview: (items: DueReviewItem[]) => void;
};

export function HomePage({ snapshot, onCreateQuestion, onStartReview }: HomePageProps) {
  const today = useMemo(() => new Date(), []);
  const due = useMemo(() => dueReviewItems(snapshot), [snapshot]);

  return (
    <div className="home-page home-study-page">
      <StudyFocus
        snapshot={snapshot}
        due={due}
        now={today}
        onStartReview={onStartReview}
        onCreateQuestion={onCreateQuestion}
      />
    </div>
  );
}

type StudyFocusProps = {
  snapshot: AppSnapshot;
  due: ReviewItems;
  onStartReview: (items: DueReviewItem[]) => void;
  onCreateQuestion: () => void;
  now: Date;
};

function StudyFocus({ snapshot, due, onStartReview, onCreateQuestion, now }: StudyFocusProps) {
  const focus = useMemo(() => buildHomeStudyFocus(snapshot, due, now), [due, now, snapshot]);
  const hasReview = focus.reviewItems.length > 0;
  const reviewDescription = `${estimateReviewMinutes(focus.reviewItems.length)} · ${formatTopicList(focus.reviewItems)}`;
  const primaryAction = hasReview ? () => onStartReview(focus.reviewItems) : onCreateQuestion;
  const practiceAttention = () => {
    if (!focus.attention) return;
    if (focus.attention.reviewItems.length) onStartReview(focus.attention.reviewItems);
    else onCreateQuestion();
  };

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
            <p>{hasReview ? reviewDescription : "Create a question now and it will become part of your next review."}</p>
          </div>
          <button className="primary study-focus-start" type="button" onClick={primaryAction}>
            {hasReview ? <Play /> : <Plus />}
            {hasReview ? "Start review" : "Create a question"}
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

      <section className={`study-focus-attention ${focus.attention ? "has-attention" : ""}`} aria-label="Attention summary">
        <CircleAlert aria-hidden="true" />
        <strong>{focus.attention ? "Needs attention" : "On track"}</strong>
        <span>{focus.attention?.title ?? "No recent misses"}</span>
        <small>{focus.attention ? `${focus.attention.misses} recent ${focus.attention.misses === 1 ? "miss" : "misses"}` : "Keep your current review rhythm"}</small>
        {focus.attention && (
          <button type="button" onClick={practiceAttention}>
            {focus.attention.reviewItems.length ? "Practice this topic" : "Create a question"} <ArrowRight />
          </button>
        )}
      </section>

      <section className="study-focus-continue" aria-labelledby="study-focus-continue-title">
        <h2 id="study-focus-continue-title">Keep learning</h2>
        <div>
          <button type="button" onClick={onCreateQuestion}><Plus />Create a question</button>
        </div>
      </section>

      <footer className="study-focus-footer">Based on the last 7 days</footer>
    </section>
  );
}

type HomeStudyFocus = {
  reviewItems: DueReviewItem[];
  reviewState: "due" | "ready";
  attention?: {
    title: string;
    misses: number;
    topicID: string;
    reviewItems: DueReviewItem[];
  };
};

function buildHomeStudyFocus(snapshot: AppSnapshot, due: ReviewItems, now: Date): HomeStudyFocus {
  const scheduled = due.filter((item) => !item.isNew && !item.isRevised);
  const reviewItems = scheduled.length ? scheduled : due;
  const currentQuestionRevisions = new Map(snapshot.topics.flatMap((topic) => (
    topic.questions.map((question) => [`${topic.id}:${question.id}`, question.revision] as const)
  )));
  const cutoff = now.getTime() - 7 * 86_400_000;
  const groups = new Map<string, { title: string; misses: number; topicID: string; conceptID?: string }>();

  for (const event of snapshot.progress.reviewEvents) {
    if (event.isCorrect || new Date(event.reviewedAt).getTime() < cutoff) continue;
    if (currentQuestionRevisions.get(`${event.topicID}:${event.questionID}`) !== event.questionRevision) continue;
    const topic = snapshot.topics.find((candidate) => candidate.id === event.topicID);
    const conceptID = event.conceptIDs[0];
    const concept = conceptID ? topic?.concepts.find((candidate) => candidate.id === conceptID) : undefined;
    const key = concept ? `${event.topicID}:${concept.id}` : `topic:${event.topicID}`;
    const current = groups.get(key) ?? {
      title: concept?.title ?? topic?.title ?? "Recent questions",
      misses: 0,
      topicID: event.topicID,
      ...(concept ? { conceptID: concept.id } : {})
    };
    current.misses += 1;
    groups.set(key, current);
  }

  const strongestNeed = [...groups.values()]
    .sort((left, right) => right.misses - left.misses || left.title.localeCompare(right.title))[0];
  const attention = strongestNeed && {
    title: strongestNeed.title,
    misses: strongestNeed.misses,
    topicID: strongestNeed.topicID,
    reviewItems: reviewItems.filter((item) => (
      strongestNeed.conceptID
        ? item.question.conceptIDs.includes(strongestNeed.conceptID)
        : item.topicID === strongestNeed.topicID
    ))
  };

  return { reviewItems, reviewState: scheduled.length ? "due" : "ready", ...(attention ? { attention } : {}) };
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
