/**
 * T107 — the `setCredential` flow: a secret goes *in*, and nothing ever comes
 * back out (ipc-surface.md rule 3, FR-035).
 *
 * ## What this form can and cannot know
 *
 * The bridge has no method that returns a credential — not a masked one, not a
 * "configured" flag derived from one, not a length. The renderer's entire
 * privilege set is the twelve methods in ipc-surface.md §1, and none of them
 * reads a secret. So this form can learn exactly one thing about the existing
 * credential: that the provider reported itself unconfigured or rejected. It
 * therefore never pre-fills, never reveals, and never offers to show — there is
 * nothing to show, and a control implying otherwise would be a lie about the
 * contract.
 *
 * ## How long the secret exists in the renderer
 *
 * The input is uncontrolled and read through a ref at submit. The value is never
 * in React state, never in a prop, never in the URL, and never in a rendered
 * node; the field is cleared before the call is awaited, so the plaintext exists
 * only as one local variable for the length of one `mutateAsync`. The mutation is
 * then `reset()`, because TanStack Query keeps the last `variables` on the
 * mutation — and those variables are the secret. Resetting drops that reference
 * as soon as the result has been turned into a message, which is why the outcome
 * is copied into local state first.
 *
 * Nothing here is logged, echoed into a failure message, or interpolated into
 * copy. The typed failures the bridge returns are written by a main process that
 * never interpolates a credential either.
 */

import { useCallback, useId, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { useSetCredential } from '../query/hooks';

import { useTimedOut } from './RepoConfigForm';

export interface CredentialFormProps {
  /** Named by the definition that declared it — never a name this file knows. */
  readonly providerId: string;
  /** Called when a credential has been accepted, so the caller can collapse the form. */
  readonly onSaved?: () => void;
  readonly onCancel?: () => void;
}

export function CredentialForm({
  providerId,
  onSaved,
  onCancel,
}: CredentialFormProps): ReactElement {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const setCredential = useSetCredential();
  const timedOut = useTimedOut(setCredential.isPending);
  const waiting = setCredential.isPending && !timedOut;

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const input = inputRef.current;
      if (input === null) return;

      const secret = input.value;
      if (secret === '') {
        setOutcome({
          ok: false,
          message: `Enter the credential ${providerId} should use, then save it.`,
        });
        return;
      }

      // Cleared before the call, not after it: nothing that can be interrupted
      // sits between typing the secret and the field forgetting it.
      input.value = '';
      setOutcome(null);

      void setCredential
        .mutateAsync({ providerId, secret })
        .then((result) => {
          if (result.ok) {
            setOutcome({
              ok: true,
              message: `Saved. ${providerId} is read with this credential from the next reconciliation.`,
            });
            onSaved?.();
            return;
          }
          setOutcome({ ok: false, message: result.message });
        })
        .catch(() => {
          setOutcome({
            ok: false,
            message: `The credential for ${providerId} could not be stored. Nothing was saved — you can try again.`,
          });
        })
        .finally(() => {
          // Drops the mutation's copy of `variables`, which is the secret.
          setCredential.reset();
        });
    },
    [onSaved, providerId, setCredential],
  );

  const noteId = `${inputId}-note`;
  const outcomeId = `${inputId}-outcome`;
  const describedBy = [noteId, outcome === null ? null : outcomeId]
    .filter((id): id is string => id !== null)
    .join(' ');

  return (
    <form className="credential" onSubmit={onSubmit} noValidate>
      <label className="credential__label" htmlFor={inputId}>
        Credential for {providerId}
      </label>
      <input
        className="credential__control"
        id={inputId}
        ref={inputRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        disabled={waiting}
        aria-describedby={describedBy}
        aria-invalid={outcome !== null && !outcome.ok}
      />
      <p className="credential__note" id={noteId}>
        The credential is stored by this machine, not by the dashboard, and is never displayed
        again. Entering one here replaces whatever is stored; it cannot be read back.
      </p>

      {outcome === null ? null : (
        <p
          className={outcome.ok ? 'credential__outcome' : 'credential__outcome credential__outcome--failed'}
          id={outcomeId}
          role={outcome.ok ? 'status' : 'alert'}
        >
          {outcome.message}
        </p>
      )}

      {timedOut && setCredential.isPending ? (
        <p className="credential__outcome credential__outcome--failed" role="alert">
          Saving the credential has not answered within ten seconds. You can try again.
        </p>
      ) : null}

      <div className="credential__actions">
        <button className="button button--primary button--small" type="submit" disabled={waiting}>
          {waiting ? 'Saving…' : 'Save credential'}
        </button>
        {onCancel === undefined ? null : (
          <button className="button button--quiet button--small" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
