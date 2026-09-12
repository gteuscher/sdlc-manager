/**
 * T103, T108 — User Story 4: every registered repository, grouped by the SDLC
 * definition it follows.
 *
 * ## Grouping, and why by package id
 *
 * FR-022 groups by "the SDLC definition it follows", and the thing that
 * identifies a definition across upgrades is the package id (sdlc-manifest.md §4:
 * `id` is the stable slug, `version` is not). So two repositories on the same
 * lifecycle appear under one group even when they were registered against
 * different versions of it — which is the case worth showing, because each
 * repository carries its *own* recorded version (FR-043) and a difference between
 * them is exactly what an engineer needs to see. Every group heading is the
 * package's own name; nothing here knows one.
 *
 * ## Unsupported packages (T108, FR-045)
 *
 * A package whose manifest is missing or unreadable is *listed*, with what is
 * missing named, and cannot be associated with a repository. It is offered in the
 * registration select rather than hidden — an engineer who installed a package
 * and cannot find it would otherwise have nothing to read — but selecting it
 * explains the refusal and the registration control stays disabled. The main
 * process refuses it independently; this is the explanation, not the enforcement.
 *
 * What the view will never do is guess. There is no "try anyway", no inferred
 * state list, and no copy suggesting the package would work if the engineer tried
 * harder: a lifecycle that is not declared does not exist (Principle II, FR-041).
 *
 * ## State
 *
 * Which repository is open is in the URL (`?repository=<id>`), so a configuration
 * screen is a link and the back button works; the drafts inside the forms are
 * local to those forms (Principle XIII). There is no store.
 */

import { useCallback, useId, useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import type { ConfigFieldPayload, SdlcPackageSummary } from '@core/ipc/schema';
import type { Repository } from '@core/model/observed';

import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { ProviderStatus } from '../components/ProviderStatus';
import {
  ConfigFields,
  RepoConfigForm,
  configFromDraft,
  draftFromConfig,
  useTimedOut,
  type DraftValue,
} from '../components/RepoConfigForm';
import {
  usePackages,
  usePackageSearchPaths,
  useRegisterRepository,
  useRemoveRepository,
  useRepositories,
} from '../query/hooks';

import '../components/Repositories.css';

/** Which repository's configuration is open. URL state, so the view is a link. */
const PARAM_REPOSITORY = 'repository';

interface Group {
  readonly packageId: string;
  readonly label: string;
  readonly installed: SdlcPackageSummary | undefined;
  readonly repositories: readonly Repository[];
}

function groupByDefinition(
  repositories: readonly Repository[],
  packages: ReadonlyMap<string, SdlcPackageSummary>,
): Group[] {
  const grouped = new Map<string, Repository[]>();
  for (const repository of repositories) {
    const bucket = grouped.get(repository.packageId);
    if (bucket === undefined) grouped.set(repository.packageId, [repository]);
    else bucket.push(repository);
  }

  return [...grouped]
    .map(([packageId, members]) => {
      const installed = packages.get(packageId);
      return {
        packageId,
        // The package's own name when it is installed. When it is not, the id it
        // was registered against — named rather than blanked, so the engineer can
        // see what is missing (Principle X).
        label: installed?.name ?? packageId,
        installed,
        repositories: [...members].sort((left, right) => left.name.localeCompare(right.name)),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function packageLabel(summary: SdlcPackageSummary | undefined, fallbackId: string): string {
  return summary === undefined ? fallbackId : `${summary.name} ${summary.version}`;
}

export default function Repositories(): ReactElement {
  const headingId = useId();
  const [params, setParams] = useSearchParams();
  const openId = params.get(PARAM_REPOSITORY) ?? '';

  const repositories = useRepositories();
  const packages = usePackages();
  // Read beside the package list, not after it comes back empty: the one screen
  // with nothing on it must not also wait on a second round trip.
  const searchPaths = usePackageSearchPaths();

  const listPending = repositories.isPending;
  const listTimedOut = useTimedOut(listPending);

  const packagesById = useMemo(
    () => new Map((packages.data ?? []).map((summary) => [summary.id, summary])),
    [packages.data],
  );
  const groups = useMemo(
    () => groupByDefinition(repositories.data ?? [], packagesById),
    [packagesById, repositories.data],
  );

  const setOpen = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      if (id === '') next.delete(PARAM_REPOSITORY);
      else next.set(PARAM_REPOSITORY, id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  let listing: ReactElement;

  if (listPending && !listTimedOut) {
    listing = (
      <p className="pending" role="status">
        Reading your registered repositories&hellip;
      </p>
    );
  } else if (listPending) {
    listing = (
      <ErrorState
        title="This is taking longer than it should"
        message="The registered repositories have not been read within ten seconds. Nothing has been changed."
        onRetry={() => void repositories.refetch()}
        retryLabel="Reload the repositories"
      />
    );
  } else if (repositories.isError) {
    listing = (
      <ErrorState
        title="The registered repositories could not be read"
        message={
          repositories.error instanceof Error
            ? repositories.error.message
            : 'The repository list failed for an unrecorded reason.'
        }
        onRetry={() => void repositories.refetch()}
        retryLabel="Reload the repositories"
      />
    );
  } else if (groups.length === 0) {
    listing = (
      <EmptyState
        title="No repositories registered yet"
        body="A repository is registered here, associated with one of the SDLC packages installed on this machine. Its work items then appear in the work item list."
        hint="Use the registration form below. No credentials are needed first — a provider asks for one only when the SDLC you choose requires it."
      />
    );
  } else {
    listing = (
      <div className="repos__groups">
        {groups.map((group) => (
          <section className="repo-group" key={group.packageId} aria-label={group.label}>
            <h2 className="repo-group__heading">{group.label}</h2>
            <p className="repo-group__meta">
              {group.repositories.length}{' '}
              {group.repositories.length === 1 ? 'repository follows' : 'repositories follow'} this
              SDLC.
              {group.installed === undefined
                ? ' Its package is not installed on this machine, so its lifecycle cannot be read.'
                : ` Installed version ${group.installed.version}.`}
            </p>
            <ul className="repo-group__list">
              {group.repositories.map((repository) => (
                <li key={repository.id}>
                  <RepositoryCard
                    repository={repository}
                    installed={group.installed}
                    groupLabel={group.label}
                    open={openId === repository.id}
                    onToggle={() => setOpen(openId === repository.id ? '' : repository.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <section className="repos" aria-labelledby={headingId}>
      <h1 className="repos__heading" id={headingId}>
        Repositories
      </h1>

      {listing}

      <RegisterRepository
        packages={packages.data ?? []}
        pending={packages.isPending}
        searchPaths={searchPaths.data ?? []}
      />

      <InstalledPackages packages={packages.data ?? []} pending={packages.isPending} />
    </section>
  );
}

// ── One repository ───────────────────────────────────────────────────────────

interface RepositoryCardProps {
  readonly repository: Repository;
  readonly installed: SdlcPackageSummary | undefined;
  readonly groupLabel: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}

function RepositoryCard({
  repository,
  installed,
  groupLabel,
  open,
  onToggle,
}: RepositoryCardProps): ReactElement {
  const cardId = useId();
  const panelId = `${cardId}-panel`;
  const headingId = `${cardId}-heading`;

  const statuses = useMemo(
    () => Object.values(repository.providerStatus),
    [repository.providerStatus],
  );

  /** The version the package now carries, when it differs from the one recorded (FR-043, FR-046). */
  const installedVersion =
    installed !== undefined && installed.version !== repository.packageVersion
      ? installed.version
      : null;

  return (
    <article className="repo" aria-labelledby={headingId}>
      <h3 className="repo__name" id={headingId}>
        {repository.name}
      </h3>

      <dl className="repo__facts">
        <div className="repo__fact">
          <dt>SDLC package</dt>
          <dd>
            {groupLabel} <span className="repo__version">version {repository.packageVersion}</span>
          </dd>
        </div>
        <div className="repo__fact">
          <dt>Path</dt>
          <dd>
            <code>{repository.path}</code>
          </dd>
        </div>
      </dl>

      {installedVersion === null ? null : (
        <p className="repo__note">
          This repository is recorded against version {repository.packageVersion}; the installed
          package is now version {installedVersion}.
        </p>
      )}

      {repository.availability === 'available' ? null : (
        <p className="repo__problem" role="alert">
          {repository.problem ??
            'This repository is not available. Its path or its SDLC package could not be read.'}
        </p>
      )}

      <button
        className="button"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {open ? `Close ${repository.name}` : `Configure ${repository.name}`}
      </button>

      <div className="repo__panel" id={panelId} hidden={!open}>
        {open ? (
          <>
            <ProviderStatus
              statuses={statuses}
              declaredKinds={installed?.providerKinds ?? []}
              repositoryName={repository.name}
            />

            {installed === undefined ? (
              <p className="repo__problem" role="alert">
                The {repository.packageId} package is not installed on this machine, so its settings
                cannot be listed or validated. Reinstall it, or remove this registration below.
              </p>
            ) : installed.supported ? (
              <RepoConfigForm
                key={repository.id}
                repository={repository}
                fields={installed.repoConfig}
                packageLabel={packageLabel(installed, repository.packageId)}
              />
            ) : (
              <p className="repo__problem" role="alert">
                {installed.problem ??
                  `The ${installed.name} package carries no readable lifecycle manifest.`}{' '}
                Until it does, this repository&rsquo;s settings cannot be listed — they are declared
                by the manifest, and are never inferred from the package&rsquo;s documentation.
              </p>
            )}

            <RemoveRepository repository={repository} />
          </>
        ) : null}
      </div>
    </article>
  );
}

// ── Removing a registration (FR-023) ─────────────────────────────────────────

function RemoveRepository({ repository }: { readonly repository: Repository }): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = useRemoveRepository();
  const timedOut = useTimedOut(remove.isPending);
  const waiting = remove.isPending && !timedOut;

  const onRemove = useCallback(() => {
    setProblem(null);
    remove.mutate(repository.id, {
      onSuccess: (result) => {
        if (!result.ok) setProblem(result.message);
      },
      onError: () =>
        setProblem('The registration could not be removed. Nothing was changed — you can try again.'),
    });
  }, [remove, repository.id]);

  return (
    <div className="repo__remove">
      <h4 className="repo__remove-heading">Remove this registration</h4>
      <p className="repo__remove-copy">
        Removing {repository.name} stops the dashboard reading it. Nothing in the repository itself
        is touched — the dashboard only ever reads it.
      </p>

      {problem === null ? null : (
        <p className="repo__problem" role="alert">
          {problem}
        </p>
      )}

      {timedOut && remove.isPending ? (
        <p className="repo__problem" role="alert">
          Removing the registration has not answered within ten seconds. You can try again.
        </p>
      ) : null}

      {confirming ? (
        <div className="repo__remove-actions">
          <button className="button button--small" type="button" onClick={onRemove} disabled={waiting}>
            {waiting ? 'Removing…' : `Yes, remove ${repository.name}`}
          </button>
          <button
            className="button button--quiet button--small"
            type="button"
            onClick={() => setConfirming(false)}
            disabled={waiting}
          >
            Keep it
          </button>
        </div>
      ) : (
        <button className="button button--small" type="button" onClick={() => setConfirming(true)}>
          Remove {repository.name}
        </button>
      )}
    </div>
  );
}

// ── Registration (FR-023, FR-045, SC-004) ────────────────────────────────────

interface PackageListProps {
  readonly packages: readonly SdlcPackageSummary[];
  readonly pending: boolean;
}

interface RegisterRepositoryProps extends PackageListProps {
  /**
   * The directories discovery scanned. Only ever rendered when it found nothing,
   * which is precisely when "none found" would otherwise be unactionable.
   */
  readonly searchPaths: readonly string[];
}

function RegisterRepository({ packages, pending, searchPaths }: RegisterRepositoryProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const nameId = `${idPrefix}-name`;
  const pathId = `${idPrefix}-path`;
  const packageId = `${idPrefix}-package`;
  const packageNoteId = `${idPrefix}-package-note`;

  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [problem, setProblem] = useState<{ field: string | null; message: string } | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);

  const register = useRegisterRepository();
  const timedOut = useTimedOut(register.isPending);
  const waiting = register.isPending && !timedOut;

  const selected = packages.find((summary) => summary.id === selectedId);
  const fields: readonly ConfigFieldPayload[] = selected?.supported === true ? selected.repoConfig : [];

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setProblem(null);
      setRegistered(null);
      const chosen = packages.find((summary) => summary.id === id);
      // The declarations are the form: choosing a package regenerates the fields
      // from whatever that package declares, seeded with its own defaults.
      setDraft(
        chosen === undefined || !chosen.supported ? {} : draftFromConfig(chosen.repoConfig, {}),
      );
    },
    [packages],
  );

  const onChangeField = useCallback((key: string, value: DraftValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setRegistered(null);

      if (selected === undefined) {
        setProblem({
          field: 'packageId',
          message: 'Choose the SDLC package this repository follows.',
        });
        return;
      }
      if (!selected.supported) {
        // Refused here as well as in the main process, so the refusal is stated
        // where the engineer is looking (FR-045).
        setProblem({
          field: 'packageId',
          message: `${selected.name} declares no readable lifecycle, so a repository cannot be associated with it.`,
        });
        return;
      }

      setProblem(null);
      register.mutate(
        {
          name,
          path,
          packageId: selected.id,
          config: configFromDraft(fields, draft),
        },
        {
          onSuccess: (result) => {
            if (!result.ok) {
              setProblem({ field: result.field ?? null, message: result.message });
              return;
            }
            setRegistered(result.value.name);
            setName('');
            setPath('');
            setSelectedId('');
            setDraft({});
          },
          onError: () =>
            setProblem({
              field: null,
              message:
                'The registration could not be sent. Nothing was registered — you can try again.',
            }),
        },
      );
    },
    [draft, fields, name, path, register, selected],
  );

  const declaredKeys = new Set(fields.map((field) => field.key));
  const fieldProblem =
    problem !== null && problem.field !== null && declaredKeys.has(problem.field)
      ? { key: problem.field, message: problem.message }
      : null;
  const problemFor = (field: string): string | null =>
    problem !== null && problem.field === field ? problem.message : null;
  const formProblem =
    problem !== null &&
    fieldProblem === null &&
    problem.field !== 'name' &&
    problem.field !== 'path' &&
    problem.field !== 'packageId'
      ? problem.message
      : null;

  const unsupportedNote =
    selected !== undefined && !selected.supported
      ? `${selected.name} is unsupported: ${
          selected.problem ?? 'it carries no lifecycle manifest.'
        } A repository cannot be associated with it, and its lifecycle is not inferred from its skills or documentation. Install a package that carries a manifest, or fix this one.`
      : null;

  const packageProblem = problemFor('packageId');
  const packageDescribedBy = [
    packageNoteId,
    unsupportedNote === null && packageProblem === null ? null : `${packageId}-problem`,
  ]
    .filter((id): id is string => id !== null)
    .join(' ');

  // ── Two cases that never reach the form ───────────────────────────────────
  //
  // Neither renders one, because a form that cannot be submitted is the inert
  // control FR-034a's discipline rejects: where the thing is actually done gets
  // said instead. The second case is the more important of the two — it is the
  // literal first run for anyone who has not installed a package into one of the
  // three default locations, and Principle I requires an *actionable* prompt
  // there rather than a statement of fact the engineer can do nothing with.

  if (pending) {
    return (
      <section className="register" aria-labelledby={headingId}>
        <h2 className="register__heading" id={headingId}>
          Register a repository
        </h2>
        <p className="pending" role="status">
          Looking for the SDLC packages installed on this machine&hellip;
        </p>
      </section>
    );
  }

  if (packages.length === 0) {
    return (
      <section className="register" aria-labelledby={headingId}>
        <h2 className="register__heading" id={headingId}>
          Register a repository
        </h2>

        {/* Calm and short: this is the normal first run, not a failure, so it is
            announced as status and carries none of the failure styling. */}
        <div className="register__none" role="status">
          <p className="register__none-lead">
            No SDLC packages were found on this machine. A repository is registered against the
            agent package that carries its lifecycle, so there is nothing yet to register one
            against. Nothing here is broken.
          </p>

          {searchPaths.length === 0 ? (
            // Principle X: a deliberate nothing rather than an empty list.
            <p className="register__none-lead">
              Where it looked has not been reported, so the directories above cannot be listed.
            </p>
          ) : (
            <>
              <p className="register__none-lead">It looked in:</p>
              <ul className="register__roots">
                {searchPaths.map((root) => (
                  <li key={root}>
                    <code className="register__root">{root}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="register__none-lead">
            Install an agent package carrying a lifecycle manifest into one of those directories,
            or set <code className="register__root">SDLC_PACKAGE_PATHS</code> to the directories to
            search instead — separated by this platform&rsquo;s path separator — and reopen this
            view.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="register" aria-labelledby={headingId}>
      <h2 className="register__heading" id={headingId}>
        Register a repository
      </h2>

      <form className="register__form" onSubmit={onSubmit} noValidate>
        <div className="register__field">
          <label className="register__label" htmlFor={nameId}>
            Name
          </label>
          <input
            className="register__control"
            id={nameId}
            type="text"
            value={name}
            aria-required
            aria-invalid={problemFor('name') !== null}
            aria-describedby={problemFor('name') === null ? undefined : `${nameId}-problem`}
            onChange={(event) => setName(event.target.value)}
          />
          {problemFor('name') === null ? null : (
            <p className="register__error" id={`${nameId}-problem`} role="alert">
              {problemFor('name')}
            </p>
          )}
        </div>

        <div className="register__field">
          <label className="register__label" htmlFor={pathId}>
            Path on this machine
          </label>
          <input
            className="register__control"
            id={pathId}
            type="text"
            value={path}
            aria-required
            aria-invalid={problemFor('path') !== null}
            aria-describedby={problemFor('path') === null ? undefined : `${pathId}-problem`}
            onChange={(event) => setPath(event.target.value)}
          />
          {problemFor('path') === null ? null : (
            <p className="register__error" id={`${pathId}-problem`} role="alert">
              {problemFor('path')}
            </p>
          )}
        </div>

        <div className="register__field">
          <label className="register__label" htmlFor={packageId}>
            SDLC package
          </label>
          <select
            className="register__control"
            id={packageId}
            value={selectedId}
            aria-required
            aria-invalid={unsupportedNote !== null || packageProblem !== null}
            aria-describedby={packageDescribedBy}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Choose a package</option>
            {packages.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.name} {summary.version}
                {summary.supported ? '' : ' — unsupported'}
              </option>
            ))}
          </select>
          <p className="register__hint" id={packageNoteId}>
            The lifecycle comes from the package&rsquo;s own manifest, and the version you choose is
            recorded with the registration.
          </p>
          {unsupportedNote === null && packageProblem === null ? null : (
            <p className="register__error" id={`${packageId}-problem`} role="alert">
              {unsupportedNote ?? packageProblem}
            </p>
          )}
        </div>

        {selected === undefined || !selected.supported ? null : (
          <div className="register__config">
            <h3 className="register__config-heading">Settings {selected.name} requires</h3>
            <ConfigFields
              fields={fields}
              draft={draft}
              onChange={onChangeField}
              invalid={fieldProblem}
              idPrefix={`${idPrefix}-config`}
              disabled={waiting}
            />
          </div>
        )}

        {formProblem === null ? null : (
          <p className="register__error" role="alert">
            {formProblem}
          </p>
        )}

        {timedOut && register.isPending ? (
          <p className="register__error" role="alert">
            The registration has not answered within ten seconds. Nothing has been registered — you
            can try again.
          </p>
        ) : null}

        {registered === null ? null : (
          <p className="register__done" role="status">
            {registered} is registered. Its items appear in{' '}
            <Link to="/">the work item list</Link> as they are reconciled.
          </p>
        )}

        <button
          className="button button--primary"
          type="submit"
          disabled={waiting || packages.length === 0 || unsupportedNote !== null}
        >
          {waiting ? 'Registering…' : 'Register repository'}
        </button>
      </form>
    </section>
  );
}

// ── What is installed (FR-042, FR-045) ───────────────────────────────────────

/**
 * T032 (004) — whether this lifecycle can ever let work go (FR-010, FR-011, FR-014).
 *
 * Two conditions, both silent until now and both making an engineer's list wrong
 * in a way nothing else would explain:
 *
 *   **No terminal state.** Nothing this lifecycle tracks is ever finished, so its
 *   items accumulate in the active list forever. The symptom is a long list,
 *   which looks like being busy.
 *
 *   **Every state terminal.** The mirror, and just as broken: its items are
 *   finished the moment they appear and never show as active at all.
 *
 * This is a **report, not a refusal**. The package still loads, the repository
 * still registers, and its items are still tracked — 001's FR-045 set the
 * precedent by reporting an unsupported package rather than failing, and this
 * product reports rather than refuses (FR-012). It also says the correction
 * belongs in the package, because nothing here can edit a manifest and offering
 * to would be a lie.
 *
 * Note what this component does *not* do: it names no state. It compares two
 * counts the main process derived, which is why the lint rule forbidding
 * lifecycle vocabulary in the renderer still passes (FR-020, Principle II).
 */
function PackageRelease({ summary }: { readonly summary: SdlcPackageSummary }): ReactElement | null {
  if (summary.stateCount === 0) return null;

  if (summary.terminalStateCount === 0) {
    return (
      <p className="packages__release" role="status">
        <span className="tag tag--advisory">Never finishes</span>{' '}
        <span>
          {summary.name} declares no final state, so nothing following it is ever finished and its
          work items never leave the active list. Mark the lifecycle&rsquo;s last state as terminal
          in the package itself — this application reads that declaration and cannot supply it.
        </span>
      </p>
    );
  }

  if (summary.terminalStateCount === summary.stateCount) {
    return (
      <p className="packages__release" role="status">
        <span className="tag tag--advisory">Finishes instantly</span>{' '}
        <span>
          Every state {summary.name} declares is final, so its work items count as finished the
          moment they appear and never show as active. If that is not intended, the package is
          marking more states terminal than it means to.
        </span>
      </p>
    );
  }

  return null;
}

function InstalledPackages({ packages, pending }: PackageListProps): ReactElement {
  const headingId = useId();

  return (
    <section className="packages" aria-labelledby={headingId}>
      <h2 className="packages__heading" id={headingId}>
        Installed SDLC packages
      </h2>

      {pending ? (
        <p className="pending" role="status">
          Looking for installed SDLC packages&hellip;
        </p>
      ) : packages.length === 0 ? (
        <p className="packages__none">
          None found. The dashboard reads a lifecycle from the agent package that executes it, so a
          repository can only be registered once such a package is installed.
        </p>
      ) : (
        <ul className="packages__list">
          {packages.map((summary) => (
            <li className="packages__item" key={summary.id}>
              <p className="packages__name">
                <span className="packages__title">{summary.name}</span>
                <span className="packages__version">version {summary.version}</span>
                <span
                  className={
                    summary.supported ? 'tag packages__state' : 'tag packages__state packages__state--unsupported'
                  }
                >
                  {summary.supported ? 'Usable' : 'Unsupported'}
                </span>
              </p>
              <p className="packages__where">
                <code>{summary.path}</code>
              </p>
              {summary.supported ? (
                <>
                  <p className="packages__detail">
                    {summary.stateCount} declared {summary.stateCount === 1 ? 'state' : 'states'},
                    one entry per {summary.unit}. Manifest contract version{' '}
                    {summary.contractVersion}.
                  </p>
                  <PackageRelease summary={summary} />
                </>
              ) : (
                <p className="packages__problem" role="alert">
                  {summary.problem ?? 'It carries no readable lifecycle manifest.'}
                  {summary.problemField === null ? '' : ` Field: ${summary.problemField}.`}
                  {summary.problemLine === null ? '' : ` Line ${summary.problemLine}.`} No repository
                  can be associated with it until that is fixed; its lifecycle is never guessed from
                  its documentation.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
