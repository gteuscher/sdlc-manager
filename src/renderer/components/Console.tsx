/**
 * T114, T116 — User Story 5: the advisory console, docked inside one state tab.
 *
 * Five things in here are requirements rather than preferences.
 *
 * **Scope is the pair (item, state), and it is the whole design (FR-027,
 * FR-029).** Both halves arrive as props and both go into every call and every
 * cache key. There is no console-level store, no context, and no shared list of
 * transcripts to key incorrectly — two states of one item cannot reach each
 * other's conversation because neither can name the other's key. A reply
 * therefore appears in the console that asked for it and nowhere else.
 *
 * **The transcript is server state, not a store (Principle XIII, FR-028).** It
 * lives in the query cache under that same pair, which is what makes returning
 * to a tab restore the prior conversation: `StateTabs` unmounts the panel that
 * is not selected, so this component is unmounted and remounted on every tab
 * change, and the cached transcript is rendered again immediately while it
 * revalidates. Nothing is held in this component that would be lost — except the
 * draft, which is form state and is local on purpose.
 *
 * **Unavailable is the default, not an edge case (T116, FR-030).** The
 * application ships with no assistant configured, so the ordinary first run is
 * the one where the console cannot answer. Principle I is what decides how that
 * is shown: where a loaded workflow depends on a provider the engineer has not
 * configured, the interface must present an actionable prompt *naming the
 * missing provider* — never a blank screen and never a silent empty state. A
 * console that looks ready, takes a question, and only then admits it cannot
 * answer is that silent empty state, so the console asks `consoleAvailable`
 * when the tab opens and says so before anything is typed.
 *
 * Two things follow. The composer is **not rendered** when the console is known
 * unavailable — an input that will not work is a dead control, and FR-034a's
 * discipline says to name where the thing is configured instead. And the
 * reply-driven path stays: an assistant that is healthy at the probe and fails
 * at the question still reports in place, because the probe is an addition
 * rather than a replacement.
 *
 * Either way the rest of the state tab — its artifacts, its gates, their results
 * — has already rendered from data that had nothing to do with the console, and
 * every failure here carries a way to try again (Principle X).
 *
 * **It is advisory, and the interface must not imply otherwise (FR-031a).**
 * There is exactly one control here beyond the composer — a retry — and nothing
 * on screen suggests the console can move an item, decide a gate, or touch a
 * system of record. The standing note says so in words, because the main
 * process's structural enforcement is invisible from here and an engineer should
 * not have to discover the limit by hitting it.
 *
 * **Message content is rendered as plain text.** `react-markdown` is lazily
 * loaded into `ItemDetail`'s markdown chunk and must stay there (Principle XII);
 * pulling it into a component that is mounted with every state tab would move it
 * into the initial bundle. Text in a `pre-wrap` block is also the honest
 * rendering for a reply whose author is a language model.
 *
 * No state, gate, or provider name appears in this file. Everything an engineer
 * reads about a particular state came in as a prop from the loaded definition
 * (Principle II).
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import type { Message, MessageRole, ProviderHealthStatus } from '@core/model/observed';

import { REQUEST_CEILING_MS } from '../query/client';
import { useAskConsole, useConsoleAvailability, useConversation } from '../query/hooks';

export interface ConsoleProps {
  /** The item this console is scoped to. Half of FR-029's key. */
  readonly itemKey: string;
  /** The state this console is scoped to. The other half. */
  readonly stateId: string;
  /** That state's own name, from the loaded definition. Used only to name this console. */
  readonly stateName: string;
}

/**
 * Who said what. Three words, because a transcript in which the engineer cannot
 * tell their own question from the answer is not a transcript.
 */
const SPEAKER: Readonly<Record<MessageRole, string>> = {
  user: 'You',
  assistant: 'Console',
  system: 'Note',
};

/** FR-031a, said out loud. The limit is structural in the main process and invisible from here. */
const ADVISORY_NOTE =
  'This console is advisory. It answers questions about this state — what it declares, what was ' +
  'recorded against it, and why — and changes nothing: not this item, not your repositories, not ' +
  'their contents, and not this application’s configuration. Ask it to change something and it ' +
  'answers with where that change is made.';

/**
 * Which health statuses are the console describing itself, and which are
 * something going wrong.
 *
 * Nothing configured is the shipped default and a kind of readiness report, not
 * a fault; a rejected credential or an unreachable host is a fault. They are
 * announced differently, worded differently, and coloured differently, in that
 * order of importance (Principle XI — colour is never the only signal).
 */
function toneFor(status: ProviderHealthStatus): 'reported' | 'failed' {
  return status === 'not_configured' || status === 'unsupported' ? 'reported' : 'failed';
}

/** Recorded timestamps are validated as strings, not as dates. An unparseable one shows as recorded. */
function formatTimestamp(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

/**
 * Principle X's ceiling: a wait that is bounded by a remote service shows a
 * pending state promptly and becomes a rendered failure after ten seconds.
 */
function useCeiling(pending: boolean): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), REQUEST_CEILING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending]);
  return timedOut;
}

interface ConsoleProblemProps {
  /**
   * `reported` is the console saying what it is — the shipped-unconfigured case,
   * which is information rather than breakage. `failed` is something that went
   * wrong. They are announced differently on purpose: the first run of this
   * application must not fire an alert at an engineer who has done nothing wrong.
   */
  readonly tone: 'reported' | 'failed';
  readonly title: string;
  readonly message: string;
  readonly onRetry: () => void;
  readonly retryLabel: string;
  readonly busy: boolean;
}

function ConsoleProblem({
  tone,
  title,
  message,
  onRetry,
  retryLabel,
  busy,
}: ConsoleProblemProps): ReactElement {
  return (
    <div
      className={`console__problem console__problem--${tone}`}
      role={tone === 'failed' ? 'alert' : 'status'}
    >
      <p className="console__problem-title">{title}</p>
      {/* The typed failure already names what failed and what to do about it
          (ipc-surface.md rule 5, Principle V), so it is passed through rather
          than restated in this application's own words. */}
      <p className="console__problem-message">{message}</p>
      <p className="console__problem-retry">
        <button className="button button--small" type="button" onClick={onRetry} disabled={busy}>
          {busy ? 'Trying…' : retryLabel}
        </button>
      </p>
    </div>
  );
}

export function Console({ itemKey, stateId, stateName }: ConsoleProps): ReactElement {
  const base = useId();
  const headingId = `${base}-heading`;
  const inputId = `${base}-input`;

  const availability = useConsoleAvailability();
  const conversation = useConversation(itemKey, stateId);
  const ask = useAskConsole(itemKey, stateId);

  // Form state is local (Principle XIII). It is deliberately not restored across
  // a tab change: an unsent half-question is not something to resurrect.
  const [draft, setDraft] = useState('');
  // What was actually sent, so a retry resends the question rather than whatever
  // the box happens to contain by then.
  const [asked, setAsked] = useState<string | null>(null);

  const probeTimedOut = useCeiling(availability.isPending);
  const transcriptTimedOut = useCeiling(conversation.isPending);
  const replyTimedOut = useCeiling(ask.isPending);

  const health = availability.data;
  /** The probe answered, and the answer was not "ready". Nothing may be asked. */
  const blocked = health !== undefined && health.status !== 'ok';
  /** Still asking. A composer shown here would be offering something unproven. */
  const probing = availability.isPending && !probeTimedOut;
  /**
   * The probe itself failed. The console is *not* known to be unavailable, so the
   * reply-driven path is left open rather than the engineer being locked out on
   * the strength of a check that did not complete.
   */
  const probeFailed = (availability.isPending && probeTimedOut) || availability.isError;

  const send = useCallback(
    (question: string) => {
      setAsked(question);
      // Clears a previous failure so the panel below reflects this attempt, and
      // releases the observer from a call that has already blown its ceiling.
      ask.reset();
      ask.mutate(question, {
        onSuccess: (result) => {
          // Only a real answer empties the box. A console that is not configured
          // must not also lose the question the engineer typed into it.
          if (result.ok) setDraft('');
        },
      });
    },
    [ask],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const question = draft.trim();
    if (question === '') return;
    send(question);
  };

  const retry = useCallback(() => {
    if (asked === null) return;
    send(asked);
  }, [asked, send]);

  const messages: readonly Message[] = conversation.data ?? [];

  return (
    <section className="panel__section console" aria-labelledby={headingId}>
      <h3 className="panel__section-title" id={headingId}>
        Console
      </h3>

      <p className="console__posture">{ADVISORY_NOTE}</p>

      {/* The transcript is a labelled live region, so an answer arriving into it
          is announced without stealing focus from the box the engineer is
          still typing in (Principle XI). */}
      <div
        className="console__transcript"
        role="log"
        aria-live="polite"
        aria-label={`Conversation about ${stateName}`}
      >
        {conversation.isPending && !transcriptTimedOut ? (
          <p className="pending" role="status">
            Restoring this conversation&hellip;
          </p>
        ) : messages.length === 0 ? (
          // Principle X's deliberate nothing: copy, never a blank area.
          <p className="console__empty">
            Nothing has been asked about {stateName} yet. What you ask here belongs to this state of
            this item alone, and is restored when you come back to this tab.
          </p>
        ) : (
          <ol className="console__messages">
            {messages.map((message, index) => (
              <li
                className={`console__message console__message--${message.role}`}
                key={`${message.at}-${index}`}
              >
                <p className="console__speaker">
                  <span className="console__who">{SPEAKER[message.role]}</span>
                  <time className="console__at" dateTime={message.at}>
                    {formatTimestamp(message.at)}
                  </time>
                </p>
                {/* Plain text, in a pre-wrap block. See the note at the head of
                    this file on why the markdown parser stays out of here. */}
                <p className="console__content">{message.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {conversation.isPending && transcriptTimedOut ? (
        <ConsoleProblem
          tone="failed"
          title="This conversation has not been restored"
          message="The stored transcript for this state has not been read within ten seconds. Anything already said is still on disk, and nothing has been lost."
          onRetry={() => void conversation.refetch()}
          retryLabel="Try again"
          busy={conversation.isFetching}
        />
      ) : conversation.isError ? (
        <ConsoleProblem
          tone="failed"
          title="This conversation could not be restored"
          message={
            conversation.error instanceof Error
              ? conversation.error.message
              : 'The stored transcript for this state could not be read, and no reason was recorded.'
          }
          onRetry={() => void conversation.refetch()}
          retryLabel="Try again"
          busy={conversation.isFetching}
        />
      ) : null}

      {ask.isPending && !replyTimedOut ? (
        <p className="pending" role="status">
          Waiting for an answer about {stateName}&hellip;
        </p>
      ) : null}

      {ask.isPending && replyTimedOut ? (
        <ConsoleProblem
          tone="failed"
          title="The console has not answered"
          message="No answer has arrived within ten seconds. Everything else in this state is unaffected, and your question is still in the box below."
          onRetry={retry}
          retryLabel="Ask again"
          busy={false}
        />
      ) : null}

      {!ask.isPending && ask.isError ? (
        <ConsoleProblem
          tone="failed"
          title="The console could not be reached"
          message={
            ask.error instanceof Error
              ? ask.error.message
              : 'The question could not be put to the console, and no reason was recorded.'
          }
          onRetry={retry}
          retryLabel="Ask again"
          busy={false}
        />
      ) : null}

      {/* T116, FR-030. Everything above and everything outside this console has
          already rendered; this is the console, and only the console, saying why
          it cannot answer. */}
      {!ask.isPending && ask.data !== undefined && !ask.data.ok ? (
        <ConsoleProblem
          tone={
            ask.data.reason === 'unavailable' || ask.data.reason === 'not_configured'
              ? 'reported'
              : 'failed'
          }
          title={
            ask.data.reason === 'unavailable' || ask.data.reason === 'not_configured'
              ? 'This console cannot answer yet'
              : 'This question could not be answered'
          }
          message={ask.data.message}
          onRetry={retry}
          retryLabel="Ask again"
          busy={false}
        />
      ) : null}

      {/* T116, FR-030, Principle I. Answered when the tab opened, so this is on
          screen before anything is typed rather than after something is tried. */}
      {blocked ? (
        <>
          <ConsoleProblem
            tone={toneFor(health.status)}
            title={
              toneFor(health.status) === 'reported'
                ? 'This console has no assistant to answer with'
                : 'This console cannot reach its assistant'
            }
            // The health report already names the provider and what it needs
            // (Principle I, FR-026), so it is rendered rather than restated.
            message={health.message}
            onRetry={() => void availability.refetch()}
            retryLabel="Check again"
            busy={availability.isFetching}
          />
          {/* FR-034a's discipline: no inert box that will not work, and no
              silence either — where the thing is done, said plainly. */}
          <p className="console__where">
            This dashboard reports the console’s assistant rather than providing one; it is
            configured for this installation, outside this window. Reported by{' '}
            <code className="console__provider">{health.providerId}</code>, checked{' '}
            <time dateTime={health.checkedAt}>{formatTimestamp(health.checkedAt)}</time>.
          </p>
        </>
      ) : probing ? (
        <p className="pending" role="status">
          Checking whether the console can answer&hellip;
        </p>
      ) : (
        <>
          {probeFailed ? (
            <ConsoleProblem
              tone="failed"
              title="The console’s status could not be checked"
              message={
                availability.error instanceof Error
                  ? availability.error.message
                  : 'Whether the console can answer has not been established within ten seconds. You can still put a question to it; it will report in place if it cannot answer.'
              }
              onRetry={() => void availability.refetch()}
              retryLabel="Check again"
              busy={availability.isFetching}
            />
          ) : null}

          <form className="console__composer" onSubmit={onSubmit}>
            <label className="console__label" htmlFor={inputId}>
              Ask about {stateName}
            </label>
            <textarea
              className="console__input"
              id={inputId}
              name="question"
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="console__send">
              <button
                className="button button--primary"
                type="submit"
                disabled={draft.trim() === '' || ask.isPending}
              >
                {ask.isPending ? 'Asking…' : 'Ask'}
                {/* Names the console this button belongs to, since a state's name
                    is the only thing distinguishing one from another. */}
                <span className="sr-only"> about {stateName}</span>
              </button>
            </p>
          </form>
        </>
      )}
    </section>
  );
}
