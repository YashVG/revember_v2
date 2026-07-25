export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ConflictError = {
  message: string;
  isConflict: boolean;
};

export function resolveRevisionConflict(error: unknown, fallback: string): ConflictError {
  const message = toErrorMessage(error);
  const isConflict = isRevisionConflict(message);
  return { message: isConflict ? fallback : message, isConflict };
}

export function isRevisionConflict(error: unknown): boolean {
  return /revision conflict|changed while/i.test(toErrorMessage(error));
}
