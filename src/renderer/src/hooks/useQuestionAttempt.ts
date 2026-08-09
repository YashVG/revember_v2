import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { inferReviewRating, normalizeResponseTimeMs } from "../../../../shared/review-timing";
import type { AnswerChoice, Question, ReviewRating } from "../../../../shared/types";

export function useQuestionAttempt(question?: Question, topicID?: string) {
  const [selectedChoiceID, setSelectedChoiceID] = useState<string>();
  const [rating, setRating] = useState<ReviewRating>();
  const [responseTimeMs, setResponseTimeMs] = useState<number>();
  const [answeredAt, setAnsweredAt] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string>();
  const elapsedActiveMsRef = useRef(0);
  const activeStartedAtRef = useRef<number | undefined>(undefined);
  const timerStoppedRef = useRef(false);
  const choice = question?.choices.find((candidate) => candidate.id === selectedChoiceID);
  const attemptIdentity = question
    ? `${topicID ?? ""}\u0000${question.id}\u0000${question.revision}`
    : undefined;

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
    setAnsweredAt(undefined);
    setRevealed(false);
    setError(undefined);
    elapsedActiveMsRef.current = 0;
    activeStartedAtRef.current = undefined;
    timerStoppedRef.current = true;
  }, []);

  useLayoutEffect(() => {
    reset();
    if (question?.id) startTimer();
  }, [attemptIdentity, question?.id, reset, startTimer]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) pauseTimer();
      else resumeTimer();
    };
    window.addEventListener("blur", pauseTimer);
    window.addEventListener("focus", resumeTimer);
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();
    return () => {
      window.removeEventListener("blur", pauseTimer);
      window.removeEventListener("focus", resumeTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pauseTimer, resumeTimer]);

  const choose = useCallback((candidate: AnswerChoice) => {
    if (selectedChoiceID) return;
    const elapsed = stopTimer();
    const selectedAt = new Date().toISOString();
    setSelectedChoiceID(candidate.id);
    setResponseTimeMs(elapsed);
    setAnsweredAt(selectedAt);
    setRating(inferReviewRating(candidate.isCorrect, elapsed));
    setError(undefined);
  }, [selectedChoiceID, stopTimer]);

  return {
    choice,
    selectedChoiceID,
    rating,
    responseTimeMs,
    answeredAt,
    revealed,
    setRevealed,
    error,
    setError,
    choose,
    reset
  };
}
