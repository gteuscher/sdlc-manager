/**
 * T109 — conversation scoping and persistence (FR-028, FR-029).
 *
 * Two things are being pinned down, and the second is the one that is expensive
 * to retrofit.
 *
 * **Scoping.** One conversation per state per item. The spec's Planned Direction
 * says so explicitly: "the scoping rule — one conversation per state per item —
 * should hold from the start, because scoping is the part that is expensive to
 * retrofit." A console that turns out to be per-item rather than per-state cannot
 * be split later without losing every transcript.
 *
 * **Shape.** Transcripts are stored as ordered `{role, content, at}` records
 * rather than as rendered text, so a later session-based console can *continue* a
 * transcript rather than discard it. Rendered text is a one-way door.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCache } from '@main/cache/index';
import { createConversationStore } from '@main/cache/conversations';
import type { Message } from '@core/model/observed';

let userData: string;
let cacheRoot: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'sdlc-console-'));
  cacheRoot = createCache(userData).root;
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

function said(role: Message['role'], content: string, at = '2026-09-11T10:00:00.000Z'): Message {
  return { role, content, at };
}

describe('scoping — one conversation per state per item (FR-029)', () => {
  it('keeps two states of the same item separate', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('P-1', 'intake', said('user', 'why is this here?'));
    await store.append('P-1', 'dispatch', said('user', 'and why is this here?'));

    expect((await store.read('P-1', 'intake')).map((message) => message.content)).toEqual(['why is this here?']);
    expect((await store.read('P-1', 'dispatch')).map((message) => message.content)).toEqual(['and why is this here?']);
  });

  it('keeps the same state of two different items separate', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('P-1', 'intake', said('user', 'about the first'));
    await store.append('P-2', 'intake', said('user', 'about the second'));

    expect((await store.read('P-1', 'intake'))[0]?.content).toBe('about the first');
    expect((await store.read('P-2', 'intake'))[0]?.content).toBe('about the second');
  });

  it('returns an empty transcript for a state never discussed, rather than failing', async () => {
    expect(await createConversationStore(cacheRoot).read('P-9', 'intake')).toEqual([]);
  });

  it('reports the scope it stored under, so nothing has to infer the key', async () => {
    const store = createConversationStore(cacheRoot);
    const conversation = await store.append('P-1', 'intake', said('user', 'hello'));
    expect(conversation.itemKey).toBe('P-1');
    expect(conversation.stateId).toBe('intake');
  });
});

describe('persistence — returning to a tab restores the prior conversation (FR-028)', () => {
  it('restores a transcript from a fresh store, as a restart would', async () => {
    const first = createConversationStore(cacheRoot);
    await first.append('P-1', 'intake', said('user', 'what did this gate check?'));
    await first.append('P-1', 'intake', said('assistant', 'it read a recorded value.'));

    // A new store over the same directory stands in for reopening the app.
    const reopened = createConversationStore(cacheRoot);
    expect((await reopened.read('P-1', 'intake')).map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('preserves order across many turns', async () => {
    const store = createConversationStore(cacheRoot);
    for (let turn = 0; turn < 12; turn += 1) {
      await store.append('P-1', 'intake', said(turn % 2 === 0 ? 'user' : 'assistant', `turn ${turn}`));
    }
    expect((await store.read('P-1', 'intake')).map((message) => message.content)).toEqual(
      Array.from({ length: 12 }, (_, turn) => `turn ${turn}`),
    );
  });

  it('returns the whole conversation from append, so a caller needs no second read', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('P-1', 'intake', said('user', 'first'));
    const conversation = await store.append('P-1', 'intake', said('assistant', 'second'));
    expect(conversation.messages.map((message) => message.content)).toEqual(['first', 'second']);
  });
});

describe('shape — ordered records, not rendered text (spec §Planned Direction)', () => {
  it('preserves role, content, and timestamp on every message', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('P-1', 'intake', said('user', 'why?', '2026-09-11T11:22:33.000Z'));

    const [message] = await store.read('P-1', 'intake');
    expect(message).toEqual({ role: 'user', content: 'why?', at: '2026-09-11T11:22:33.000Z' });
  });

  it('keeps all three roles distinguishable', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('P-1', 'intake', said('system', 'context assembled'));
    await store.append('P-1', 'intake', said('user', 'why?'));
    await store.append('P-1', 'intake', said('assistant', 'because.'));

    expect((await store.read('P-1', 'intake')).map((message) => message.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('round-trips content that would not survive being rendered', async () => {
    // Markdown, angle brackets, and newlines must come back byte-identical: the
    // store holds records, not HTML.
    const store = createConversationStore(cacheRoot);
    const awkward = '# Heading\n\n<script>alert(1)</script>\n\n- item "quoted" & \\escaped\\\n';
    await store.append('P-1', 'intake', said('assistant', awkward));
    expect((await store.read('P-1', 'intake'))[0]?.content).toBe(awkward);
  });
});

describe('keys are untrusted provider output', () => {
  it('stores an item key containing path separators without escaping the cache', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('../../escape', 'intake', said('user', 'hello'));
    expect((await store.read('../../escape', 'intake'))[0]?.content).toBe('hello');
  });

  it('stores a state id containing path separators', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('P-1', '../../escape', said('user', 'hello'));
    expect((await store.read('P-1', '../../escape'))[0]?.content).toBe('hello');
  });

  it('does not confuse two keys that differ only after encoding', async () => {
    const store = createConversationStore(cacheRoot);
    await store.append('a/b', 'intake', said('user', 'first'));
    await store.append('a-b', 'intake', said('user', 'second'));
    expect((await store.read('a/b', 'intake'))[0]?.content).toBe('first');
    expect((await store.read('a-b', 'intake'))[0]?.content).toBe('second');
  });
});
