export const REVIEW_SECONDS_PER_ITEM = 45;

export function reviewItemDurationLabel(seconds = REVIEW_SECONDS_PER_ITEM): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "<1m";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  return `~${Math.ceil(seconds / 60)}m`;
}
