import type { ReactNode } from "react";

export function Eyebrow({ children, id }: { children: ReactNode; id?: string }) {
  return <div id={id} className="eyebrow">{children}</div>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/([A-Z])/g, " $1");
}
