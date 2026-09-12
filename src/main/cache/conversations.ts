/**
 * T112 — console transcript persistence (FR-028, FR-029).
 *
 * One file per (item, state) pair:
 *
 *   <cacheRoot>/conversations/<itemKey>/<stateId>.json
 *
 * The path *is* the scoping rule. Two states of one item, and two items in one
 * state, cannot reach each other's transcript because they cannot name each other's
 * file (FR-029). Both segments are percent-encoded, since an item key is provider
 * output and may carry separators or `..` (Principle IX).
 *
 * Messages are stored as ordered `{role, content, at}` records rather than rendered
 * text, so a future session-based console can continue a transcript instead of
 * discarding it (data-model.md §Conversation, spec §Planned Direction).
 *
 * A transcript is cache, not a system of record: a missing file is an empty
 * conversation, and a damaged one is discarded rather than half-parsed.
 */

import path from 'node:path';

import type { Conversation, Message, MessageRole } from '@core/model/observed.js';

import { encodeSegment, parseJsonOrNull, readTextOrNull, writeFileAtomic } from './index.js';

export interface ConversationStore {
  read(itemKey: string, stateId: string): Promise<Message[]>;
  append(itemKey: string, stateId: string, message: Message): Promise<Conversation>;
}

export function createConversationStore(cacheRoot: string): ConversationStore {
  const conversationsDir = path.join(cacheRoot, 'conversations');

  const transcriptFile = (itemKey: string, stateId: string): string =>
    path.join(conversationsDir, encodeSegment(itemKey), `${encodeSegment(stateId)}.json`);

  const readMessages = async (itemKey: string, stateId: string): Promise<Message[]> => {
    const raw = await readTextOrNull(transcriptFile(itemKey, stateId));
    if (raw === null) return [];
    const parsed = parseJsonOrNull(raw);
    const messages = extractMessages(parsed);
    return messages.filter(isMessage).map(snapshotMessage);
  };

  return {
    async read(itemKey: string, stateId: string): Promise<Message[]> {
      return readMessages(itemKey, stateId);
    },

    async append(itemKey: string, stateId: string, message: Message): Promise<Conversation> {
      const messages = await readMessages(itemKey, stateId);
      messages.push(snapshotMessage(message));
      // The stored file carries its own scope, so a transcript recovered from disk
      // still knows which item and state it belongs to even if the encoded path is
      // unreadable to a human.
      const conversation: Conversation = { itemKey, stateId, messages };
      await writeFileAtomic(
        transcriptFile(itemKey, stateId),
        JSON.stringify(conversation, null, 2),
      );
      return conversation;
    },
  };
}

const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system'];

/**
 * Accepts either the stored `Conversation` object or a bare array of messages, so a
 * transcript written by an earlier shape still reads. Anything else is an empty
 * conversation rather than an error.
 */
function extractMessages(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null) {
    const messages = (parsed as { messages?: unknown }).messages;
    if (Array.isArray(messages)) return messages;
  }
  return [];
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as { role?: unknown; content?: unknown; at?: unknown };
  return (
    MESSAGE_ROLES.some((role) => role === candidate.role) &&
    typeof candidate.content === 'string' &&
    typeof candidate.at === 'string'
  );
}

/** Copies the three fields the model declares, dropping anything a caller bolted on. */
function snapshotMessage(message: Message): Message {
  return { role: message.role, content: message.content, at: message.at };
}
