/**
 * T064, T077 — the `listItems` and `getItem` channels.
 *
 * Both are registered through `validated(...)`, so the request is parsed on
 * receipt and the reply is parsed before it is sent: the renderer is an untrusted
 * producer to this process, and this process's replies carry provider data that
 * was itself untrusted (ipc-surface.md rule 2, Principle IX).
 *
 * Nothing here names a state, a gate, or a provider. Every label the renderer
 * shows is read out of the loaded definition, which is what lets the detail view
 * render a lifecycle this build has never seen (FR-016, SC-003).
 *
 * Two requirements worth pointing at directly:
 *
 *   - **Attention first** (FR-008). `attentionFirst` is stable, so the recency
 *     ordering underneath survives within each group.
 *   - **Every gate, always** (FR-014). A state's gate that produced no result is
 *     materialised as `not_evaluated` rather than omitted, because a consumer that
 *     sees an absent gate could read the absence as a pass.
 */

import { attentionFirst } from '@core/engine/attention.js';
import { gateResultFor, materialiseGateResult } from '@core/engine/evaluateGate.js';
import { deriveProgress } from '@core/engine/progress.js';
import {
  findState,
  type ArtifactDecl,
  type GateDecl,
  type Locator,
  type SdlcDefinition,
  type State,
} from '@core/model/declared.js';
import {
  CHANNELS,
  getItemReplySchema,
  itemFilterSchema,
  itemKeyArgSchema,
  listItemsReplySchema,
  type ItemFilter,
} from '@core/ipc/schema.js';
import {
  isUnmapped,
  type ArtifactRef,
  type GateResult,
  type GateView,
  type StateView,
  type WorkItemDetail,
  type WorkItemSummary,
} from '@core/model/observed.js';
import { ok, type Result } from '@core/model/result.js';

import { gateProviderId } from '../reconcile/assemble.js';
import type { ItemContext, Reconciler } from '../reconcile/index.js';

import {
  invalidRequestEmpty,
  invalidRequestResult,
  validated,
  type RegisteredChannel,
} from './validate.js';

export interface ItemHandlerDeps {
  readonly reconciler: Reconciler;
}

export interface ItemHandlers {
  listItems(filter: ItemFilter): Promise<WorkItemSummary[]>;
  getItem(args: { key: string }): Promise<Result<WorkItemDetail>>;
  readonly channels: readonly RegisteredChannel[];
}

export function createItemHandlers(deps: ItemHandlerDeps): ItemHandlers {
  const listItems = async (filter: ItemFilter): Promise<WorkItemSummary[]> => {
    const matching = deps.reconciler.items().filter((entry) => matches(entry, filter));

    // Most recently reconciled first, then attention-first on top of it. The
    // second pass is stable, so recency survives inside each group (FR-008).
    const byRecency = [...matching].sort((left, right) =>
      right.item.reconciledAt.localeCompare(left.item.reconciledAt),
    );

    return attentionFirst(byRecency, (entry) => entry.item.attention).map(toSummary);
  };

  const getItem = async (args: { key: string }): Promise<Result<WorkItemDetail>> => {
    const found = await deps.reconciler.detail(args.key);
    if (!found.ok) return found;
    return ok(toDetail(found.value));
  };

  const channels: RegisteredChannel[] = [
    {
      channel: CHANNELS.listItems,
      invoke: validated(
        CHANNELS.listItems,
        itemFilterSchema.default({}),
        listItemsReplySchema,
        listItems,
        invalidRequestEmpty<WorkItemSummary>,
      ),
    },
    {
      channel: CHANNELS.getItem,
      invoke: validated(
        CHANNELS.getItem,
        itemKeyArgSchema,
        getItemReplySchema,
        getItem,
        invalidRequestResult<WorkItemDetail>,
      ),
    },
  ];

  return { listItems, getItem, channels };
}

// ── Filtering ────────────────────────────────────────────────────────────────

/**
 * FR-004's four filters, plus the one rule that is not a filter: an item resting
 * in a state the manifest declares `terminal` has left the active list
 * (data-model.md, 001's FR-001).
 *
 * **004 gave that rule a way out that an interface can actually reach.** The
 * original escape — naming the state explicitly — is still here and still works,
 * but it was unreachable in practice: the list asks with no filter, so terminal
 * items never arrived, and the state options are built from the items that did.
 * A terminal state could therefore never be offered as a choice. `includeTerminal`
 * is the handle that escape hatch was missing.
 */
function matches(entry: ItemContext, filter: ItemFilter): boolean {
  const { item, repository } = entry;

  if (filter.repositoryId !== undefined && item.repositoryId !== filter.repositoryId) return false;
  if (filter.packageId !== undefined && item.packageId !== filter.packageId) return false;
  if (filter.stateId !== undefined && item.stateId !== filter.stateId) return false;

  if (
    filter.includeTerminal !== true &&
    filter.stateId === undefined &&
    isTerminal(repository.definition, entry)
  ) {
    return false;
  }

  const search = filter.search?.trim().toLowerCase();
  if (search !== undefined && search !== '') {
    // Identifier or title (FR-004). The raw recorded value is searched too, so an
    // unmapped item is findable by what its system of record actually says.
    const haystack = `${item.key}\n${item.title}\n${item.rawState}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  return true;
}

/**
 * Whether the lifecycle considers this item finished (004).
 *
 * The two `false` cases are not defensive padding, they are the requirement.
 * An **unmapped** item has no declared state to consult (FR-015), and a
 * repository whose **definition failed to load** cannot answer for any of its
 * items (FR-016). Both resolve to "not finished", which is the answer that keeps
 * the work visible — the application does not act on what it cannot prove
 * (Principle X).
 *
 * This is the only place the question is asked. `matches` uses it to decide what
 * to return and `toSummary` uses it to tell the renderer; nothing downstream
 * evaluates it again (plan.md §Structure Decision).
 */
function isTerminal(definition: SdlcDefinition | null, entry: ItemContext): boolean {
  if (definition === null || isUnmapped(entry.item.stateId)) return false;
  return findState(definition, entry.item.stateId)?.terminal === true;
}

// ── Projection ───────────────────────────────────────────────────────────────

/** FR-002: identifier, title, the SDLC it follows, its state, and when it was reconciled. */
export function toSummary(entry: ItemContext): WorkItemSummary {
  const { item, repository } = entry;
  const state =
    repository.definition === null || isUnmapped(item.stateId)
      ? undefined
      : findState(repository.definition, item.stateId);

  return {
    key: item.key,
    title: item.title,
    repositoryId: item.repositoryId,
    repositoryName: repository.repository.name,
    packageId: item.packageId,
    sdlcName: repository.pkg?.name ?? item.packageId,
    unit: item.unit,
    stateId: item.stateId,
    // Null rather than a guess: an unmapped item shows its raw value instead (FR-005).
    stateName: state?.name ?? null,
    rawState: item.rawState,
    attention: item.attention,
    reconciledAt: item.reconciledAt,
    freshness: item.freshness,
    // Surfaced, not hidden (spec §Edge Cases, "Two providers disagree").
    disagreements: item.disagreements,
    // 004. Asked of the repository's own definition, on every projection, and
    // recorded nowhere. The renderer is told; it never works this out itself.
    terminal: isTerminal(repository.definition, entry),
  };
}

export function toDetail(entry: ItemContext): WorkItemDetail {
  const { item, repository } = entry;
  const definition = repository.definition;
  const summary = toSummary(entry);

  if (definition === null) {
    // No manifest, so no states to present. The repository's own `problem` says
    // what is missing (FR-045); the item is still listed with its raw value.
    return { item: summary, states: [], currentStateId: null };
  }

  const progress = deriveProgress(definition, item.stateId, item.gateResults);

  const states: StateView[] = definition.states.map((state) => ({
    id: state.id,
    name: state.name,
    description: state.description ?? null,
    ordinal: state.ordinal,
    progress: progress.get(state.id) ?? 'not_reached',
    awaitsHuman: state.awaitsHuman,
    terminal: state.terminal,
    gates: state.gates.map((gate) => toGateView(definition, gate, item.gateResults)),
    artifacts: state.artifacts.map(toArtifactRef),
  }));

  return {
    item: summary,
    states,
    // FR-012: the view opens on the state the item occupies. Null when the item is
    // unmapped, because no state is occupied and opening on a nearby one would be
    // the guess FR-005 forbids.
    currentStateId: currentStateOf(definition, entry),
  };
}

function currentStateOf(definition: SdlcDefinition, entry: ItemContext): string | null {
  if (isUnmapped(entry.item.stateId)) return null;
  const state = findState(definition, entry.item.stateId);
  return state === undefined ? null : state.id;
}

function toArtifactRef(decl: ArtifactDecl): ArtifactRef {
  return {
    id: decl.id,
    name: decl.name,
    kind: decl.kind,
    provider: decl.provider,
    required: decl.required,
  };
}

function toGateView(
  definition: SdlcDefinition,
  decl: GateDecl,
  results: readonly GateResult[],
): GateView {
  // Every declared gate produces a result. A gate nothing was recorded for is
  // `not_evaluated`, never omitted and never defaulted to passed (FR-014).
  const result = gateResultFor(results, decl.id) ?? materialiseGateResult(decl, undefined);

  return {
    id: decl.id,
    name: decl.name,
    kind: decl.kind,
    blocking: decl.blocking,
    awaitsHuman: decl.awaitsHuman,
    result,
    actionLocation: actionLocationFor(definition, decl, result),
  };
}

/**
 * FR-034a: where the action is performed, when one is owed.
 *
 * v1.0 is read-only with respect to every system of record (FR-034), and the
 * read-only posture has to be *legible* rather than implicit — an interface that
 * showed an "Approve" button doing nothing would be worse than one that says
 * where the approval is actually recorded. So this returns a sentence naming the
 * provider and the locator the manifest declares, and `null` when nothing is
 * owed.
 *
 * Nothing here is hardcoded per gate kind: the location is read out of the
 * declaration, which is what keeps it correct for a lifecycle this build has
 * never seen.
 */
export function actionLocationFor(
  definition: SdlcDefinition,
  decl: GateDecl,
  result: GateResult,
): string | null {
  // A passing gate owes nothing. `failed` and `not_evaluated` both do: one needs
  // fixing, the other needs recording.
  if (result.status === 'passed') return null;

  const providerId = gateProviderId(definition, decl);
  // Evidence first: for a gate whose decision a human records, that locator *is*
  // the place the action happens.
  const where = locatorText(decl.evidence) ?? locatorText(decl.locator);

  if (providerId === undefined) {
    if (where === null) {
      return `${decl.name} is not recorded anywhere this lifecycle declares, so this dashboard cannot say where it is decided.`;
    }
    return `${decl.name} is recorded at ${where}. This dashboard reads it; the action is performed there.`;
  }

  const place =
    where === null ? `the '${providerId}' provider` : `the '${providerId}' provider, at ${where}`;

  return `${decl.name} is recorded in ${place}. This dashboard reads it; the action is performed there.`;
}

/** The declared location, in whichever of the locator's forms the manifest used. */
function locatorText(locator: Locator | undefined): string | null {
  if (locator === undefined) return null;
  if (locator.path !== undefined && locator.path !== '') return locator.path;
  if (locator.check !== undefined && locator.check !== '') return `check '${locator.check}'`;
  if (locator.field !== undefined && locator.field !== '') return `field '${locator.field}'`;
  if (locator.run !== undefined && locator.run !== '') return `run '${locator.run}'`;
  return null;
}

/** Exported for the console, which reports gate results as part of its context (FR-031). */
export function stateViewFor(
  definition: SdlcDefinition,
  state: State,
  results: readonly GateResult[],
): { gates: GateView[]; artifacts: ArtifactRef[] } {
  return {
    gates: state.gates.map((gate) => toGateView(definition, gate, results)),
    artifacts: state.artifacts.map(toArtifactRef),
  };
}
