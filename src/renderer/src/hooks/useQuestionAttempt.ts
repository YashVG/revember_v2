import { useCallback, useEffect, useRef, useState } from "react";
import { inferReviewRating, normalizeResponseTimeMs } from "../../../../shared/review-timing";
import type { AnswerChoice, Question, ReviewRating } from "../../../../shared/types";

export function useQuestionAttempt(question?: Question) {
  const [selectedChoiceID, setSelectedChoiceID] = useState<string>();
  const [rating, setRating] = useState<ReviewRating>();
  const [responseTimeMs, setResponseTimeMs] = useState<number>();
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string>();
  const elapsedActiveMsRef = useRef(0);
  const activeStartedAtRef = useRef<number | undefined>(undefined);
  const timerStoppedRef = useRef(false);
  const choice = question?.choices.find((candidate) => candidate.id === selectedChoiceID);

  const startTimer = useCallback(() => {
    elapsedActiveMsRef.current = 0;
    timerStoppedRef.current = false;
    activeStartedAtRef.current = document.visibilityState === "hidden" || !document.hasFocus()
      ? undefined
      : performance.now();
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerStoppedRef.current || activeStartedAtRef.current === undefined) return;
    elapsedActiveMsRef.current += performance.now() - activeStartedAtRef.current;
    activeStartedAtRef.current = undefined;
  }, []);

  const resumeTimer = useCallback(() => {
    if (timerStoppedRef.current || activeStartedAtRef.current !== undefined || document.visibilityState === "hidden") return;
    activeStartedAtRef.current = performance.now();
  }, []);

  const stopTimer = useCallback(() => {
    pauseTimer();
    timerStoppedRef.current = true;
    return normalizeResponseTimeMs(elapsedActiveMsRef.current);
  }, [pauseTimer]);

  const reset = useCallback(() => {
    setSelectedChoiceID(undefined);
    setRating(undefined);
    setResponseTimeMs(undefined);
    setRevealed(false);
    setError(undefined);
    startTimer();
  }, [startTimer]);

  useEffect(() => {
    reset();
  }, [question?.id, question?.revision, reset]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") pauseTimer();
      else if (document.hasFocus()) resumeTimer();
    };
    window.addEventListener("blur", pauseTimer);
    window.addEventListener("focus", resumeTimer);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", pauseTimer);
      window.removeEventListener("focus", resumeTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pauseTimer, resumeTimer]);

  const choose = useCallback((candidate: AnswerChoice) => {
    if (selectedChoiceID) return;
    const elapsed = stopTimer();
    setSelectedChoiceID(candidate.id);
    setResponseTimeMs(elapsed);
    setRating(inferReviewRating(candidate.isCorrect, elapsed));
    setError(undefined);
  }, [selectedChoiceID, stopTimer]);

  return {
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
  };
}
