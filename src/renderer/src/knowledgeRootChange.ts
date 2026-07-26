export type KnowledgeRootChangeResult<T> =
  | { changed: false }
  | { changed: true; snapshot: T };

export type RootScopedView = "home" | "topic" | "notes";

export function isKnowledgeRootChangeAllowed(view: RootScopedView, hasActiveRootScopedWorkflow: boolean): boolean {
  return view === "home" && !hasActiveRootScopedWorkflow;
}

export async function runGuardedKnowledgeRootChange<T>(
  canChange: () => Promise<boolean>,
  change: () => Promise<T>
): Promise<KnowledgeRootChangeResult<T>> {
  if (!await canChange()) return { changed: false };
  return { changed: true, snapshot: await change() };
}
