/**
 * T030 — Zod schemas for every Jira response this adapter reads.
 *
 * Principle IX: the network is the boundary. Nothing leaves this provider that
 * has not been parsed here first, so a field Atlassian renames becomes a typed
 * `invalid_response` failure naming the path that moved, rather than an
 * exception three layers up inside the engine (provider-interface.md rule 3).
 *
 * Each schema below corresponds to one endpoint response, and is the shape a
 * recorded fixture must satisfy:
 *
 *   GET {baseUrl}/rest/api/3/myself                  -> jiraMyselfSchema
 *   GET {baseUrl}/rest/api/3/search/jql              -> jiraSearchResponseSchema
 *   GET {baseUrl}/rest/api/3/issue/{key}?fields=...  -> jiraIssueSchema
 *                                                       jiraStatusIssueSchema
 *                                                       jiraFieldIssueSchema
 *   GET {baseUrl}/rest/api/3/issue/{key}/comment     -> jiraCommentsResponseSchema
 *   any non-2xx body                                 -> jiraErrorResponseSchema
 */

import { z } from 'zod';
import { fail, ok } from '@core/model/result.js';
import type { Result } from '@core/model/result.js';

/** Atlassian Document Format: the shape a v3 `description` or comment body arrives in. */
export interface AdfNode {
  readonly type?: string;
  readonly text?: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly AdfNode[];
}

export const adfNodeSchema: z.ZodType<AdfNode> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    attrs: z.record(z.unknown()).optional(),
    content: z.array(adfNodeSchema).optional(),
  }),
);

/** A rich-text field is a plain string on older sites and an ADF document on Jira Cloud v3. */
export const jiraDocumentSchema = z.union([z.string(), adfNodeSchema, z.null()]);

export const jiraUserSchema = z.object({
  accountId: z.string().optional(),
  displayName: z.string().optional(),
  emailAddress: z.string().optional(),
});

export const jiraStatusSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  statusCategory: z
    .object({ id: z.number().optional(), key: z.string().optional(), name: z.string().optional() })
    .optional(),
});

/**
 * `.passthrough()` is deliberate: a Jira site's custom fields are unknown at
 * compile time and must survive the parse so a `kind: field` gate can read one.
 * Unknown keys arrive typed `unknown`, so nothing can be used without narrowing.
 */
export const jiraIssueFieldsSchema = z
  .object({
    summary: z.string().nullish(),
    status: jiraStatusSchema.optional(),
    assignee: jiraUserSchema.nullish(),
    reporter: jiraUserSchema.nullish(),
    description: jiraDocumentSchema.optional(),
    updated: z.string().optional(),
  })
  .passthrough();

export const jiraIssueSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  self: z.string().optional(),
  fields: jiraIssueFieldsSchema,
});

export const jiraSearchResponseSchema = z.object({
  issues: z.array(jiraIssueSchema),
  // Present on the legacy /search endpoint.
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  total: z.number().optional(),
  // Present on /search/jql, which pages by token rather than by offset.
  nextPageToken: z.string().optional(),
  isLast: z.boolean().optional(),
});

/** The narrow read behind `readState`: a status is required, so its absence is a typed failure. */
export const jiraStatusIssueSchema = z.object({
  key: z.string(),
  fields: z.object({ status: jiraStatusSchema }),
});

/** The narrow read behind `kind: field` gates: any requested field, still validated as an object. */
export const jiraFieldIssueSchema = z.object({
  key: z.string(),
  fields: z.record(z.unknown()),
});

export const jiraCommentSchema = z.object({
  id: z.string().optional(),
  author: jiraUserSchema.nullish(),
  created: z.string().optional(),
  updated: z.string().optional(),
  body: jiraDocumentSchema.optional(),
});

export const jiraCommentsResponseSchema = z.object({
  comments: z.array(jiraCommentSchema),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  total: z.number().optional(),
});

export const jiraMyselfSchema = z.object({
  accountId: z.string(),
  displayName: z.string().optional(),
  emailAddress: z.string().optional(),
  active: z.boolean().optional(),
});

export const jiraErrorResponseSchema = z.object({
  errorMessages: z.array(z.string()).optional(),
  errors: z.record(z.string()).optional(),
  message: z.string().optional(),
});

export type JiraUser = z.infer<typeof jiraUserSchema>;
export type JiraStatus = z.infer<typeof jiraStatusSchema>;
export type JiraIssue = z.infer<typeof jiraIssueSchema>;
export type JiraSearchResponse = z.infer<typeof jiraSearchResponseSchema>;
export type JiraStatusIssue = z.infer<typeof jiraStatusIssueSchema>;
export type JiraFieldIssue = z.infer<typeof jiraFieldIssueSchema>;
export type JiraComment = z.infer<typeof jiraCommentSchema>;
export type JiraCommentsResponse = z.infer<typeof jiraCommentsResponseSchema>;
export type JiraMyself = z.infer<typeof jiraMyselfSchema>;
export type JiraErrorResponse = z.infer<typeof jiraErrorResponseSchema>;

/**
 * Parses one decoded response body, turning a shape change into a typed failure
 * that names the field that moved (Principle V: actionable, not merely correct).
 */
export function parseJira<T>(schema: z.ZodType<T>, data: unknown, what: string): Result<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  const path = issue !== undefined && issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const detail = issue?.message ?? 'the response did not match the expected shape';
  return fail(
    'invalid_response',
    `Jira's ${what} response did not match the shape this adapter expects: ${path} — ${detail}. ` +
      'The API may have changed; the response was discarded rather than guessed at.',
    { field: path },
  );
}

/** ADF block nodes, after which a paragraph break belongs. Not lifecycle vocabulary. */
const ADF_BLOCK_TYPES: readonly string[] = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'decisionItem',
  'panel',
  'rule',
  'mediaSingle',
  'mediaGroup',
  'tableRow',
];

/**
 * Flattens a rich-text field to inert plain text.
 *
 * Jira's alternative is `expand=renderedFields`, which returns HTML — forbidden
 * across the IPC surface (ipc-surface.md rule 6). Flattening here means the
 * renderer never receives markup it would have to sanitise.
 */
export function jiraDocumentToText(document: unknown): string {
  if (document === null || document === undefined) return '';
  if (typeof document === 'string') return document.trim();
  const parsed = adfNodeSchema.safeParse(document);
  if (!parsed.success) return '';
  return collapseBlankLines(adfNodeToText(parsed.data)).trim();
}

function adfNodeToText(node: AdfNode): string {
  const pieces: string[] = [];
  if (typeof node.text === 'string') pieces.push(node.text);

  const attrs = node.attrs;
  if (attrs !== undefined && node.type === 'mention' && typeof attrs['text'] === 'string') {
    pieces.push(attrs['text']);
  }
  if (attrs !== undefined && node.type === 'inlineCard' && typeof attrs['url'] === 'string') {
    pieces.push(attrs['url']);
  }
  if (node.type === 'hardBreak') pieces.push('\n');

  if (node.content !== undefined) {
    for (const child of node.content) {
      pieces.push(adfNodeToText(child));
    }
  }

  const text = pieces.join('');
  if (node.type !== undefined && ADF_BLOCK_TYPES.includes(node.type)) return `${text}\n\n`;
  return text;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/** Shapes a select, user, or option field arrives in when it is not a bare scalar. */
const jiraFieldObjectSchema = z
  .object({
    value: z.string().optional(),
    name: z.string().optional(),
    displayName: z.string().optional(),
    key: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();

/**
 * Normalises one Jira field value to something a manifest condition can be
 * compared against. It stays a raw provider value — no state is named here and
 * none is inferred (provider-interface.md rule 2).
 */
export function jiraFieldToValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => jiraFieldToValue(entry));
  const parsed = jiraFieldObjectSchema.safeParse(value);
  if (parsed.success) {
    const object = parsed.data;
    const scalar = object.value ?? object.name ?? object.displayName ?? object.key;
    if (typeof scalar === 'string') return scalar;
  }
  return value;
}
