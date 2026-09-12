/**
 * T083 — the read-only posture, made legible rather than implicit (FR-034a).
 *
 * v1.0 observes and reports. It performs no transition, no gate approval or
 * override, and no check retry against any system of record (FR-034, SC-011),
 * and the IPC surface has no method that could. The interface has two honest
 * ways to express that, and one dishonest one:
 *
 *   - A disabled "Approve" button. This is the dishonest one. It implies the
 *     capability exists and is merely unavailable right now, which sends the
 *     engineer looking for the permission or the state that would enable it.
 *   - Silence. Also wrong: the item is stalled, something is owed, and the
 *     interface knows where — withholding that is the omission FR-034a names.
 *   - **A sentence saying where the action is performed.** This is what this
 *     component renders, from `GateView.actionLocation`, which the manifest's
 *     gate declaration supplies precisely so the dashboard can say it.
 *
 * So there is no control here at all — not a disabled one, not a hidden one.
 * When nothing is owed it says so, because an empty panel beside a stalled item
 * is indistinguishable from a panel that failed to load (Principle X).
 *
 * The standing note at the foot is deliberately repeated on every state rather
 * than hoisted to the shell: an engineer arriving on a deep link to one state
 * has not read the rest of the application.
 */

import { useId } from 'react';
import type { ReactElement } from 'react';

import type { AttentionSignal, GateView, StateProgress } from '@core/model/observed';

export interface StateActionsProps {
  readonly progress: StateProgress;
  /** True when the definition declares that items resting in this state await a person. */
  readonly awaitsHuman: boolean;
  readonly gates: readonly GateView[];
  /** The item's attention signal, when it was raised against this state. Otherwise null. */
  readonly attention: AttentionSignal | null;
}

interface OwedAction {
  readonly id: string;
  readonly what: string;
  readonly where: string;
}

/** Copy for a gate the definition left without an action location. Never blank. */
const UNPLACED =
  'This item’s SDLC definition does not record where this is done. Check the repository’s SDLC package for the gate’s own instructions.';

function owedFor(props: StateActionsProps): OwedAction[] {
  const owed: OwedAction[] = [];
  const resting = props.progress === 'current' || props.progress === 'blocked';

  if (resting && props.awaitsHuman) {
    owed.push({
      id: '',
      what: 'This state is declared as waiting on a person before the item can move on.',
      where: props.attention?.reason ?? UNPLACED,
    });
  }

  for (const gate of props.gates) {
    const status = gate.result.status;
    const unresolved = status !== 'passed';
    // A gate is owed when the definition says a person decides it, or when it
    // failed and the definition named somewhere to go and deal with that.
    const owedHere = unresolved && (gate.awaitsHuman || (status === 'failed' && gate.actionLocation !== null));
    if (!owedHere) continue;

    owed.push({
      id: gate.id,
      what:
        status === 'failed'
          ? `${gate.name} failed${gate.blocking ? ' and is blocking' : ''}.`
          : `${gate.name} has no recorded evaluation and is declared as one a person decides.`,
      where: gate.actionLocation ?? UNPLACED,
    });
  }

  return owed;
}

export function StateActions(props: StateActionsProps): ReactElement {
  const headingId = useId();
  const owed = owedFor(props);

  return (
    <section className="actions" aria-labelledby={headingId}>
      <h3 className="actions__heading" id={headingId}>
        Where to act
      </h3>

      {owed.length === 0 ? (
        <p className="actions__clear">Nothing in this state is waiting on you.</p>
      ) : (
        <ul className="actions__list">
          {owed.map((action, index) => (
            <li className="actions__item" key={`${action.id}-${index}`}>
              <span className="actions__what">{action.what}</span>{' '}
              <span className="actions__where">{action.where}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="actions__posture">
        SDLC Manager reads your systems of record and never writes to them. It cannot advance a
        state, approve or override a gate, or re-run a check — those happen where your SDLC package
        performs them.
      </p>
    </section>
  );
}
