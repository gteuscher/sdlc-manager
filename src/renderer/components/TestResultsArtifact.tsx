/**
 * T091 — an automated test run, with passing distinguishable from failing
 * (FR-017, Story 3 acceptance 3).
 *
 * The content arrives as JSON text shaped like `TestRunSummary`. It is producer
 * output, so it is parsed here at the boundary rather than trusted: Principle IX
 * says treat every external producer as untrusted and validate before use, and
 * the practical consequence is that a malformed body must be a **rendered
 * failure with the reason**, never a thrown exception that takes the state tab
 * down with it (FR-019, Principle X).
 *
 * The run outcome carries the distinction that matters, and it carries it three
 * ways — word, drawn shape, colour — for the same reason every other status in
 * this application does (Principle XI). Per-case statuses are a free-form string
 * the producer chose, so they are reproduced exactly as recorded rather than
 * classified into this application's vocabulary; guessing which producer words
 * mean "green" is exactly the inference Principle II forbids.
 *
 * A run with thousands of cases is one of the two large artifacts the spec's edge
 * cases name. Only a bounded window of cases is rendered, with the remainder
 * counted rather than dropped silently (FR-021).
 */

import type { ReactElement } from 'react';
import { z } from 'zod';

export interface TestResultsArtifactProps {
  /** Raw JSON text as the provider supplied it. Never assumed to be well-formed. */
  readonly content: string;
}

/** How many case rows are rendered before the rest are counted instead (FR-021). */
export const MAX_RENDERED_CASES = 100;

/**
 * Tolerant on purpose. A producer that omits a count or adds a field of its own
 * should still render: the run outcome is the thing FR-017 requires, and
 * rejecting the whole document over a missing `skipped` would report a failure
 * the engineer cannot act on.
 */
const runSchema = z.object({
  outcome: z.enum(['passed', 'failed', 'unknown']).catch('unknown'),
  total: z.number().int().nonnegative().catch(0),
  passed: z.number().int().nonnegative().catch(0),
  failed: z.number().int().nonnegative().catch(0),
  skipped: z.number().int().nonnegative().catch(0),
  cases: z
    .array(
      z.object({
        name: z.string().catch(''),
        status: z.string().catch(''),
        detail: z.string().optional(),
      }),
    )
    .catch([]),
  truncated: z.boolean().catch(false),
});

type Run = z.infer<typeof runSchema>;

type Parsed = { readonly ok: true; readonly run: Run } | { readonly ok: false; readonly why: string };

function parseRun(text: string): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      why: 'The provider returned content that is not valid JSON, so the run could not be read.',
    };
  }

  const result = runSchema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first === undefined ? 'the document' : (first.path.join('.') || 'the document');
    return {
      ok: false,
      why: `The provider returned JSON that is not a test run summary. The problem is at ${field}.`,
    };
  }

  return { ok: true, run: result.data };
}

function outcomeMark(outcome: Run['outcome']): ReactElement {
  switch (outcome) {
    case 'passed':
      return (
        <svg
          className="run__mark"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M4.4 8.3 6.9 10.8 11.7 5.6"
            fill="none"
            stroke="var(--bg-raised)"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'failed':
      return (
        <svg
          className="run__mark"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="1.2" y="1.2" width="13.6" height="13.6" rx="2" fill="currentColor" />
          <path
            d="M5.2 5.2 10.8 10.8M10.8 5.2 5.2 10.8"
            fill="none"
            stroke="var(--bg-raised)"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'unknown':
      return (
        <svg
          className="run__mark"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <circle
            cx="8"
            cy="8"
            r="6.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="2.6 2.4"
          />
          <text x="8" y="11.4" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">
            ?
          </text>
        </svg>
      );
  }
}

const OUTCOME_LABELS: Readonly<Record<Run['outcome'], string>> = {
  passed: 'All tests passed',
  failed: 'Tests failed',
  unknown: 'Outcome not recorded',
};

export function TestResultsArtifact({ content }: TestResultsArtifactProps): ReactElement {
  const parsed = parseRun(content);

  if (!parsed.ok) {
    // In place, naming what failed, while the rest of the state still renders
    // (FR-019). Not a thrown error, and not a blank panel.
    return (
      <div className="run run--unreadable" role="alert">
        <p className="run__problem">{parsed.why}</p>
        <p className="run__hint">
          The result is reproduced below exactly as it was received, as text, so you can see what
          the provider actually sent.
        </p>
        <pre className="run__raw">{content.slice(0, 2000)}</pre>
      </div>
    );
  }

  const run = parsed.run;
  const shown = run.cases.slice(0, MAX_RENDERED_CASES);
  const withheld = run.cases.length - shown.length;

  return (
    <div className={`run run--${run.outcome}`}>
      <p className="run__outcome">
        {outcomeMark(run.outcome)}
        <span className="run__outcome-label">{OUTCOME_LABELS[run.outcome]}</span>
      </p>

      <p className="run__counts">
        <span className="run__count">
          <span className="run__count-number">{run.total}</span> in total
        </span>
        <span className="run__count">
          <span className="run__count-number">{run.passed}</span> passing
        </span>
        <span className="run__count">
          <span className="run__count-number">{run.failed}</span> failing
        </span>
        <span className="run__count">
          <span className="run__count-number">{run.skipped}</span> skipped
        </span>
      </p>

      {run.truncated ? (
        <p className="run__note">
          The provider truncated this run before sending it, so the cases below are a portion of
          what it recorded.
        </p>
      ) : null}

      {run.cases.length === 0 ? (
        <p className="run__note">
          This run recorded no individual cases — only the totals above.
        </p>
      ) : (
        <>
          <ul className="run__cases">
            {shown.map((testCase, index) => (
              <li className="run__case" key={`${testCase.name}-${index}`}>
                {/* Reproduced as the producer recorded it, not reclassified. */}
                <span className="run__case-status">{testCase.status}</span>
                <span className="run__case-name">{testCase.name}</span>
                {testCase.detail === undefined ? null : (
                  <span className="run__case-detail">{testCase.detail}</span>
                )}
              </li>
            ))}
          </ul>
          {withheld > 0 ? (
            <p className="run__note">
              {withheld} further {withheld === 1 ? 'case is' : 'cases are'} recorded in this run and
              are not listed here, so that a very large run does not make this view unusable. The
              totals above count every one of them.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
