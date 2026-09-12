/**
 * T015. Failures are values, not exceptions (provider-interface.md rule 1).
 *
 * A provider that throws takes down unrelated parts of the dashboard; a provider
 * that returns a typed failure lets the item list keep rendering everything else
 * (Principle III, FR-037). The IPC surface repeats the rule for the same reason —
 * a rejected promise carrying a stack cannot be rendered as an in-place error
 * with a retry (ipc-surface.md rule 5).
 */

/** Why something failed. Closed set, because the UI renders a different affordance per reason. */
export type FailureReason =
  /** The thing asked for is not there: a missing file, a deleted issue. */
  | 'not_found'
  /** No credential configured for a provider that needs one (FR-035). */
  | 'not_configured'
  /** A credential exists but was rejected. */
  | 'unauthenticated'
  /** The provider refused for quota reasons; a retry later may succeed. */
  | 'rate_limited'
  /** Network or host failure. */
  | 'unreachable'
  /** The response did not match its schema (Principle IX). */
  | 'invalid_response'
  /** Caller-supplied input was rejected; carries field-level detail. */
  | 'invalid_input'
  /** The capability is absent in this configuration — an unconfigured console, say. */
  | 'unavailable'
  /** The operation conflicts with existing state, e.g. a duplicate registration. */
  | 'conflict';

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure {
  readonly ok: false;
  readonly reason: FailureReason;
  /** Actionable: what failed, and what the engineer can do next (Principle V). */
  readonly message: string;
  /** Field path, when the failure is about one field (FR-025, FR-044). */
  readonly field?: string;
  /** Source line, when the failure is about a manifest (research.md §5). */
  readonly line?: number;
}

export type Result<T> = Ok<T> | Failure;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function fail(
  reason: FailureReason,
  message: string,
  extra?: { field?: string; line?: number },
): Failure {
  const result: Failure = { ok: false, reason, message };
  if (extra?.field === undefined && extra?.line === undefined) return result;
  return { ...result, ...(extra.field !== undefined ? { field: extra.field } : {}), ...(extra.line !== undefined ? { line: extra.line } : {}) };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function isFailure<T>(result: Result<T>): result is Failure {
  return !result.ok;
}

/** Narrows a list of results to the successful values, discarding failures. */
export function okValues<T>(results: readonly Result<T>[]): T[] {
  const values: T[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
  }
  return values;
}

export function failures<T>(results: readonly Result<T>[]): Failure[] {
  const collected: Failure[] = [];
  for (const result of results) {
    if (!result.ok) collected.push(result);
  }
  return collected;
}
