export type BeforeLeaveGuard = () => boolean | Promise<boolean>;

export function preventWindowUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = "";
}

export async function runBeforeLeaveGuards(guards: Iterable<BeforeLeaveGuard>): Promise<boolean> {
  for (const guard of guards) {
    try {
      if (!await guard()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function runGuardedTransition<T>(
  current: T,
  next: T,
  canLeave: () => Promise<boolean>,
  apply: (value: T) => void
): Promise<boolean> {
  if (Object.is(current, next)) return false;
  if (!await canLeave()) return false;
  apply(next);
  return true;
}
