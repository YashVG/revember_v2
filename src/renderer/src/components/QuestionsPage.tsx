import { CalendarClock, CircleHelp, Clock3, Plus, Play, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AppSnapshot, DueReviewItem, KnowledgeTopic, Question, ReviewCardState } from "../../../../shared/types";
import { activeQuestions } from "../../../../shared/domain";
import { Modal } from "./modal";
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

export type QuestionReviewState = "new" | "revised" | "due" | "scheduled";

export function questionReviewState(
  question: Question,
  schedule: ReviewCardState | undefined,
  now = new Date()
): QuestionReviewState {
  if (!schedule) return "new";
  if (schedule.questionRevision !== question.revision) return "revised";
  return new Date(schedule.dueAt) <= now ? "due" : "scheduled";
}

export function buildQuestionReviewQueues(snapshot: Pick<AppSnapshot, "topics" | "progress">, now = new Date()): QuestionReviewQueues {
  const queues: QuestionReviewQueues = { due: [], fresh: [], scheduled: [] };
  for (const topic of snapshot.topics) {
    for (const question of activeQuestions(topic)) {
      const schedule = snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID[question.id];
      const base = { id: `${topic.id}::${question.id}`, topicID: topic.id, questionID: question.id, topic, question };
      const state = questionReviewState(question, schedule, now);
      if (state === "new") queues.fresh.push({ ...base, isNew: true, isRevised: false });
      else if (state === "revised") queues.fresh.push({ ...base, isNew: false, isRevised: true });
      else if (state === "due") queues.due.push({ ...base, dueAt: schedule!.dueAt, isNew: false, isRevised: false });
      else queues.scheduled.push({ ...base, dueAt: schedule!.dueAt, isNew: false, isRevised: false, isScheduled: true });
    }
  }
  queues.due.sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? "") || left.id.localeCompare(right.id));
  queues.fresh.sort((left, right) => left.id.localeCompare(right.id));
  queues.scheduled.sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? "") || left.id.localeCompare(right.id));
  return queues;
}

export function QuestionsPage({ snapshot, onReview, onStartReview, onCreateQuestion, openTopicPicker = false, onTopicPickerOpened }: {
  snapshot: AppSnapshot;
  onReview: (topic: KnowledgeTopic, question: Question) => void;
  onStartReview: (items: DueReviewItem[]) => void;
  onCreateQuestion: (topic: KnowledgeTopic) => void;
  openTopicPicker?: boolean;
  onTopicPickerOpened?: () => void;
}) {
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  useEffect(() => {
    if (!openTopicPicker) return;
    setTopicPickerOpen(true);
    onTopicPickerOpened?.();
  }, [onTopicPickerOpened, openTopicPicker]);
  const now = new Date();
  const queues = buildQuestionReviewQueues(snapshot, now);
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
        <div className="questions-heading-actions">
          <span className="questions-total">{questions.length} {questions.length === 1 ? "question" : "questions"}</span>
          <button
            type="button"
            className="primary questions-create-button"
            disabled={snapshot.topics.length === 0}
            onClick={() => setTopicPickerOpen(true)}
          >
            <Plus /> Add question
          </button>
        </div>
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
            const state = questionReviewState(question, schedule, now);
            const status = questionReviewStateLabel(state);
            return (
              <article className={`surface question-library-card ${questionReviewStateClass(state)}`} key={`${topic.id}:${question.id}`}>
                <div className="question-library-copy">
                  <div className="question-library-meta">
                    <Tag>{topic.title}</Tag>
                    <span className={`question-library-status ${questionReviewStateClass(state)}`}>{status}</span>
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
      {topicPickerOpen && <QuestionTopicPicker
        topics={snapshot.topics}
        onClose={() => setTopicPickerOpen(false)}
        onSelect={(topic) => {
          setTopicPickerOpen(false);
          onCreateQuestion(topic);
        }}
      />}
    </div>
  );
}

function questionReviewStateLabel(state: QuestionReviewState): "Due now" | "New" | "Scheduled" {
  if (state === "due") return "Due now";
  return state === "scheduled" ? "Scheduled" : "New";
}

function questionReviewStateClass(state: QuestionReviewState): "due" | "new" | "scheduled" {
  if (state === "due") return "due";
  return state === "scheduled" ? "scheduled" : "new";
}

function QuestionTopicPicker({ topics, onClose, onSelect }: {
  topics: KnowledgeTopic[];
  onClose: () => void;
  onSelect: (topic: KnowledgeTopic) => void;
}) {
  return (
    <Modal title="Add question" icon={<Plus />} onClose={onClose}>
      <div className="question-topic-picker">
        <p>Choose the topic for this question.</p>
        <div className="question-topic-options">
          {topics.map((topic) => {
            const count = activeQuestions(topic).length;
            return (
              <button key={topic.id} type="button" onClick={() => onSelect(topic)}>
                <span>
                  <strong>{topic.title}</strong>
                  <small>{count} {count === 1 ? "question" : "questions"}</small>
                </span>
                <Plus aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
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
