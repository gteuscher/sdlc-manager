/**
 * T097 — the repositories view (User Story 4), tested through rendered output
 * and user interaction only. The single seam is `window.dashboard`, which is the
 * renderer's entire privilege set (ipc-surface.md §4): a component that needed
 * anything else — a filesystem read, a credential read-back — would fail here
 * rather than quietly work.
 *
 * The two lifecycles below are invented, and neither the settings they declare
 * nor the providers they name appear anywhere in `src/renderer`. That is the
 * point of the file: FR-024's configuration form is *generated* from the
 * package's declarations, so a lifecycle this application has never seen must
 * render its own settings, with its own titles, and validate them by its own
 * rules (Principle II, SC-003).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { ReactElement } from 'react';

import type { SdlcPackageSummary } from '@core/ipc/schema';
import type { ProviderHealth, Repository } from '@core/model/observed';

import Repositories from '@renderer/routes/Repositories';
import { createBridgeStub, installBridge, type BridgeStub } from '../support/bridge';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CHECKED_AT = '2026-09-11T08:30:00.000Z';

/** A lifecycle whose settings this application has never seen. */
const ALMANAC: SdlcPackageSummary = {
  id: 'almanac',
  name: 'Almanac lifecycle',
  version: '3.2.1',
  path: '/packages/almanac',
  contractVersion: 1,
  supported: true,
  problem: null,
  problemField: null,
  problemLine: null,
  stateCount: 5,
  // 004. A healthy lifecycle: one of its five states is final.
  terminalStateCount: 1,
  unit: 'entry',
  repoConfig: [
    { key: 'providers.almanac.ledgerKey', title: 'Almanac ledger key', type: 'string', required: true },
    {
      key: 'gates.countersigned.approver',
      title: 'Countersigning approver',
      type: 'string',
      required: false,
      default: 'duty-officer',
      description: 'Whose countersignature the gate reads.',
    },
    { key: 'providers.almanac.pageSize', title: 'Entries per page', type: 'number', required: false },
    {
      key: 'gates.countersigned.strict',
      title: 'Strict countersigning',
      type: 'boolean',
      required: false,
    },
  ],
  providerKinds: ['ledger', 'courier'],
};

const ORRERY: SdlcPackageSummary = {
  id: 'orrery',
  name: 'Orrery lifecycle',
  version: '0.9.0',
  path: '/packages/orrery',
  contractVersion: 1,
  supported: true,
  problem: null,
  problemField: null,
  problemLine: null,
  stateCount: 3,
  // 004. Likewise, one final state of three.
  terminalStateCount: 1,
  unit: 'observation',
  repoConfig: [
    { key: 'providers.orrery.epoch', title: 'Orrery epoch', type: 'string', required: true },
  ],
  providerKinds: ['almanac-files'],
};

/** FR-045: installed, carrying no manifest, and therefore unsupported. */
const SUNDIAL: SdlcPackageSummary = {
  id: 'sundial',
  name: 'Sundial helper',
  version: '2.0.0',
  path: '/packages/sundial',
  contractVersion: 0,
  supported: false,
  problem: 'No sdlc.yaml manifest was found in the package.',
  problemField: null,
  problemLine: null,
  stateCount: 0,
  // 004. No manifest loaded, so there are no states to count either way.
  terminalStateCount: 0,
  unit: 'item',
  repoConfig: [],
  providerKinds: [],
};

/**
 * 004, FR-010. A lifecycle that declares no final state at all. It is a perfectly
 * well-formed manifest — every state resolves, every provider is declared — and
 * by its own definition no work following it is ever finished.
 */
const TREADMILL: SdlcPackageSummary = {
  id: 'treadmill',
  name: 'Treadmill lifecycle',
  version: '1.4.0',
  path: '/packages/treadmill',
  contractVersion: 1,
  supported: true,
  problem: null,
  problemField: null,
  problemLine: null,
  stateCount: 4,
  terminalStateCount: 0,
  unit: 'errand',
  repoConfig: [
    { key: 'providers.treadmill.queue', title: 'Treadmill queue', type: 'string', required: true },
  ],
  providerKinds: ['queue'],
};

/** 004, FR-014. The mirror: every state it declares is final. */
const MAYFLY: SdlcPackageSummary = {
  id: 'mayfly',
  name: 'Mayfly lifecycle',
  version: '0.3.0',
  path: '/packages/mayfly',
  contractVersion: 1,
  supported: true,
  problem: null,
  problemField: null,
  problemLine: null,
  stateCount: 2,
  terminalStateCount: 2,
  unit: 'sighting',
  repoConfig: [],
  providerKinds: ['almanac-files'],
};

function health(overrides: Partial<ProviderHealth> & { providerId: string }): ProviderHealth {
  return {
    kind: 'ledger-api',
    status: 'ok',
    message: `${overrides.providerId} answered normally.`,
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function repository(overrides: Partial<Repository> & { id: string; name: string }): Repository {
  return {
    path: `/work/${overrides.id}`,
    packageId: 'almanac',
    packageVersion: '3.2.1',
    config: {},
    providerStatus: {},
    availability: 'available',
    problem: null,
    ...overrides,
  };
}

const LEDGER = repository({
  id: 'repo-ledger',
  name: 'Ledger',
  config: {
    'providers.almanac.ledgerKey': 'LEDGER-77',
    'providers.almanac.pageSize': 50,
    'gates.countersigned.strict': true,
  },
  providerStatus: {
    almanac: health({
      providerId: 'almanac',
      status: 'not_configured',
      message: 'almanac has no credential configured yet.',
    }),
    courier: health({ providerId: 'courier', kind: 'mail' }),
  },
});

/** Registered against an older version of the same definition (FR-043). */
const ANNEX = repository({ id: 'repo-annex', name: 'Annex', packageVersion: '3.1.0' });

const ORBIT = repository({
  id: 'repo-orbit',
  name: 'Orbit',
  packageId: 'orrery',
  packageVersion: '0.9.0',
  config: { 'providers.orrery.epoch': 'J2000' },
});

function populated(overrides: Parameters<typeof createBridgeStub>[0] = {}): BridgeStub {
  return createBridgeStub({
    listRepositories: () => Promise.resolve([LEDGER, ANNEX, ORBIT]),
    listPackages: () => Promise.resolve([ALMANAC, ORRERY, SUNDIAL]),
    ...overrides,
  });
}

// ── Harness ─────────────────────────────────────────────────────────────────

let teardown: (() => void) | undefined;

function mount(stub: BridgeStub, initialEntry = '/repositories'): { container: HTMLElement } {
  teardown = installBridge(stub);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Repositories />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { container };
}

/** The query string as rendered output, so URL state is asserted without reaching into the router. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <p data-testid="query-string">{location.search}</p>;
}

/** The group for one SDLC definition, by the name the package gave itself. */
function group(name: string): ReturnType<typeof within> {
  return within(screen.getByRole('region', { name }));
}

/** 004. The installed-packages section, where package-level conditions are reported. */
function installedPackages(): ReturnType<typeof within> {
  return within(screen.getByRole('region', { name: /installed SDLC packages/i }));
}

/** 004. The single listed entry for one package, so a report can be pinned to it. */
function packageEntry(name: string): HTMLElement {
  const entry = installedPackages().getByText(name).closest('li');
  if (entry === null) throw new Error(`${name} is not listed among the installed packages.`);
  return entry;
}

beforeEach(() => {
  teardown = undefined;
});

afterEach(() => {
  teardown?.();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the repositories view', () => {
  it('groups repositories by the SDLC definition they follow, each with its package and version', async () => {
    mount(populated());

    // FR-022: two repositories sharing a definition appear under one group.
    await screen.findByRole('heading', { name: ALMANAC.name });
    const almanac = group(ALMANAC.name);
    expect(almanac.getByRole('heading', { name: 'Ledger' })).toBeDefined();
    expect(almanac.getByRole('heading', { name: 'Annex' })).toBeDefined();
    expect(almanac.getByText(/2 repositories follow this SDLC/i)).toBeDefined();

    // FR-043: the version each repository is recorded against, which need not be
    // the version now installed.
    expect(almanac.getByText('version 3.2.1')).toBeDefined();
    expect(almanac.getByText('version 3.1.0')).toBeDefined();
    expect(almanac.getByText(/installed package is now version 3.2.1/i)).toBeDefined();

    const orrery = group(ORRERY.name);
    expect(orrery.getByRole('heading', { name: 'Orbit' })).toBeDefined();
    expect(orrery.getByText('version 0.9.0')).toBeDefined();
  });

  it('keeps which repository is open in the URL rather than in a store', async () => {
    mount(populated());

    await userEvent.click(await screen.findByRole('button', { name: /configure Ledger/i }));

    expect(screen.getByTestId('query-string').textContent).toContain('repository=repo-ledger');
    expect(screen.getByRole('button', { name: /close Ledger/i })).toBeDefined();
  });

  it('restores the open repository from the URL it was opened with', async () => {
    mount(populated(), '/repositories?repository=repo-orbit');

    // The Orrery lifecycle declares one setting, and it is the one on screen.
    expect(await screen.findByLabelText(/Orrery epoch/i)).toBeDefined();
    expect(screen.queryByLabelText(/Almanac ledger key/i)).toBeNull();
  });

  it('generates the configuration form from the package’s own declarations', async () => {
    mount(populated(), '/repositories?repository=repo-ledger');

    // Every control here exists because the manifest declared it (FR-024). A
    // setting this application has never seen renders with no code change.
    const key = await screen.findByLabelText(/Almanac ledger key \(required\)/i);
    expect((key as HTMLInputElement).value).toBe('LEDGER-77');

    const size = screen.getByLabelText(/Entries per page/i);
    expect((size as HTMLInputElement).type).toBe('number');
    expect((size as HTMLInputElement).value).toBe('50');

    // A configurable gate reaches the form as a declaration like any other, and
    // is listed with its current setting for this repository.
    const strict = screen.getByLabelText(/Strict countersigning/i) as HTMLInputElement;
    expect(strict.type).toBe('checkbox');
    expect(strict.checked).toBe(true);

    // Unset, so the package's own default is what is in effect, and it is shown.
    const approver = screen.getByLabelText(/Countersigning approver/i) as HTMLInputElement;
    expect(approver.value).toBe('duty-officer');
    expect(screen.getByText(/Whose countersignature the gate reads/i)).toBeDefined();
    // The declared key, so it is clear what each setting reaches.
    expect(screen.getByText('gates.countersigned.approver')).toBeDefined();
  });

  it('saves an edited configuration through the bridge', async () => {
    const saved: unknown[] = [];
    mount(
      populated({
        updateRepositoryConfig: (id, config) => {
          saved.push({ id, config });
          return Promise.resolve({ ok: true as const, value: LEDGER });
        },
      }),
      '/repositories?repository=repo-ledger',
    );

    const key = await screen.findByLabelText(/Almanac ledger key/i);
    await userEvent.clear(key);
    await userEvent.type(key, 'LEDGER-99');
    await userEvent.click(screen.getByRole('button', { name: /save configuration/i }));

    await screen.findByText(/configuration saved/i);
    expect(saved).toEqual([
      {
        id: 'repo-ledger',
        config: {
          'providers.almanac.ledgerKey': 'LEDGER-99',
          'gates.countersigned.approver': 'duty-officer',
          'providers.almanac.pageSize': 50,
          'gates.countersigned.strict': true,
        },
      },
    ]);
  });

  it('rejects an invalid save against the offending field, retaining the prior configuration', async () => {
    mount(
      populated({
        updateRepositoryConfig: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'invalid_input' as const,
            message: '"Entries per page" must be a number; a string was supplied.',
            field: 'providers.almanac.pageSize',
          }),
      }),
      '/repositories?repository=repo-ledger',
    );

    const size = await screen.findByLabelText(/Entries per page/i);
    await userEvent.click(screen.getByRole('button', { name: /save configuration/i }));

    // FR-025: the field and the reason, against that field's own input.
    const message = await screen.findByText(/"Entries per page" must be a number/i);
    expect(size.getAttribute('aria-invalid')).toBe('true');
    // Announced, not merely seen (Principle XI).
    expect(size.getAttribute('aria-describedby')).toContain(message.id);
    expect(message.getAttribute('role')).toBe('alert');

    // And the prior configuration is still what the repository uses.
    expect(screen.getByText(/previous configuration is still in effect for Ledger/i)).toBeDefined();
    expect((screen.getByLabelText(/Almanac ledger key/i) as HTMLInputElement).value).toBe(
      'LEDGER-77',
    );

    // No other field is marked.
    expect(screen.getByLabelText(/Almanac ledger key/i).getAttribute('aria-invalid')).toBe('false');
  });

  it('reports a refusal that names no field as a form-level failure, with the save still available', async () => {
    mount(
      populated({
        updateRepositoryConfig: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'unavailable' as const,
            message: 'The SDLC package is no longer installed, so the configuration was not saved.',
            field: 'packageId',
          }),
      }),
      '/repositories?repository=repo-ledger',
    );

    await screen.findByLabelText(/Almanac ledger key/i);
    await userEvent.click(screen.getByRole('button', { name: /save configuration/i }));

    expect(await screen.findByText(/no longer installed/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDefined();
  });

  it('names the providers a repository needs and which are not configured yet', async () => {
    mount(populated(), '/repositories?repository=repo-ledger');

    // FR-026, FR-035: named, counted, and actionable rather than a failure.
    expect(await screen.findByText(/1 of 2 providers this repository requires is not configured/i))
      .toBeDefined();
    expect(screen.getByText('almanac')).toBeDefined();
    expect(screen.getByText(/almanac has no credential configured yet/i)).toBeDefined();
    expect(screen.getByText('Needs a credential')).toBeDefined();

    // The healthy one is reported as configured, and offers no credential form.
    expect(screen.getByText('Configured')).toBeDefined();
    expect(screen.queryByRole('button', { name: /set the credential for courier/i })).toBeNull();
  });

  it('reads well on a first run, where nothing is configured at all', async () => {
    const fresh = repository({
      id: 'repo-fresh',
      name: 'Fresh',
      providerStatus: {
        almanac: health({
          providerId: 'almanac',
          status: 'not_configured',
          message: 'almanac has no credential configured yet.',
        }),
        courier: health({
          providerId: 'courier',
          status: 'not_configured',
          message: 'courier has no credential configured yet.',
        }),
      },
    });

    mount(
      populated({ listRepositories: () => Promise.resolve([fresh]) }),
      '/repositories?repository=repo-fresh',
    );

    expect(
      await screen.findByText(/2 of 2 providers this repository requires are not configured/i),
    ).toBeDefined();
    expect(screen.getByText(/nothing is configured on a new installation/i)).toBeDefined();
    // Both named, both actionable.
    expect(screen.getByRole('button', { name: /set the credential for almanac/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /set the credential for courier/i })).toBeDefined();
  });

  it('passes a credential in without ever reading one back', async () => {
    const sent: { providerId: string; secret: string }[] = [];
    const stub = populated({
      setCredential: (providerId, secret) => {
        sent.push({ providerId, secret });
        return Promise.resolve({ ok: true as const, value: undefined });
      },
    });
    mount(stub, '/repositories?repository=repo-ledger');

    await userEvent.click(
      await screen.findByRole('button', { name: /set the credential for almanac/i }),
    );

    const field = screen.getByLabelText(/credential for almanac/i) as HTMLInputElement;
    // Never displayed, so never a text field (ipc-surface.md rule 3).
    expect(field.type).toBe('password');
    expect(field.value).toBe('');
    expect(screen.getByText(/never displayed again/i)).toBeDefined();

    const secret = 'ledger-token-9f3c2b';
    await userEvent.type(field, secret);
    await userEvent.click(screen.getByRole('button', { name: /save credential/i }));

    await screen.findByText(/saved\. almanac is read with this credential/i);
    expect(sent).toEqual([{ providerId: 'almanac', secret }]);

    // The form forgets it immediately, and nothing rendered ever carried it.
    expect(field.value).toBe('');
    expect(document.body.innerHTML).not.toContain(secret);

    // And there is no capability to read one: the bridge has exactly one
    // credential method, and it only writes.
    expect(Object.keys(stub.bridge).filter((name) => /credential/i.test(name))).toEqual([
      'setCredential',
    ]);
  });

  it('reports a rejected credential in place, with the form still usable', async () => {
    mount(
      populated({
        setCredential: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'unauthenticated' as const,
            message: 'The credential was rejected by almanac. Check it and enter it again.',
          }),
      }),
      '/repositories?repository=repo-ledger',
    );

    await userEvent.click(
      await screen.findByRole('button', { name: /set the credential for almanac/i }),
    );
    await userEvent.type(screen.getByLabelText(/credential for almanac/i), 'wrong-token');
    await userEvent.click(screen.getByRole('button', { name: /save credential/i }));

    expect(await screen.findByText(/rejected by almanac/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /save credential/i })).toBeDefined();
  });

  it('offers an unsupported package as unsupported, naming what is missing, and refuses to associate it', async () => {
    const attempts: unknown[] = [];
    mount(
      populated({
        registerRepository: (input) => {
          attempts.push(input);
          return Promise.resolve({ ok: true as const, value: LEDGER });
        },
      }),
    );

    // FR-042: it is listed, so an engineer who installed it can see why it is
    // unusable, rather than finding it silently absent.
    await screen.findByText(SUNDIAL.name);
    const packages = within(screen.getByRole('region', { name: /installed SDLC packages/i }));
    expect(packages.getByText(SUNDIAL.name)).toBeDefined();
    expect(packages.getByText('Unsupported')).toBeDefined();
    expect(packages.getByText(/no sdlc\.yaml manifest was found/i)).toBeDefined();
    // FR-041: no suggestion that the lifecycle could be inferred from the package.
    expect(packages.getByText(/never guessed from its documentation/i)).toBeDefined();

    // FR-045: choosing it explains the refusal and blocks the registration.
    await userEvent.selectOptions(screen.getByLabelText('SDLC package'), 'sundial');

    const refusal = screen.getByText(/Sundial helper is unsupported/i);
    expect(refusal.textContent).toContain('No sdlc.yaml manifest was found in the package.');
    expect(screen.getByLabelText('SDLC package').getAttribute('aria-invalid')).toBe('true');

    const submit = screen.getByRole('button', { name: /register repository/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(submit);
    expect(attempts).toEqual([]);

    // And no configuration form is generated for it — there are no declarations
    // to generate one from.
    expect(screen.queryByRole('heading', { name: /settings Sundial helper requires/i })).toBeNull();
  });

  it('registers a repository with the configuration its chosen package declares', async () => {
    const attempts: unknown[] = [];
    mount(
      populated({
        registerRepository: (input) => {
          attempts.push(input);
          return Promise.resolve({ ok: true as const, value: ORBIT });
        },
      }),
    );

    await userEvent.type(await screen.findByLabelText(/^name$/i), 'Orbit');
    await userEvent.type(screen.getByLabelText(/path on this machine/i), '/work/orbit');
    await userEvent.selectOptions(screen.getByLabelText('SDLC package'), 'orrery');

    // The fields appeared because the chosen package declares them.
    await userEvent.type(screen.getByLabelText(/Orrery epoch/i), 'J2000');
    await userEvent.click(screen.getByRole('button', { name: /register repository/i }));

    await screen.findByText(/Orbit is registered/i);
    expect(attempts).toEqual([
      {
        name: 'Orbit',
        path: '/work/orbit',
        packageId: 'orrery',
        config: { 'providers.orrery.epoch': 'J2000' },
      },
    ]);
  });

  it('rejects a registration against the field the main process named', async () => {
    mount(
      populated({
        registerRepository: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'conflict' as const,
            message: '/work/orbit is already registered as "Orbit".',
            field: 'path',
          }),
      }),
    );

    await userEvent.type(await screen.findByLabelText(/^name$/i), 'Orbit again');
    await userEvent.type(screen.getByLabelText(/path on this machine/i), '/work/orbit');
    await userEvent.selectOptions(screen.getByLabelText('SDLC package'), 'orrery');
    await userEvent.click(screen.getByRole('button', { name: /register repository/i }));

    const message = await screen.findByText(/already registered as "Orbit"/i);
    const field = screen.getByLabelText(/path on this machine/i);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(message.id);
  });

  it('removes a registration only after the removal is confirmed', async () => {
    const removed: string[] = [];
    mount(
      populated({
        removeRepository: (id) => {
          removed.push(id);
          return Promise.resolve({ ok: true as const, value: undefined });
        },
      }),
      '/repositories?repository=repo-ledger',
    );

    await userEvent.click(await screen.findByRole('button', { name: /^remove Ledger$/i }));
    expect(removed).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: /yes, remove Ledger/i }));
    await waitFor(() => expect(removed).toEqual(['repo-ledger']));
  });

  it('says what to do when nothing is registered, rather than rendering a blank frame', async () => {
    mount(populated({ listRepositories: () => Promise.resolve([]) }));

    expect(await screen.findByText(/no repositories registered yet/i)).toBeDefined();
    expect(screen.getByText(/no credentials are needed first/i)).toBeDefined();
    // The action is on this page: the registration form.
    expect(screen.getByRole('heading', { name: /register a repository/i })).toBeDefined();
  });

  it('names where it looked, and how to look elsewhere, when no SDLC package is installed', async () => {
    const { container } = mount(
      populated({
        listRepositories: () => Promise.resolve([]),
        listPackages: () => Promise.resolve([]),
        packageSearchPaths: () =>
          Promise.resolve(['/home/dev/.claude/plugins', '/home/dev/.sdlc/packages']),
      }),
    );

    expect(await screen.findByText(/no SDLC packages were found on this machine/i)).toBeDefined();

    // Principle I: actionable. The directories actually scanned, named, so an
    // engineer can look in one of them rather than guess.
    expect(screen.getByText('/home/dev/.claude/plugins')).toBeDefined();
    expect(screen.getByText('/home/dev/.sdlc/packages')).toBeDefined();

    // ...and the way to point it somewhere else, which is otherwise undiscoverable.
    expect(screen.getByText('SDLC_PACKAGE_PATHS')).toBeDefined();

    // FR-034a: no inert control. A register form with nothing to register
    // against is the dead affordance, so it is not rendered at all.
    expect(screen.queryByRole('button', { name: /register repository/i })).toBeNull();
    expect(screen.queryByLabelText(/path on this machine/i)).toBeNull();

    // The normal first run, not a failure: announced as status, not as an alert.
    expect(screen.queryByRole('alert')).toBeNull();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('says so deliberately when where it looked cannot be reported', async () => {
    mount(
      populated({
        listRepositories: () => Promise.resolve([]),
        listPackages: () => Promise.resolve([]),
        packageSearchPaths: () => Promise.resolve([]),
      }),
    );

    // Principle X: a deliberate nothing rather than an empty bulleted list.
    expect(await screen.findByText(/where it looked has not been reported/i)).toBeDefined();
    expect(screen.getByText(/no SDLC packages were found on this machine/i)).toBeDefined();
  });

  it('offers a retry when the registrations cannot be read', async () => {
    let attempts = 0;
    mount(
      populated({
        listRepositories: () => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error('The registry file is unreadable.'));
          return Promise.resolve([LEDGER]);
        },
      }),
    );

    expect(await screen.findByText(/could not be read/i)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: /reload the repositories/i }));
    expect(await screen.findByRole('heading', { name: 'Ledger' })).toBeDefined();
  });

  it('keeps a repository whose path has vanished listed, with the problem named', async () => {
    mount(
      populated({
        listRepositories: () =>
          Promise.resolve([
            repository({
              id: 'repo-gone',
              name: 'Gone',
              availability: 'path_missing',
              problem: '/work/gone no longer exists. Re-point the registration or remove it.',
            }),
            LEDGER,
          ]),
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Gone' })).toBeDefined();
    expect(screen.getByText(/no longer exists/i)).toBeDefined();
    // A neighbour's missing path costs that repository only.
    expect(screen.getByRole('heading', { name: 'Ledger' })).toBeDefined();
  });

  // ── 004, User Story 2: a lifecycle that can never let work go ─────────────

  it('reports a lifecycle declaring no final state, naming it and saying what follows', async () => {
    mount(populated({ listPackages: () => Promise.resolve([ALMANAC, TREADMILL, SUNDIAL]) }));

    await screen.findByText(TREADMILL.name);
    const entry = within(packageEntry(TREADMILL.name));

    // FR-010: the condition belongs to the package, so the report names it.
    const report = entry.getByText(/never leave the active list/i);
    expect(report.textContent).toContain(TREADMILL.name);

    // FR-011: the consequence, and where the correction belongs — in the
    // package, not here. Nothing in this application can supply a declaration
    // the manifest does not make, and offering to would be a lie.
    expect(report.textContent).toMatch(/in the package itself/i);
    expect(report.textContent).toMatch(/cannot supply it/i);

    // Announced rather than merely seen, and legible without colour.
    expect(report.closest('p')?.getAttribute('role')).toBe('status');
    expect(entry.getByText('Never finishes')).toBeDefined();

    // Against the package it belongs to, and no other.
    const healthy = within(packageEntry(ALMANAC.name));
    expect(healthy.queryByText(/never leave the active list/i)).toBeNull();
  });

  it('reports the mirror — a lifecycle whose every state is final — on the same terms', async () => {
    mount(populated({ listPackages: () => Promise.resolve([ALMANAC, MAYFLY]) }));

    await screen.findByText(MAYFLY.name);
    const entry = within(packageEntry(MAYFLY.name));

    // FR-014: reported like FR-010, because it is the same defect seen from the
    // other end — a lifecycle that finishes work the instant it appears.
    const report = entry.getByText(/never show as active/i);
    expect(report.textContent).toContain(MAYFLY.name);
    expect(report.textContent).toMatch(/the package is marking more states terminal/i);

    expect(report.closest('p')?.getAttribute('role')).toBe('status');
    expect(entry.getByText('Finishes instantly')).toBeDefined();
  });

  it('reports such a lifecycle without refusing it: still usable, and still registrable', async () => {
    const attempts: unknown[] = [];
    mount(
      populated({
        listPackages: () => Promise.resolve([ALMANAC, TREADMILL, SUNDIAL]),
        registerRepository: (input) => {
          attempts.push(input);
          return Promise.resolve({ ok: true as const, value: LEDGER });
        },
      }),
    );

    await screen.findByText(TREADMILL.name);
    const entry = within(packageEntry(TREADMILL.name));

    // FR-012: it is listed, and listed as usable. The report is a report.
    expect(entry.getByText('Usable')).toBeDefined();
    expect(entry.queryByText('Unsupported')).toBeNull();

    // It carries no problem, and is not given the unsupported treatment: that
    // one is an alert saying no repository can be associated with the package.
    expect(entry.queryByRole('alert')).toBeNull();
    expect(entry.queryByText(/no repository can be associated with it/i)).toBeNull();
    expect(entry.queryByText(/never guessed from its documentation/i)).toBeNull();

    // And it describes itself like any other usable package.
    expect(entry.getByText(/4 declared states/i)).toBeDefined();

    // Still offered for registration, and not marked as a bad choice.
    const select = screen.getByLabelText('SDLC package') as HTMLSelectElement;
    const option = within(select).getByRole('option', { name: /Treadmill lifecycle/i });
    expect(option.textContent).not.toMatch(/unsupported/i);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Treadmill');
    await userEvent.type(screen.getByLabelText(/path on this machine/i), '/work/treadmill');
    await userEvent.selectOptions(select, 'treadmill');

    expect(select.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText(/Treadmill lifecycle is unsupported/i)).toBeNull();

    // The settings it declares are generated as they are for any other package.
    await userEvent.type(screen.getByLabelText(/Treadmill queue/i), 'nightly');

    const submit = screen.getByRole('button', { name: /register repository/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(submit);

    // The registration goes through: the work is tracked, and the manifest is
    // the engineer's to fix, in their own time.
    await waitFor(() =>
      expect(attempts).toEqual([
        {
          name: 'Treadmill',
          path: '/work/treadmill',
          packageId: 'treadmill',
          config: { 'providers.treadmill.queue': 'nightly' },
        },
      ]),
    );
  });

  it('says nothing at all about a lifecycle that both starts and finishes work', async () => {
    // ALMANAC and ORRERY each declare one final state among several, and SUNDIAL
    // declares none at all because nothing of it was loaded.
    mount(populated());

    await screen.findByRole('heading', { name: ALMANAC.name });
    const packages = installedPackages();

    // The report must stay rare enough to be read. A tag on every package is
    // noise, and noise is how a real condition goes unnoticed.
    expect(packages.queryByText('Never finishes')).toBeNull();
    expect(packages.queryByText('Finishes instantly')).toBeNull();
    expect(packages.queryByText(/never leave the active list/i)).toBeNull();
    expect(packages.queryByText(/never show as active/i)).toBeNull();

    // Nothing is announced at all — including about the unsupported package,
    // whose zero final states are the absence of a manifest and not a claim
    // about how its lifecycle behaves.
    expect(packages.queryByRole('status')).toBeNull();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = mount(populated());

    await screen.findByRole('heading', { name: ALMANAC.name });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no detectable accessibility violations with a configuration and a credential form open', async () => {
    const { container } = mount(populated(), '/repositories?repository=repo-ledger');

    await userEvent.click(
      await screen.findByRole('button', { name: /set the credential for almanac/i }),
    );
    await screen.findByLabelText(/credential for almanac/i);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no detectable accessibility violations in its empty state', async () => {
    const { container } = mount(populated({ listRepositories: () => Promise.resolve([]) }));

    await screen.findByText(/no repositories registered yet/i);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
