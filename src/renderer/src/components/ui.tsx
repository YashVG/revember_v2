import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

export function MasteryRing({ value, size }: { value: number; size: number }) {
  const progress = Math.max(0, Math.min(1, value));
  return <div
    className="mastery-ring"
    style={{ width: size, height: size, background: `conic-gradient(var(--cyan) ${progress * 360}deg, #242730 0deg)` }}
  >
    <div><strong>{Math.round(progress * 100)}%</strong></div>
  </div>;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/([A-Z])/g, " $1");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
