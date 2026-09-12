/**
 * T106 — which providers this repository's configuration requires, and which of
 * them are not yet configured (FR-026, FR-035, Principle I).
 *
 * The application starts with zero credentials, so "not configured" is the
 * *normal* first state of every provider a definition names, not an error. The
 * constitution is specific about what that has to look like: an actionable
 * configuration prompt naming the missing provider — never a crash, a blank
 * screen, or a silent empty state. So this component always renders something,
 * always names the provider, and always offers the one action that resolves it.
 *
 * Every provider name, kind, and message comes from the loaded definition and the
 * health the main process reported. Nothing here knows a provider by name, which
 * is the same rule the item list follows for states (Principle II) — a lifecycle
 * reading a system this application has never heard of prompts for it correctly.
 *
 * The status wording is the part that cannot come from data: the six health
 * statuses are the IPC contract's own closed enum, and each needs a phrase an
 * engineer can act on. Their *message* is still the main process's, because that
 * is where the detail lives.
 */

import { useId, useState } from 'react';
import type { ReactElement } from 'react';

import type { ProviderHealth } from '@core/model/observed';

import { CredentialForm } from './CredentialForm';

/** The contract's closed status set, in words that say what to do about each one. */
const STATUS_LABEL: Record<ProviderHealth['status'], string> = {
  ok: 'Configured',
  not_configured: 'Needs a credential',
  unauthenticated: 'Credential rejected',
  unreachable: 'Unreachable',
  rate_limited: 'Rate limited',
  unsupported: 'Not supported',
};

/** The two statuses a credential can resolve. The others need something else entirely. */
function needsCredential(status: ProviderHealth['status']): boolean {
  return status === 'not_configured' || status === 'unauthenticated';
}

export interface ProviderStatusProps {
  /** Health for every provider this repository's definition requires. */
  readonly statuses: readonly ProviderHealth[];
  /**
   * The provider kinds the package declares, used only when no health has been
   * reported yet — a repository registered a moment ago, or one whose package is
   * unreadable. Naming the kinds is better than naming nothing.
   */
  readonly declaredKinds: readonly string[];
  readonly repositoryName: string;
}

export function ProviderStatus({
  statuses,
  declaredKinds,
  repositoryName,
}: ProviderStatusProps): ReactElement {
  const headingId = useId();
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);

  const unconfigured = statuses.filter((health) => needsCredential(health.status));
  const names = unconfigured.map((health) => health.providerId).join(', ');

  let summary: ReactElement;
  if (statuses.length === 0 && declaredKinds.length === 0) {
    summary = (
      <p className="providers__summary">
        This SDLC package declares no external providers, so {repositoryName} needs no credentials.
      </p>
    );
  } else if (statuses.length === 0) {
    summary = (
      <p className="providers__summary">
        This SDLC package declares {declaredKinds.length}{' '}
        {declaredKinds.length === 1 ? 'provider' : 'providers'} ({declaredKinds.join(', ')}). None
        has reported its status yet for {repositoryName}; it appears after the next reconciliation.
      </p>
    );
  } else if (unconfigured.length === 0) {
    summary = (
      <p className="providers__summary">
        All {statuses.length} {statuses.length === 1 ? 'provider' : 'providers'} this repository
        requires have a credential.
      </p>
    );
  } else {
    summary = (
      <p className="providers__summary providers__summary--action" role="status">
        {unconfigured.length} of {statuses.length}{' '}
        {statuses.length === 1 ? 'provider' : 'providers'} this repository requires{' '}
        {unconfigured.length === 1 ? 'is' : 'are'} not configured yet: {names}.
        {unconfigured.length === statuses.length
          ? ' Nothing is configured on a new installation — that is expected. Set a credential for each one below and its items appear at the next reconciliation.'
          : ' The rest keep working; set a credential below for the ones listed.'}
      </p>
    );
  }

  return (
    <section className="providers" aria-labelledby={headingId}>
      <h4 className="providers__heading" id={headingId}>
        Providers
      </h4>
      {summary}

      {statuses.length === 0 ? null : (
        <ul className="providers__list">
          {statuses.map((health, index) => {
            const open = openProviderId === health.providerId;
            // Indexed rather than named: a provider id is data and need not be a
            // legal element id.
            const panelId = `${headingId}-provider-${index}`;
            return (
              <li className="providers__item" key={health.providerId}>
                <p className="providers__name">
                  <span className="providers__id">{health.providerId}</span>
                  <span className="providers__kind">{health.kind}</span>
                  <span
                    className={
                      needsCredential(health.status)
                        ? 'tag providers__state providers__state--wanted'
                        : 'tag providers__state'
                    }
                  >
                    {STATUS_LABEL[health.status]}
                  </span>
                </p>
                <p className="providers__message">{health.message}</p>

                {needsCredential(health.status) ? (
                  <>
                    <button
                      className="button button--small"
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setOpenProviderId(open ? null : health.providerId)}
                    >
                      {open
                        ? `Close the credential form for ${health.providerId}`
                        : `Set the credential for ${health.providerId}`}
                    </button>
                    <div className="providers__panel" id={panelId} hidden={!open}>
                      {open ? (
                        <CredentialForm
                          providerId={health.providerId}
                          onCancel={() => setOpenProviderId(null)}
                        />
                      ) : null}
                    </div>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
