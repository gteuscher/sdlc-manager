/**
 * T104, T105 — the repository configuration form, generated from the package's
 * own `repo_config` declarations (FR-024, FR-025).
 *
 * ## Why there is no hand-written form in here
 *
 * Nothing in this file knows the name of a single setting. `fields` arrives as
 * the declarations the loaded manifest carried — `key`, `title`, `type`,
 * `required`, `default`, `description` — and every input, label, hint, and
 * coercion is derived from one of those six values. A lifecycle that declares a
 * setting this application has never seen renders an input for it with no change
 * here, which is Principle II applied to configuration and what SC-003 measures.
 *
 * The gates a definition declares as `configurable: true` reach this form the
 * same way everything else does: as `repo_config` entries whose `key` targets the
 * gate (`gates.<id>.<setting>` in sdlc-manifest.md §3). So they are listed with
 * their current setting for this repository — acceptance scenario 2 — without
 * this component having a concept of a gate at all. The declared key is shown
 * beside each control, because it is the only thing that says *what* a setting
 * reaches when the title alone is ambiguous.
 *
 * ## Where validation lives, and why not here
 *
 * The manifest's owner validates. This form coerces a control's value to the
 * declared type where it can (a checkbox to a boolean, a numeric entry to a
 * number) and sends what it could not coerce **as typed**, so the rejection comes
 * back from the one place that holds the declarations, naming the field and the
 * reason. Re-implementing those rules here would put a second, drifting copy of
 * them in the renderer.
 *
 * A rejection is rendered against the offending input — `aria-invalid` plus an
 * `aria-describedby` error that is announced rather than only seen (Principle XI)
 * — and the prior configuration is retained: the save is refused before anything
 * is written, so what the repository still uses is what it used before (FR-025).
 * The form says so in words, because "nothing was saved" is not obvious from a
 * screen that still shows the text you typed.
 *
 * ## State
 *
 * The draft is local (Principle XIII). It is seeded from the saved configuration
 * at mount and never synchronised by an effect — the route remounts this form per
 * repository with a `key`, so switching repositories cannot leak one repository's
 * half-typed draft into another's form.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import type { ConfigFieldPayload } from '@core/ipc/schema';
import type { Repository } from '@core/model/observed';

import { REQUEST_CEILING_MS } from '../query/client';
import { useUpdateRepositoryConfig } from '../query/hooks';

/** What a control holds while it is being edited: text for typed entry, a flag for a checkbox. */
export type DraftValue = string | boolean;
export type ConfigDraft = Readonly<Record<string, DraftValue>>;

/** A save that named one field, so it can be rendered against that input rather than as a banner. */
export interface FieldProblem {
  readonly key: string;
  readonly message: string;
}

/**
 * Principle X, applied to a mutation: a pending state that can never end is the
 * spinner without a timeout the constitution forbids. Ten seconds is the default
 * ceiling; past it the caller renders the wait as a failure with the action still
 * available, rather than leaving a disabled button on screen forever.
 *
 * It lives beside the first form that needed it rather than in a module of its
 * own, and the two other forms in this story import it from here.
 */
export function useTimedOut(pending: boolean, ceilingMs = REQUEST_CEILING_MS): boolean {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), ceilingMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending, ceilingMs]);

  return timedOut;
}

/**
 * Seeds a draft from what the repository has saved, falling back to the
 * declaration's own default so the form opens showing the setting that is
 * actually in effect rather than an empty box.
 */
export function draftFromConfig(
  fields: readonly ConfigFieldPayload[],
  config: Readonly<Record<string, unknown>>,
): Record<string, DraftValue> {
  const draft: Record<string, DraftValue> = {};
  for (const field of fields) {
    const saved = Object.prototype.hasOwnProperty.call(config, field.key)
      ? config[field.key]
      : field.default;
    if (field.type === 'boolean') {
      draft[field.key] = saved === true;
    } else {
      draft[field.key] = saved === undefined || saved === null ? '' : String(saved);
    }
  }
  return draft;
}

/**
 * Turns a draft back into the configuration object the bridge takes.
 *
 * An empty entry is omitted rather than stored as `""`, so "not set" and "set to
 * nothing" stay distinguishable — a required field left empty is then rejected by
 * name, which is the behaviour FR-025 describes. A numeric entry that is not a
 * number is passed through **as typed**: the declaration's owner rejects it and
 * names it, and this form does not invent a second rule for the same field.
 */
export function configFromDraft(
  fields: readonly ConfigFieldPayload[],
  draft: ConfigDraft,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = draft[field.key];
    if (field.type === 'boolean') {
      config[field.key] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text === '') continue;
    if (field.type === 'number') {
      const parsed = Number(text);
      config[field.key] = Number.isFinite(parsed) ? parsed : text;
      continue;
    }
    config[field.key] = text;
  }
  return config;
}

export interface ConfigFieldsProps {
  readonly fields: readonly ConfigFieldPayload[];
  readonly draft: ConfigDraft;
  readonly onChange: (key: string, value: DraftValue) => void;
  /** The field the last save was rejected for, when the caller can match it to a declaration. */
  readonly invalid: FieldProblem | null;
  /** Prefix for generated element ids, so two forms on one page do not collide. */
  readonly idPrefix: string;
  readonly disabled?: boolean;
}

/**
 * The generated controls, with no save of their own.
 *
 * Separate from the form below because registration needs the same generated
 * inputs before a repository exists to save them against — one generator, used
 * in both places, so the two can never disagree about what a declaration renders
 * as.
 */
export function ConfigFields({
  fields,
  draft,
  onChange,
  invalid,
  idPrefix,
  disabled = false,
}: ConfigFieldsProps): ReactElement {
  if (fields.length === 0) {
    return (
      <p className="config__none">
        This SDLC package declares no per-repository settings, so there is nothing to configure
        here.
      </p>
    );
  }

  return (
    <div className="config__fields">
      {fields.map((field, index) => {
        const inputId = `${idPrefix}-field-${index}`;
        const keyId = `${inputId}-key`;
        const descriptionId = `${inputId}-description`;
        const errorId = `${inputId}-error`;
        const problem = invalid !== null && invalid.key === field.key ? invalid : null;
        const describedBy = [
          keyId,
          field.description === undefined ? null : descriptionId,
          problem === null ? null : errorId,
        ]
          .filter((id): id is string => id !== null)
          .join(' ');

        const value = draft[field.key];
        const checked = value === true;
        const text = typeof value === 'string' ? value : '';

        return (
          <div className="config__field" key={field.key}>
            <label className="config__label" htmlFor={inputId}>
              {field.title}
              {field.required ? <span className="config__required"> (required)</span> : null}
            </label>

            {field.type === 'boolean' ? (
              <input
                className="config__control config__control--flag"
                id={inputId}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                aria-describedby={describedBy}
                aria-invalid={problem !== null}
                onChange={(event) => onChange(field.key, event.target.checked)}
              />
            ) : (
              <input
                className="config__control"
                id={inputId}
                type={field.type === 'number' ? 'number' : 'text'}
                value={text}
                disabled={disabled}
                aria-required={field.required}
                aria-describedby={describedBy}
                aria-invalid={problem !== null}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            )}

            <p className="config__key" id={keyId}>
              Setting <code>{field.key}</code>
              {field.default === undefined ? null : (
                <span className="config__default">
                  {' '}
                  · package default <code>{String(field.default)}</code>
                </span>
              )}
            </p>

            {field.description === undefined ? null : (
              <p className="config__description" id={descriptionId}>
                {field.description}
              </p>
            )}

            {problem === null ? null : (
              <p className="config__error" id={errorId} role="alert">
                {problem.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface RepoConfigFormProps {
  readonly repository: Repository;
  /** The declarations the repository's package carried. Empty when it declares none. */
  readonly fields: readonly ConfigFieldPayload[];
  /** Announced beside the heading, so the form says whose declarations it is showing. */
  readonly packageLabel: string;
}

export function RepoConfigForm({
  repository,
  fields,
  packageLabel,
}: RepoConfigFormProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;

  const saved = useMemo(() => draftFromConfig(fields, repository.config), [fields, repository.config]);
  const [draft, setDraft] = useState<Record<string, DraftValue>>(saved);
  const [problem, setProblem] = useState<{ field: string | null; message: string } | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const update = useUpdateRepositoryConfig();
  const timedOut = useTimedOut(update.isPending);

  const declaredKeys = useMemo(() => new Set(fields.map((field) => field.key)), [fields]);
  const dirty = useMemo(
    () => fields.some((field) => draft[field.key] !== saved[field.key]),
    [draft, fields, saved],
  );

  const onChange = useCallback((key: string, value: DraftValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSavedMessage(null);
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setProblem(null);
      setSavedMessage(null);

      update.mutate(
        { id: repository.id, config: configFromDraft(fields, draft) },
        {
          onSuccess: (result) => {
            if (result.ok) {
              setSavedMessage('Configuration saved. It takes effect on the next reconciliation.');
              return;
            }
            setProblem({ field: result.field ?? null, message: result.message });
          },
          onError: () => {
            setProblem({
              field: null,
              message:
                'The configuration could not be sent for saving. Nothing was changed — you can try again.',
            });
          },
        },
      );
    },
    [draft, fields, repository.id, update],
  );

  const onDiscard = useCallback(() => {
    setDraft(saved);
    setProblem(null);
    setSavedMessage(null);
  }, [saved]);

  // A named field this form actually renders goes against that input; anything
  // else — an id, a package that has been uninstalled — is a form-level failure
  // with the save still available as its retry (Principle X).
  const fieldProblem: FieldProblem | null =
    problem !== null && problem.field !== null && declaredKeys.has(problem.field)
      ? { key: problem.field, message: problem.message }
      : null;
  const formProblem = problem !== null && fieldProblem === null ? problem.message : null;

  const waiting = update.isPending && !timedOut;

  return (
    <form className="config" onSubmit={onSubmit} aria-labelledby={headingId} noValidate>
      <h4 className="config__heading" id={headingId}>
        Configuration
      </h4>
      <p className="config__source">
        These settings are the ones {packageLabel} declares for a repository that adopts it.
      </p>

      <ConfigFields
        fields={fields}
        draft={draft}
        onChange={onChange}
        invalid={fieldProblem}
        idPrefix={idPrefix}
        disabled={waiting}
      />

      {problem === null ? null : (
        <p className="config__retained" role="alert">
          {formProblem === null ? 'The configuration was not saved.' : formProblem} The previous
          configuration is still in effect for {repository.name}.
        </p>
      )}

      {timedOut && update.isPending ? (
        <p className="config__retained" role="alert">
          The save has not answered within ten seconds. Nothing has been changed yet — you can try
          again.
        </p>
      ) : null}

      {savedMessage === null ? null : (
        <p className="config__saved" role="status">
          {savedMessage}
        </p>
      )}

      {fields.length === 0 ? null : (
        <div className="config__actions">
          <button className="button button--primary" type="submit" disabled={waiting}>
            {waiting ? 'Saving…' : 'Save configuration'}
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={onDiscard}
            disabled={!dirty || waiting}
          >
            Discard changes
          </button>
        </div>
      )}
    </form>
  );
}
