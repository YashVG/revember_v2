import { useEffect } from "react";
import { preventWindowUnload } from "../navigationGuard";

export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    window.addEventListener("beforeunload", preventWindowUnload);
    return () => window.removeEventListener("beforeunload", preventWindowUnload);
  }, [active]);
}
