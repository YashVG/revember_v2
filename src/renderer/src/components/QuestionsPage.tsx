import { useEffect, useState } from "react";
import type { AppSnapshot, DueReviewItem, KnowledgeTopic } from "../../../../shared/types";
import {
  activeQuestions,
  compareReviewItemsByDueAt,
  compareReviewItemsByID,
  reviewItemBuckets
} from "../../../../shared/domain";
import { Modal } from "./modal";
import { Eyebrow } from "./ui";

export type QuestionReviewQueues = {
  due: DueReviewItem[];
  fresh: DueReviewItem[];
  revised: DueReviewItem[];
  scheduled: DueReviewItem[];
};

export type QuestionLibraryFocus =
  | { kind: "review-dock" }
  | { kind: "topic"; topicID: string };

export type QuestionReviewDockAction = {
  items: DueReviewItem[];
  label: string;
  sessionLabel: string;
  description: string;
};

export type TopicQuestionSet = {
  topic: KnowledgeTopic;
  questionCount: number;
  dueCount: number;
  revisedCount: number;
  freshCount: number;
  scheduledCount: number;
  reviewItems: DueReviewItem[];
};

export function buildQuestionReviewQueues(snapshot: Pick<AppSnapshot, "topics" | "progress">, now = new Date()): QuestionReviewQueues {
  const { due, fresh, revised, scheduled } = reviewItemBuckets(snapshot, now);
  return {
    due: due.sort(compareReviewItemsByDueAt),
    fresh: fresh.sort(compareReviewItemsByID),
    revised: revised.sort(compareReviewItemsByID),
    scheduled: scheduled.sort(compareReviewItemsByDueAt)
  };
}

export function buildTopicQuestionSets(
  snapshot: Pick<AppSnapshot, "topics" | "progress">,
  now = new Date()
): TopicQuestionSet[] {
  const queues = buildQuestionReviewQueues(snapshot, now);
  return snapshot.topics.map((topic) => {
    const itemsFor = (items: DueReviewItem[]) => items.filter((item) => item.topicID === topic.id);
    const due = itemsFor(queues.due);
    const revised = itemsFor(queues.revised);
    const fresh = itemsFor(queues.fresh);
    const scheduled = itemsFor(queues.scheduled);
    return {
      topic,
      questionCount: activeQuestions(topic).length,
      dueCount: due.length,
      revisedCount: revised.length,
      freshCount: fresh.length,
      scheduledCount: scheduled.length,
      reviewItems: [...due, ...revised, ...fresh]
    };
  });
}

export function questionReviewDockAction(queues: QuestionReviewQueues): QuestionReviewDockAction {
  const next = [
    {
      items: queues.due,
      label: (count: number) => "Start " + count + " due now",
      sessionLabel: "Due now",
      description: "These are ready for scheduled recall."
    },
    {
      items: queues.revised,
      label: (count: number) => "Start " + count + " question" + (count === 1 ? "" : "s") + " to refresh",
      sessionLabel: "Needs refresh",
      description: "These changed after their last review."
    },
    {
      items: queues.fresh,
      label: (count: number) => "Start " + count + " new question" + (count === 1 ? "" : "s"),
      sessionLabel: "New",
      description: "These have not been reviewed yet."
    }
  ].find(({ items }) => items.length > 0);

  if (!next) {
    return {
      items: [],
      label: "Nothing ready to review",
      sessionLabel: "Review",
      description: queues.scheduled.length
        ? queues.scheduled.length + " question" + (queues.scheduled.length === 1 ? " is" : "s are") + " scheduled for later."
        : "Create a question to start a review queue."
    };
  }

  const count = next.items.length;
  return {
    items: next.items,
    label: next.label(count),
    sessionLabel: next.sessionLabel,
    description: next.description
  };
}

export function QuestionsPage({ snapshot, onStartReview, onStartTopicReview, onCreateQuestion, onOpenTopic, returnFocus, onReturnFocusHandled }: {
  snapshot: AppSnapshot;
  onStartReview: (items: DueReviewItem[], label: string) => void;
  onStartTopicReview: (topic: KnowledgeTopic, items: DueReviewItem[]) => void;
  onCreateQuestion: (topic: KnowledgeTopic) => void;
  onOpenTopic: (topic: KnowledgeTopic) => void;
  returnFocus?: QuestionLibraryFocus;
  onReturnFocusHandled: () => void;
}) {
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const now = new Date();
  const queues = buildQuestionReviewQueues(snapshot, now);
  const topicSets = buildTopicQuestionSets(snapshot, now);
  const questionCount = topicSets.reduce((count, set) => count + set.questionCount, 0);
  const reviewAction = questionReviewDockAction(queues);

  useEffect(() => {
    if (!returnFocus) return;
    const id = returnFocus.kind === "review-dock"
      ? "question-review-dock"
      : "question-topic-" + returnFocus.topicID;
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
    onReturnFocusHandled();
  }, [onReturnFocusHandled, returnFocus]);

  return (
    <div className="questions-page">
      <header className="questions-heading">
        <div>
          <Eyebrow>Question library</Eyebrow>
          <h1>Questions</h1>
          <p>Review a topic when it is ready, or browse its full question set.</p>
        </div>
        <div className="questions-heading-actions">
          <span className="questions-total">{topicSets.length} {topicSets.length === 1 ? "topic" : "topics"} · {questionCount} {questionCount === 1 ? "question" : "questions"}</span>
          <button
            type="button"
            className="primary questions-create-button"
            disabled={snapshot.topics.length === 0}
            onClick={() => setTopicPickerOpen(true)}
          >
            Add question
          </button>
        </div>
      </header>

      <section id="question-review-dock" className="surface questions-review-queue" aria-labelledby="questions-review-queue-heading" tabIndex={-1}>
        <div className="questions-review-dock-copy">
          <div>
            <h2 id="questions-review-queue-heading">Review today</h2>
            <p>{reviewAction.items.length
              ? reviewAction.items.length + " question" + (reviewAction.items.length === 1 ? "" : "s") + " ready to review"
              : reviewAction.description}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="primary questions-review-start"
          disabled={!reviewAction.items.length}
          onClick={() => onStartReview(reviewAction.items, reviewAction.sessionLabel)}
        >
          {reviewAction.items.length ? "Review today" : "Nothing ready"}
        </button>
      </section>

      {topicSets.length > 0 ? (
        <section className="question-topic-library" aria-label="Question topics">
          <header className="question-topic-library-heading">
            <Eyebrow>Your topics</Eyebrow>
            <div aria-hidden="true">
              <span>Topic</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
          </header>
          {topicSets.map((set) => {
            const { topic, questionCount: count, dueCount, revisedCount, freshCount, scheduledCount, reviewItems } = set;
            const returned = returnFocus?.kind === "topic" && returnFocus.topicID === topic.id;
            return (
              <article
                id={"question-topic-" + topic.id}
                className={"question-topic-row" + (returned ? " returned" : "")}
                key={topic.id}
                tabIndex={-1}
              >
                <header className="question-topic-copy">
                  <div>
                    <h2>{topic.title}</h2>
                    <span>{count} {count === 1 ? "question" : "questions"}</span>
                    <p>{topic.summary}</p>
                  </div>
                </header>
                <div className="question-topic-statuses" aria-label={topic.title + " review status"}>
                  {count ? <>
                    <TopicStatus count={dueCount} label="Due now" tone="amber" />
                    <TopicStatus count={revisedCount} label="Refresh" tone="amber" />
                    <TopicStatus count={freshCount} label="New" />
                    <TopicStatus count={scheduledCount} label="Later" muted />
                  </> : <span className="question-topic-empty-status">No questions yet</span>}
                </div>
                <div className="question-topic-actions">
                  <button
                    type="button"
                    className="primary question-topic-review"
                    disabled={!reviewItems.length}
                    onClick={() => onStartTopicReview(topic, reviewItems)}
                  >
                    {reviewItems.length ? "Review " + reviewItems.length + " ready" : "Nothing ready"}
                  </button>
                  <button type="button" className="question-topic-view" onClick={() => onOpenTopic(topic)}>
                    View set
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="surface questions-empty">
          <h2>No topics yet</h2>
          <p>Add a topic before creating a question set.</p>
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
    <Modal title="Add question" onClose={onClose}>
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
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function TopicStatus({ count, label, tone = "cyan", muted = false }: {
  count: number;
  label: string;
  tone?: "cyan" | "amber";
  muted?: boolean;
}) {
  return (
    <span className={"question-topic-status " + tone + (muted ? " muted" : "")}>
      <strong>{count}</strong>
      <span>{label}</span>
    </span>
  );
}
