/**
 * T030 — Zod schemas for every GitHub response this adapter reads.
 *
 * Principle IX: the network is the boundary. A check-run payload, an issue body,
 * and a file's contents are all untrusted producer output, and none of them
 * leaves this provider unparsed. A field GitHub renames becomes a typed
 * `invalid_response` naming the path that moved, not an exception in the engine
 * (provider-interface.md rule 3).
 *
 * Each schema below corresponds to one endpoint response, and is the shape a
 * recorded fixture must satisfy:
 *
 *   GET /repos/{owner}/{repo}                             -> githubRepositorySchema
 *   GET /search/issues?q=...                              -> githubSearchIssuesSchema
 *   GET /repos/{owner}/{repo}/issues/{number}             -> githubIssueSchema
 *   GET /repos/{owner}/{repo}/issues/{number}/comments    -> githubIssueCommentsSchema
 *   GET /repos/{owner}/{repo}/contents/{path}?ref=...     -> githubContentsSchema
 *   GET /repos/{owner}/{repo}/commits/{ref}/check-runs    -> githubCheckRunsResponseSchema
 *   any non-2xx body                                      -> githubErrorSchema
 */

import { z } from 'zod';
import { fail, ok } from '@core/model/result.js';
import type { Result } from '@core/model/result.js';

export const githubUserSchema = z.object({
  login: z.string(),
  id: z.number().optional(),
  html_url: z.string().optional(),
});

/** A label is a string in search payloads and an object on an issue. */
export const githubLabelSchema = z.union([
  z.string(),
  z.object({ name: z.string().optional(), description: z.string().nullish() }),
]);

/**
 * `.passthrough()` keeps the fields a `kind: field` gate may name — a manifest
 * can point at any issue property — while still typing them `unknown`, so
 * nothing can be used without narrowing.
 */
export const githubIssueSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullish(),
    // GitHub's own word for the issue's status. Mapping it to a declared state is
    // the engine's job (provider-interface.md rule 2).
    state: z.string(),
    state_reason: z.string().nullish(),
    html_url: z.string(),
    url: z.string().optional(),
    user: githubUserSchema.nullish(),
    assignee: githubUserSchema.nullish(),
    assignees: z.array(githubUserSchema).optional(),
    labels: z.array(githubLabelSchema).optional(),
    comments: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    closed_at: z.string().nullish(),
    pull_request: z.object({ html_url: z.string().nullish() }).optional(),
  })
  .passthrough();

export const githubIssueCommentSchema = z.object({
  id: z.number().optional(),
  body: z.string().nullish(),
  user: githubUserSchema.nullish(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  html_url: z.string().optional(),
});

export const githubIssueCommentsSchema = z.array(githubIssueCommentSchema);

export const githubSearchIssuesSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean().optional(),
  items: z.array(githubIssueSchema),
});

export const githubCheckRunOutputSchema = z.object({
  title: z.string().nullish(),
  summary: z.string().nullish(),
  text: z.string().nullish(),
  annotations_count: z.number().optional(),
});

export const githubCheckRunSchema = z.object({
  id: z.number(),
  name: z.string(),
  /** queued | in_progress | completed — GitHub's vocabulary, reported as found. */
  status: z.string(),
  conclusion: z.string().nullish(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  html_url: z.string().nullish(),
  details_url: z.string().nullish(),
  output: githubCheckRunOutputSchema.nullish(),
});

export const githubCheckRunsResponseSchema = z.object({
  total_count: z.number(),
  check_runs: z.array(githubCheckRunSchema),
});

export const githubContentFileSchema = z.object({
  type: z.string(),
  name: z.string(),
  path: z.string(),
  sha: z.string().optional(),
  size: z.number().optional(),
  /** `base64` for files the contents API can inline; `none` above its 1 MB limit. */
  encoding: z.string().optional(),
  content: z.string().optional(),
  html_url: z.string().nullish(),
  download_url: z.string().nullish(),
});

export const githubDirectoryEntrySchema = z.object({
  type: z.string(),
  name: z.string(),
  path: z.string(),
  sha: z.string().optional(),
  size: z.number().optional(),
});

/** The contents endpoint answers with an object for a file and an array for a directory. */
export const githubContentsSchema = z.union([
  githubContentFileSchema,
  z.array(githubDirectoryEntrySchema),
]);

export const githubRepositorySchema = z.object({
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string().optional(),
  private: z.boolean().optional(),
  archived: z.boolean().optional(),
  html_url: z.string().optional(),
});

export const githubErrorSchema = z.object({
  message: z.string().optional(),
  documentation_url: z.string().optional(),
  errors: z
    .array(
      z.object({
        resource: z.string().optional(),
        field: z.string().optional(),
        code: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

export type GithubUser = z.infer<typeof githubUserSchema>;
export type GithubIssue = z.infer<typeof githubIssueSchema>;
export type GithubIssueComment = z.infer<typeof githubIssueCommentSchema>;
export type GithubSearchIssues = z.infer<typeof githubSearchIssuesSchema>;
export type GithubCheckRun = z.infer<typeof githubCheckRunSchema>;
export type GithubCheckRunsResponse = z.infer<typeof githubCheckRunsResponseSchema>;
export type GithubContentFile = z.infer<typeof githubContentFileSchema>;
export type GithubContents = z.infer<typeof githubContentsSchema>;
export type GithubRepository = z.infer<typeof githubRepositorySchema>;
export type GithubError = z.infer<typeof githubErrorSchema>;

/**
 * Parses one decoded response body, turning a shape change into a typed failure
 * that names the field that moved (Principle V: actionable, not merely correct).
 */
export function parseGithub<T>(schema: z.ZodType<T>, data: unknown, what: string): Result<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  const path = issue !== undefined && issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const detail = issue?.message ?? 'the response did not match the expected shape';
  return fail(
    'invalid_response',
    `GitHub's ${what} response did not match the shape this adapter expects: ${path} — ${detail}. ` +
      'The API may have changed; the response was discarded rather than guessed at.',
    { field: path },
  );
}

export function githubLabelNames(labels: readonly z.infer<typeof githubLabelSchema>[]): string[] {
  const names: string[] = [];
  for (const label of labels) {
    if (typeof label === 'string') {
      names.push(label);
      continue;
    }
    if (typeof label.name === 'string') names.push(label.name);
  }
  return names;
}
