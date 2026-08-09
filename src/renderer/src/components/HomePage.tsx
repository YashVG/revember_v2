import { useMemo } from "react";
import { ArrowRight, FileText, Play } from "lucide-react";
import type { AppSnapshot, DueReviewItem } from "../../../../shared/types";
import { dueReviewItems } from "../../../../shared/domain";
import { Eyebrow } from "./ui";

type HomePageProps = {
  snapshot: AppSnapshot;
  onCreateNote: () => void;
  onStartReview: (items: DueReviewItem[]) => void;
};

export function HomePage({ snapshot, onCreateNote, onStartReview }: HomePageProps) {
  const reviewItems = useMemo(() => dueReviewItems(snapshot), [snapshot]);
  const hasReview = reviewItems.length > 0;

  return (
    <div className="home-page home-study-page">
      <section className="study-focus" aria-labelledby="study-focus-title">
        <header className="study-focus-heading">
          <Eyebrow>Today</Eyebrow>
          <h1 id="study-focus-title">One clear next step</h1>
          <p>{hasReview ? "Work through what is ready, then come back tomorrow." : "You are caught up. Add a note when you learn something new."}</p>
        </header>

        <article className="study-focus-session surface" aria-labelledby="study-focus-session-title">
          <div className="study-focus-session-heading">
            <div>
              <h2 id="study-focus-session-title">
                {hasReview
                  ? `${reviewItems.length} ${reviewItems.length === 1 ? "question" : "questions"} ready`
                  : "Nothing ready to review"}
              </h2>
              <p>{hasReview ? formatTopicList(reviewItems) : "Notes stay in Notes; questions stay in the Question Library."}</p>
            </div>
            <button className="primary study-focus-start" type="button" onClick={() => hasReview ? onStartReview(reviewItems) : onCreateNote()}>
              {hasReview ? <Play /> : <FileText />}
              {hasReview ? "Start review" : "Write a note"}
            </button>
          </div>

          {hasReview && (
            <div className="study-focus-preview" aria-label="Questions in this review">
              {reviewItems.slice(0, 2).map((item, index) => (
                <div className="study-focus-preview-row" key={item.id}>
                  <span>{index + 1}</span>
                  <strong>{item.question.prompt}</strong>
                  <ArrowRight aria-hidden="true" />
                </div>
              ))}
              {reviewItems.length > 2 && <p>+ {reviewItems.length - 2} more</p>}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function formatTopicList(items: readonly DueReviewItem[]): string {
  const titles = [...new Set(items.map((item) => item.topic.title))];
  if (titles.length === 1) return titles[0]!;
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, 2).join(" and ")} + ${titles.length - 2} more`;
}
