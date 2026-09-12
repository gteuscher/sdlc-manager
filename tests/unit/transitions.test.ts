/**
 * T074 — the local transition record (FR-032, Principle V).
 *
 * The property under test is the one that is easy to get wrong and impossible to
 * notice later: `gateResultsAtTransition` must be a **snapshot, not a reference**.
 *
 * Why it matters is worth stating, because `readonly` in the type makes it look
 * handled. The record's job is to explain *why* an item moved. Gate results are
 * re-evaluated on every reconciliation, so if the record holds a reference, then
 * the next reconciliation quietly rewrites history and the record ends up
 * explaining the present rather than the moment. The spec's Planned Direction
 * adds a second reason: a later opt-in write-back has to state the evidence as it
 * stood at the time, and it cannot do that from a live object.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCache } from '@main/cache/index';
import { createTransitionLog } from '@main/cache/transitions';
import type { GateResult, WorkItem } from '@core/model/observed';
import { UNMAPPED } from '@core/model/observed';

let userData: string;
let cacheRoot: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'sdlc-transitions-'));
  cacheRoot = createCache(userData).root;
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

function gateResult(overrides: Partial<GateResult> = {}): GateResult {
  return {
    gateId: 'weighed',
    status: 'passed',
    evaluatedAt: '2026-09-11T10:00:00.000Z',
    evidence: { provider: 'ledger', locator: 'records/P-1/weight.json' },
    detail: 'within tolerance',
    ...overrides,
  };
}

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    key: 'P-1',
    title: 'First parcel',
    repositoryId: 'depot',
    packageId: 'haulage',
    packageVersion: '1.0.0',
    unit: 'parcel',
    stateId: 'intake',
    rawState: 'alpha',
    gateResults: [gateResult()],
    attention: null,
    reconciledAt: '2026-09-11T10:00:00.000Z',
    freshness: 'fresh',
    sources: ['ledger'],
    disagreements: [],
    fields: { key: 'P-1' },
    ...overrides,
  };
}

describe('recordIfChanged', () => {
  it('records the first observation of an item, with no prior state', async () => {
    const log = createTransitionLog(cacheRoot);
    const record = await log.recordIfChanged('depot', undefined, workItem(), 'ledger');

    expect(record).not.toBeNull();
    expect(record?.fromStateId).toBeNull();
    expect(record?.toStateId).toBe('intake');
  });

  it('records a move between states', async () => {
    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    const moved = await log.recordIfChanged('depot', workItem(), workItem({ stateId: 'dispatch', rawState: 'beta' }), 'ledger');

    expect(moved?.fromStateId).toBe('intake');
    expect(moved?.toStateId).toBe('dispatch');
  });

  it('records nothing when the state is unchanged, so the log is moves and not polls', async () => {
    const log = createTransitionLog(cacheRoot);
    const item = workItem();
    await log.recordIfChanged('depot', undefined, item, 'ledger');

    // A reconciliation that found nothing new must not grow the log; otherwise
    // a poll every sixty seconds buries the actual transitions.
    expect(await log.recordIfChanged('depot', item, workItem(), 'ledger')).toBeNull();
    expect(await log.read('depot')).toHaveLength(1);
  });

  it('records a move into the unmapped sentinel, which is a real observation', async () => {
    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    const record = await log.recordIfChanged(
      'depot',
      workItem(),
      workItem({ stateId: UNMAPPED, rawState: 'impounded' }),
      'ledger',
    );
    expect(record?.toStateId).toBe(UNMAPPED);
  });

  it('names the provider that reported the move', async () => {
    const log = createTransitionLog(cacheRoot);
    const record = await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    expect(record?.source).toBe('ledger');
  });

  it('stamps when the dashboard saw it, which is not when it happened', async () => {
    const log = createTransitionLog(cacheRoot);
    const record = await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    expect(record?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('gateResultsAtTransition is a snapshot, not a reference (FR-032)', () => {
  it('survives later mutation of the live gate results', async () => {
    const log = createTransitionLog(cacheRoot);
    const live: GateResult[] = [gateResult()];
    const item = workItem({ gateResults: live });

    const record = await log.recordIfChanged('depot', undefined, item, 'ledger');

    // The next reconciliation re-evaluates and the gate now fails. The record
    // must still explain the move as it was justified at the time.
    live[0] = gateResult({ status: 'failed', detail: 'over the limit' });

    expect(record?.gateResultsAtTransition[0]?.status).toBe('passed');
    expect(record?.gateResultsAtTransition[0]?.detail).toBe('within tolerance');
  });

  it('holds a distinct object, not the same one the item holds', async () => {
    const log = createTransitionLog(cacheRoot);
    const item = workItem();
    const record = await log.recordIfChanged('depot', undefined, item, 'ledger');

    expect(record?.gateResultsAtTransition[0]).not.toBe(item.gateResults[0]);
    expect(record?.gateResultsAtTransition[0]).toEqual(item.gateResults[0]);
  });

  it('snapshots nested evidence too, not just the top level', async () => {
    const log = createTransitionLog(cacheRoot);
    const evidence = { provider: 'ledger', locator: 'records/P-1/weight.json' };
    const item = workItem({ gateResults: [gateResult({ evidence })] });
    const record = await log.recordIfChanged('depot', undefined, item, 'ledger');

    expect(record?.gateResultsAtTransition[0]?.evidence).not.toBe(evidence);
    expect(record?.gateResultsAtTransition[0]?.evidence?.locator).toBe('records/P-1/weight.json');
  });

  it('persists the snapshot to disk, not only in the returned record', async () => {
    const log = createTransitionLog(cacheRoot);
    const live: GateResult[] = [gateResult()];
    await log.recordIfChanged('depot', undefined, workItem({ gateResults: live }), 'ledger');
    live[0] = gateResult({ status: 'failed' });

    const [persisted] = await log.read('depot');
    expect(persisted?.gateResultsAtTransition[0]?.status).toBe('passed');
  });

  it('carries the three-value gate status through unchanged', async () => {
    const log = createTransitionLog(cacheRoot);
    const item = workItem({
      gateResults: [
        gateResult({ gateId: 'a', status: 'passed' }),
        gateResult({ gateId: 'b', status: 'failed' }),
        gateResult({ gateId: 'c', status: 'not_evaluated', evaluatedAt: null }),
      ],
    });
    const record = await log.recordIfChanged('depot', undefined, item, 'ledger');
    expect(record?.gateResultsAtTransition.map((result) => result.status)).toEqual([
      'passed',
      'failed',
      'not_evaluated',
    ]);
  });
});

describe('the log is durable and append-only', () => {
  it('reads back every record in the order it was appended', async () => {
    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    await log.recordIfChanged('depot', workItem(), workItem({ stateId: 'dispatch' }), 'ledger');
    await log.recordIfChanged('depot', workItem({ stateId: 'dispatch' }), workItem({ stateId: 'transit' }), 'ledger');

    expect((await log.read('depot')).map((record) => record.toStateId)).toEqual(['intake', 'dispatch', 'transit']);
  });

  it('returns an empty log for a repository with no history, rather than failing', async () => {
    expect(await createTransitionLog(cacheRoot).read('never-seen')).toEqual([]);
  });

  it('skips a torn line and still reads the rest', async () => {
    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    await log.recordIfChanged('depot', workItem(), workItem({ stateId: 'dispatch' }), 'ledger');

    // Simulate a write interrupted mid-line, which is the failure JSONL is
    // chosen to survive.
    const file = join(cacheRoot, 'transitions', 'depot.jsonl');
    const contents = await readFile(file, 'utf8');
    await writeFile(file, `${contents}{"itemKey":"P-2","toStat`, 'utf8');

    const records = await log.read('depot');
    expect(records).toHaveLength(2);
    expect(records[1]?.toStateId).toBe('dispatch');
  });

  it('keeps separate repositories in separate logs', async () => {
    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    await log.recordIfChanged('annex', undefined, workItem({ repositoryId: 'annex', key: 'Q-1' }), 'ledger');

    expect(await log.read('depot')).toHaveLength(1);
    expect((await log.read('annex'))[0]?.itemKey).toBe('Q-1');
  });

  it('tolerates a repository id that is not a safe filename', async () => {
    const log = createTransitionLog(cacheRoot);
    const record = await log.recordIfChanged('../../etc/passwd', undefined, workItem(), 'ledger');
    expect(record).not.toBeNull();
    expect(await log.read('../../etc/passwd')).toHaveLength(1);
  });

  it('appends rather than rewriting, so history cannot be lost by a later write', async () => {
    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');
    const file = join(cacheRoot, 'transitions', 'depot.jsonl');
    const first = await readFile(file, 'utf8');

    await log.recordIfChanged('depot', workItem(), workItem({ stateId: 'dispatch' }), 'ledger');
    const second = await readFile(file, 'utf8');

    expect(second.startsWith(first)).toBe(true);
  });

  it('writes nothing back to any system of record — the log is local only (FR-033, FR-034)', async () => {
    // The only path this module has is into the cache directory it was given.
    const elsewhere = join(userData, 'system-of-record');
    await mkdir(elsewhere, { recursive: true });

    const log = createTransitionLog(cacheRoot);
    await log.recordIfChanged('depot', undefined, workItem(), 'ledger');

    const { readdir } = await import('node:fs/promises');
    expect(await readdir(elsewhere)).toEqual([]);
  });
});
