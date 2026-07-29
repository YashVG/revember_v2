import { CalendarClock, CircleHelp, Clock3, Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { AppSnapshot, DueReviewItem, KnowledgeTopic, Question, ReviewCardState } from "../../../../shared/types";
import { activeQuestions } from "../../../../shared/domain";
import { Eyebrow, Tag } from "./ui";

type QuestionEntry = {
  topic: KnowledgeTopic;
  question: Question;
  schedule?: ReviewCardState;
};

export type QuestionReviewQueues = {
  due: DueReviewItem[];
  fresh: DueReviewItem[];
  scheduled: DueReviewItem[];
};

export function buildQuestionReviewQueues(snapshot: Pick<AppSnapshot, "topics" | "progress">, now = new Date()): QuestionReviewQueues {
  const queues: QuestionReviewQueues = { due: [], fresh: [], scheduled: [] };
  for (const topic of snapshot.topics) {
    for (const question of activeQuestions(topic)) {
      const schedule = snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID[question.id];
      const base = { id: `${topic.id}::${question.id}`, topicID: topic.id, questionID: question.id, topic, question };
      if (!schedule) queues.fresh.push({ ...base, isNew: true, isRevised: false });
      else if (schedule.questionRevision !== question.revision) queues.fresh.push({ ...base, isNew: false, isRevised: true });
      else if (new Date(schedule.dueAt) <= now) queues.due.push({ ...base, dueAt: schedule.dueAt, isNew: false, isRevised: false });
      else queues.scheduled.push({ ...base, dueAt: schedule.dueAt, isNew: false, isRevised: false, isScheduled: true });
    }
  }
  queues.due.sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? "") || left.id.localeCompare(right.id));
  queues.fresh.sort((left, right) => left.id.localeCompare(right.id));
  queues.scheduled.sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? "") || left.id.localeCompare(right.id));
  return queues;
}

export function QuestionsPage({ snapshot, onReview, onStartReview }: {
  snapshot: AppSnapshot;
  onReview: (topic: KnowledgeTopic, question: Question) => void;
  onStartReview: (items: DueReviewItem[]) => void;
}) {
  const now = Date.now();
  const queues = buildQuestionReviewQueues(snapshot, new Date(now));
  const questions = snapshot.topics.flatMap((topic) => activeQuestions(topic).map((question): QuestionEntry => ({
    topic,
    question,
    schedule: snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID[question.id]
  })));
  const queueTotal = queues.due.length + queues.fresh.length + queues.scheduled.length;

  return (
    <div className="questions-page">
      <header className="questions-heading">
        <div>
          <Eyebrow>Local retrieval library</Eyebrow>
          <h1>Questions</h1>
        <p>Choose a queue above to start, or review any question directly below.</p>
        </div>
        <span className="questions-total">{questions.length} {questions.length === 1 ? "question" : "questions"}</span>
      </header>
      <section className="surface questions-review-queue" aria-labelledby="questions-review-queue-heading">
        <div className="questions-review-queue-copy">
          <Eyebrow>Review queue</Eyebrow>
          <h2 id="questions-review-queue-heading">Pick a queue</h2>
          <span className="questions-queue-total">{queueTotal} total</span>
        </div>
        <div className="questions-review-actions">
          <QueueAction label="Due now" count={queues.due.length} description="Ready" icon={<Clock3 />} onStart={() => onStartReview(queues.due)} />
          <QueueAction label="New" count={queues.fresh.length} description="Unseen" icon={<Sparkles />} onStart={() => onStartReview(queues.fresh)} />
          <QueueAction label="Scheduled" count={queues.scheduled.length} description="Ahead" icon={<CalendarClock />} scheduled onStart={() => onStartReview(queues.scheduled)} />
        </div>
      </section>
      {questions.length > 0 ? (
        <div className="questions-list">
          {questions.map(({ topic, question, schedule }) => {
            const hasCurrentSchedule = schedule?.questionRevision === question.revision;
            const status = !hasCurrentSchedule ? "New" : new Date(schedule.dueAt).getTime() <= now ? "Due now" : "Scheduled";
            return (
              <article className={`surface question-library-card ${status === "Due now" ? "due" : status === "New" ? "new" : "scheduled"}`} key={`${topic.id}:${question.id}`}>
                <div className="question-library-copy">
                  <div className="question-library-meta">
                    <Tag>{topic.title}</Tag>
                    <span className={`question-library-status ${status === "Due now" ? "due" : status === "New" ? "new" : ""}`}>{status}</span>
                  </div>
                  <h2>{question.prompt}</h2>
                  <div className="question-library-concepts">
                    {question.conceptIDs.map((id) => <Tag key={id}>{topic.concepts.find((concept) => concept.id === id)?.title ?? id}</Tag>)}
                  </div>
                </div>
                <button type="button" className="question-library-action" onClick={() => onReview(topic, question)}><Play /> Review question</button>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="surface questions-empty">
          <CircleHelp />
          <h2>No questions yet</h2>
          <p>Create questions from a topic and they will appear here for quick, focused review.</p>
        </section>
      )}
    </div>
  );
}

function QueueAction({ label, count, description, icon, scheduled = false, onStart }: {
  label: "Due now" | "New" | "Scheduled";
  count: number;
  description: string;
  icon: ReactNode;
  scheduled?: boolean;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      className={`question-queue-action ${scheduled ? "scheduled" : ""}`}
      disabled={count === 0}
      aria-label={`Review ${label.toLowerCase()} (${count})`}
      onClick={onStart}
    >
      <span className="question-queue-icon">{icon}</span>
      <span className="question-queue-copy"><strong>{count}</strong><span>{label}</span><small>{description}</small></span>
      <Play />
    </button>
  );
}
