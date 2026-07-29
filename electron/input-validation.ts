/** Shared guards for values crossing the Electron persistence boundary. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

export function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  return array(value, label).map((item) => record(item, label));
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

export function nonEmptyExactString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

export function isoTimestamp(value: unknown, label: string): string {
  const text = nonEmptyExactString(value, label);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return text;
}

export function identifier(value: unknown, label: string): string {
  return validateIdentifier(nonEmptyString(value, label), label);
}

export function strictIdentifier(value: unknown, label: string): string {
  const id = nonEmptyExactString(value, label);
  if (id !== id.trim()) throw new Error(`${label} cannot start or end with whitespace.`);
  return validateIdentifier(id, label);
}

function validateIdentifier(value: string, label: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

export function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value as number;
}

export function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: Set<T>, label: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(`${label} is invalid.`);
  return value as T;
}
