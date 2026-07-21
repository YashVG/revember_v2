import { useCallback, useEffect, useState } from "react";
import type { AnswerChoice, Question, ReviewRating } from "../../../../shared/types";

export function useQuestionAttempt(question?: Question) {
  const [selectedChoiceID, setSelectedChoiceID] = useState<string>();
  const [rating, setRating] = useState<ReviewRating>();
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string>();
  const choice = question?.choices.find((candidate) => candidate.id === selectedChoiceID);

  const reset = useCallback(() => {
    setSelectedChoiceID(undefined);
    setRating(undefined);
    setRevealed(false);
    setError(undefined);
  }, []);

  useEffect(() => {
    reset();
  }, [question?.id, question?.revision, reset]);

  const choose = useCallback((candidate: AnswerChoice) => {
    if (selectedChoiceID) return;
    setSelectedChoiceID(candidate.id);
    setRating(candidate.isCorrect ? undefined : "missed");
    setError(undefined);
  }, [selectedChoiceID]);

  return {
    choice,
    selectedChoiceID,
    rating,
    setRating,
    revealed,
    setRevealed,
    error,
    setError,
    choose,
    reset
  };
}
