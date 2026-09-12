/**
 * T078 — the durable local transition record (FR-032, Principle V).
 *
 * One append-only JSONL file per repository under
 * `<cacheRoot>/transitions/<repositoryId>.jsonl`. JSONL rather than a single JSON
 * array because the log only ever grows: appending a line costs nothing and never
 * rewrites history, and a torn tail damages one line instead of the whole file.
 *
 * Two rules the rest of the app depends on:
 *
 *   - `gateResultsAtTransition` is a **deep snapshot, not a reference**. The record
 *     must still explain *why* the item moved after the live gate results have been
 *     re-evaluated, and must carry what a later opt-in write-back would need to
 *     state the evidence as it stood at the time (FR-032, spec §Planned Direction).
 *     Copying field by field is what makes that true at runtime, where `readonly`
 *     is only a compile-time promise.
 *   - A corrupt line is skipped and the rest of the file still reads. A log that
 *     becomes unreadable in its entirety because one write was interrupted would
 *     not be durable in any useful sense.
 *
 * v1.0 never writes any of this back to a system of record (FR-033, FR-034); it is
 * a local record only.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { ProviderId } from '@core/model/declared.js';
import type {
  GateResult,
  GateStatus,
  ResolvedStateId,
  TransitionRecord,
  WorkItem,
} from '@core/model/observed.js';

import { encodeSegment, readTextOrNull } from './index.js';

export interface TransitionLog {
  append(repositoryId: string, record: TransitionRecord): Promise<void>;
  read(repositoryId: string): Promise<TransitionRecord[]>;
  /** Appends one record iff the resolved state changed. Returns it, or null. */
  recordIfChanged(
    repositoryId: string,
    previous: WorkItem | undefined,
    next: WorkItem,
    source: string,
  ): Promise<TransitionRecord | null>;
}

export function createTransitionLog(cacheRoot: string): TransitionLog {
  const transitionsDir = path.join(cacheRoot, 'transitions');

  const logFile = (repositoryId: string): string =>
    path.join(transitionsDir, `${encodeSegment(repositoryId)}.jsonl`);

  const appendRecord = async (
    repositoryId: string,
    record: TransitionRecord,
  ): Promise<void> => {
    await mkdir(transitionsDir, { recursive: true });
    // Append-only, so a crash can lose the tail but never the history before it.
    // The `read` path tolerates that torn tail rather than pretending it cannot
    // happen; a temp-file-and-rename rewrite would instead put the whole log at
    // risk on every single append.
    await appendFile(logFile(repositoryId), `${JSON.stringify(record)}\n`, 'utf8');
  };

  return {
    async append(repositoryId: string, record: TransitionRecord): Promise<void> {
      await appendRecord(repositoryId, snapshotRecord(record));
    },

    async read(repositoryId: string): Promise<TransitionRecord[]> {
      const raw = await readTextOrNull(logFile(repositoryId));
      if (raw === null) return [];
      const records: TransitionRecord[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed) as unknown;
        } catch {
          // One damaged line. Skip it; the rest of the file is still a record.
          continue;
        }
        if (isTransitionRecord(parsed)) records.push(parsed);
      }
      return records;
    },

    async recordIfChanged(
      repositoryId: string,
      previous: WorkItem | undefined,
      next: WorkItem,
      source: string,
    ): Promise<TransitionRecord | null> {
      // `undefined` previous means this is the first observation of the item, which
      // is a transition from nowhere — modelled by `fromStateId: null`, the reason
      // that field is nullable. Re-observing the same resolved state is not a
      // transition and must not add a line, or the log would grow with every poll.
      if (previous !== undefined && previous.stateId === next.stateId) return null;

      const record: TransitionRecord = {
        itemKey: next.key,
        fromStateId: previous === undefined ? null : previous.stateId,
        toStateId: next.stateId,
        // When the dashboard saw it, not when it happened (data-model.md), which
        // is exactly what `reconciledAt` records.
        observedAt: next.reconciledAt,
        gateResultsAtTransition: snapshotGateResults(next.gateResults),
        source,
      };
      await appendRecord(repositoryId, record);
      return record;
    },
  };
}

/**
 * A deep copy. The caller keeps mutating the live `WorkItem` it passed in; this
 * record has to keep explaining the transition regardless.
 */
function snapshotGateResults(results: readonly GateResult[]): GateResult[] {
  return results.map((result) => ({
    gateId: result.gateId,
    status: result.status,
    evaluatedAt: result.evaluatedAt,
    evidence:
      result.evidence === null
        ? null
        : { provider: result.evidence.provider, locator: result.evidence.locator },
    detail: result.detail,
  }));
}

function snapshotRecord(record: TransitionRecord): TransitionRecord {
  return {
    itemKey: record.itemKey,
    fromStateId: record.fromStateId,
    toStateId: record.toStateId,
    observedAt: record.observedAt,
    gateResultsAtTransition: snapshotGateResults(record.gateResultsAtTransition),
    source: record.source,
  };
}

const GATE_STATUSES: readonly GateStatus[] = ['passed', 'failed', 'not_evaluated'];

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResolvedStateId(value: unknown): value is ResolvedStateId {
  return typeof value === 'string';
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string';
}

function isGateResult(value: unknown): value is GateResult {
  if (!isRecordObject(value)) return false;
  if (typeof value.gateId !== 'string') return false;
  if (!GATE_STATUSES.some((status) => status === value.status)) return false;
  if (value.evaluatedAt !== null && typeof value.evaluatedAt !== 'string') return false;
  if (value.detail !== null && typeof value.detail !== 'string') return false;
  const evidence = value.evidence;
  if (evidence === null) return true;
  return (
    isRecordObject(evidence) &&
    typeof evidence.provider === 'string' &&
    typeof evidence.locator === 'string'
  );
}

/**
 * The log is our own output, but a half-written line is still untrusted bytes.
 * Validating the shape here is what lets `read` skip damage rather than hand a
 * malformed record to the engine (Principle IX).
 */
function isTransitionRecord(value: unknown): value is TransitionRecord {
  if (!isRecordObject(value)) return false;
  if (typeof value.itemKey !== 'string') return false;
  if (value.fromStateId !== null && !isResolvedStateId(value.fromStateId)) return false;
  if (!isResolvedStateId(value.toStateId)) return false;
  if (typeof value.observedAt !== 'string') return false;
  if (!isProviderId(value.source)) return false;
  const gateResults = value.gateResultsAtTransition;
  return Array.isArray(gateResults) && gateResults.every(isGateResult);
}
