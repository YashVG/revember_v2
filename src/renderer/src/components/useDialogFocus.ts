import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Keeps keyboard focus in renderer-owned dialogs and makes Escape predictable. */
export function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const timer = window.setTimeout(() => firstFocusable(ref.current)?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); } };
    document.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKeyDown); previouslyFocused?.focus(); };
  }, []);
  return { ref, onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = focusables(ref.current);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  } };
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("hidden")) : [];
}
function firstFocusable(root: HTMLElement | null) { return root?.querySelector<HTMLElement>("[autofocus]") ?? focusables(root)[0]; }
