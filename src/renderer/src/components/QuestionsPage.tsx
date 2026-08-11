import { ArrowUpRight, CalendarDays, ChevronRight, CircleHelp, FileText, Play, Plus } from "lucide-react";
import { useState } from "react";
import type { AppSnapshot, DueReviewItem, KnowledgeTopic, Question, ReviewCardState } from "../../../../shared/types";
import {
  activeQuestions,
  compareReviewItemsByDueAt,
  compareReviewItemsByID,
  reviewItemBuckets
} from "../../../../shared/domain";
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
  revised: DueReviewItem[];
  scheduled: DueReviewItem[];
};

export type QuestionReviewState = "new" | "revised" | "due" | "scheduled";

const reviewStateLabels: Record<QuestionReviewState, "Due now" | "Needs refresh" | "New" | "Scheduled"> = {
  due: "Due now",
  revised: "Needs refresh",
  new: "New",
  scheduled: "Scheduled"
};

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
  const { due, fresh, revised, scheduled } = reviewItemBuckets(snapshot, now);
  return {
    due: due.sort(compareReviewItemsByDueAt),
    fresh: fresh.sort(compareReviewItemsByID),
    revised: revised.sort(compareReviewItemsByID),
    scheduled: scheduled.sort(compareReviewItemsByDueAt)
  };
}

export function QuestionsPage({ snapshot, onReview, onStartReview, onCreateQuestion, onOpenTopic }: {
  snapshot: AppSnapshot;
  onReview: (topic: KnowledgeTopic, question: Question) => void;
  onStartReview: (items: DueReviewItem[]) => void;
  onCreateQuestion: (topic: KnowledgeTopic) => void;
  onOpenTopic: (topic: KnowledgeTopic) => void;
}) {
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const now = new Date();
  const queues = buildQuestionReviewQueues(snapshot, now);
  const questions = snapshot.topics.flatMap((topic) => activeQuestions(topic).map((question): QuestionEntry => ({
    topic,
    question,
    schedule: snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID[question.id]
  })));
  const stateOrder: Record<QuestionReviewState, number> = { due: 0, revised: 1, scheduled: 2, new: 3 };
  const orderedQuestions = [...questions].sort((left, right) => {
    const stateDifference = stateOrder[questionReviewState(left.question, left.schedule, now)] - stateOrder[questionReviewState(right.question, right.schedule, now)];
    return stateDifference || left.question.prompt.localeCompare(right.question.prompt);
  });

  return (
    <div className="questions-page">
      <header className="questions-heading">
        <div>
          <Eyebrow>{showAll ? "Question bank" : "Questions"}</Eyebrow>
          <h1>{showAll ? "Questions" : "Review"}</h1>
        </div>
        {showAll && <div className="questions-heading-actions">
          <span className="questions-total">{questions.length} {questions.length === 1 ? "question" : "questions"}</span>
          <button
            type="button"
            className="primary questions-create-button"
            disabled={snapshot.topics.length === 0}
            onClick={() => setTopicPickerOpen(true)}
          >
            <Plus /> Add question
          </button>
        </div>}
      </header>
      {questions.length > 0 && showAll ? (
        <section className="question-table-shell" aria-label="Question bank table">
          <div className="question-table-summary">
            <span>{questions.length} questions</span>
            <i aria-hidden="true">•</i>
            <span>{queues.due.length} due now</span>
            <i aria-hidden="true">•</i>
            <span>{queues.scheduled.length} scheduled</span>
          </div>
          <div className="question-table-scroll">
            <div className="question-table question-table-header" role="row">
              <span>Topic</span>
              <span>Status</span>
              <span>Question</span>
              <span>Concept</span>
              <span>Action</span>
            </div>
            {orderedQuestions.map(({ topic, question, schedule }) => {
              const state = questionReviewState(question, schedule, now);
              const concept = question.conceptIDs.map((id) => topic.concepts.find((item) => item.id === id)?.title ?? id)[0] ?? topic.title;
              return (
                <div className="question-table question-table-row" role="row" key={`${topic.id}:${question.id}`}>
                  <button type="button" className="question-table-topic" onClick={() => onOpenTopic(topic)}>{topic.title}</button>
                  <span className={`question-table-status ${state}`}>{reviewStateLabels[state]}</span>
                  <span className="question-table-prompt">{question.prompt}</span>
                  <span className="question-table-concept"><Tag>{concept}</Tag></span>
                  <button type="button" className="question-table-review" onClick={() => onReview(topic, question)}>Review</button>
                </div>
              );
            })}
          </div>
          <footer className="question-table-footer">1–{questions.length} of {questions.length} questions</footer>
        </section>
      ) : questions.length > 0 ? (
        <>
          <section className="review-today-card surface" aria-labelledby="review-today-heading">
            <div className="review-today-heading">
              <div className="review-today-title">
                <h2 id="review-today-heading">Today review</h2>
                <span className="review-count due">{queues.due.length} due</span>
              </div>
              <button type="button" className="primary review-start-button" disabled={queues.due.length === 0} onClick={() => onStartReview(queues.due)}><Play /> Start review</button>
            </div>
            {queues.due.length > 0 ? <>
              <div className="review-preview-header"><span>Question</span><span>Topic</span><span>Concept</span></div>
              <div className="review-preview-list">
                {queues.due.slice(0, 5).map((item) => {
                  const concept = item.question.conceptIDs.map((id) => item.topic.concepts.find((entry) => entry.id === id)?.title ?? id)[0] ?? item.topic.title;
                  return <button type="button" className="review-preview-row" key={item.id} onClick={() => onReview(item.topic, item.question)}>
                    <span>{item.question.prompt}</span><span>{item.topic.title}</span><span><Tag>{concept}</Tag></span>
                  </button>;
                })}
              </div>
              {queues.due.length > 5 && <button type="button" className="review-more-link" onClick={() => onStartReview(queues.due)}>+ {queues.due.length - 5} more due today</button>}
            </> : <p className="review-empty-copy">Nothing due today.</p>}
          </section>
          <div className="review-secondary-actions">
            <button type="button" className="review-secondary-action" disabled={queues.scheduled.length === 0} onClick={() => onStartReview(queues.scheduled)}>
              <CalendarDays /><span>Scheduled</span><strong>{queues.scheduled.length}</strong><ChevronRight className="review-secondary-chevron" />
            </button>
            <button type="button" className="review-secondary-action" disabled={queues.fresh.length === 0} onClick={() => onStartReview(queues.fresh)}>
              <FileText /><span>New</span><strong>{queues.fresh.length}</strong><ChevronRight className="review-secondary-chevron" />
            </button>
          </div>
          <button type="button" className="review-view-all" onClick={() => setShowAll(true)}><ArrowUpRight /> <span>View all questions</span></button>
        </>
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
