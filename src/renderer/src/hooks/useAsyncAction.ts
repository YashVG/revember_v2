import { useCallback, useState } from "react";
import { toErrorMessage } from "../utils";

type ErrorFormatter = (cause: unknown) => string;

export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const run = useCallback(async <T,>(operation: () => Promise<T>, formatError: ErrorFormatter = toErrorMessage): Promise<T | undefined> => {
    if (pending) return undefined;
    setPending(true);
    setError(undefined);
    try {
      return await operation();
    } catch (cause) {
      setError(formatError(cause));
      return undefined;
    } finally {
      setPending(false);
    }
  }, [pending]);

  return { pending, error, setError, run };
}
