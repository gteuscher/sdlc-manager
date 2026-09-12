/**
 * T012 — the declared family (data-model.md).
 *
 * Everything here is read from an SDLC package's `sdlc.yaml` and is immutable for
 * a given package version. Nothing in the observed family may contribute a state,
 * gate, or artifact that this family did not define; that asymmetry is the
 * data-model expression of Principle II.
 *
 * These are plain types. No Electron, no React, no Node.
 */

export type ProviderId = string;

/**
 * Deliberately `string` rather than a union of the kinds shipped today.
 *
 * Principle VI requires that adding a provider not change the engine, and a
 * closed union here would make every new provider kind a change to core. The
 * manifest reader accepts any kind; the main-process provider factory is what
 * decides whether a kind is one it can construct, and reports an unknown kind by
 * name (FR-026) rather than rejecting the whole manifest.
 */
export type ProviderKind = string;

export interface ProviderDecl {
  readonly id: ProviderId;
  readonly kind: ProviderKind;
  /** Provider-specific settings, validated by the adapter, not by core (sdlc-manifest.md §3). */
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * Where a provider should look. Which fields are meaningful depends on the
 * provider and the artifact or gate kind; core does not interpret them.
 * `path`, `field`, `run`, and `check` all support `{item.<field>}` templating.
 */
export interface Locator {
  readonly provider?: ProviderId;
  readonly path?: string;
  readonly field?: string;
  readonly run?: string;
  readonly check?: string;
}

/** The condition a `field` or `artifact` gate passes under. */
export type Condition =
  | { readonly equals: unknown }
  | { readonly notEquals: unknown }
  | { readonly oneOf: readonly unknown[] }
  | { readonly matches: string }
  | { readonly present: true }
  | { readonly absent: true };

export type GateKind = 'manual' | 'artifact' | 'check' | 'field';

export interface GateDecl {
  readonly id: string;
  readonly name: string;
  readonly kind: GateKind;
  /** Default true. A non-blocking gate is reported but does not stall the item. */
  readonly blocking: boolean;
  /** Default false. True means a failed or unevaluated result is waiting on the engineer. */
  readonly awaitsHuman: boolean;
  /** Default false. True permits a repository to override this gate via `repo_config`. */
  readonly configurable: boolean;
  readonly provider?: ProviderId;
  /**
   * Required when `kind` is `manual` (validation rule 15). A manual gate with
   * nowhere to read its decision from could only ever be `not_evaluated`, and
   * v1.0 cannot record the decision itself without breaking read-only (FR-034).
   */
  readonly evidence?: Locator;
  /** Where the gate reads from, for `artifact`, `check`, and `field` kinds. */
  readonly locator?: Locator;
  readonly passesWhen?: Condition;
}

export type ArtifactKind = 'markdown' | 'tracker' | 'test-results';

export interface ArtifactDecl {
  readonly id: string;
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly provider: ProviderId;
  readonly locator: Locator;
  /** Default false. A required artifact that is absent is reported in place (FR-019). */
  readonly required: boolean;
}

export interface State {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Default false. True raises an "input needed" signal for items resting here (FR-006). */
  readonly awaitsHuman: boolean;
  /** Default false. Items in a terminal state leave the active list. */
  readonly terminal: boolean;
  /** Provider id to the raw values that mean this state. */
  readonly maps: Readonly<Record<ProviderId, readonly string[]>>;
  readonly artifacts: readonly ArtifactDecl[];
  readonly gates: readonly GateDecl[];
  /** Array position. The only ordering source — order alone defines a linear lifecycle. */
  readonly ordinal: number;
}

export interface Transition {
  readonly from: string;
  readonly to: string;
  readonly name?: string;
  /** Gate ids declared on the `from` state. */
  readonly requires: readonly string[];
}

/** The work-item fields a manifest assigns an owning provider. */
export type OwnedField = 'state' | 'title' | 'assignee' | 'artifacts';

export const OWNED_FIELDS: readonly OwnedField[] = ['state', 'title', 'assignee', 'artifacts'];

/**
 * Exactly one provider per field (Principle VI, validation rule 7). `assignee` is
 * optional because a lifecycle with no tracker has no assignee to own — the
 * Gamesmith worked example in sdlc-manifest.md §7 is exactly that shape.
 */
export interface Ownership {
  readonly state: ProviderId;
  readonly title: ProviderId;
  readonly artifacts: ProviderId;
  readonly assignee?: ProviderId;
}

export interface ItemDiscoveryRule {
  readonly provider: ProviderId;
  /** A provider-interpreted query, for tracker-like providers. */
  readonly query?: string;
  /** A path glob, for file-backed providers. */
  readonly glob?: string;
}

export interface ItemIdentity {
  /** The field two providers agree on when they are describing the same item. */
  readonly correlateOn: string;
  /** Provider id to a named-group regex extracting identity fields from a raw locator. */
  readonly patterns: Readonly<Record<ProviderId, string>>;
  /** Every identity field a locator template may reference (validation rule 14). */
  readonly fields: readonly string[];
}

export interface ItemDiscovery {
  /** The noun the interface uses for one work item. Default "item" (research.md §16 Q2). */
  readonly unit: string;
  readonly discover: readonly ItemDiscoveryRule[];
  readonly identity: ItemIdentity;
}

export interface WriteBackRecords {
  readonly provider: ProviderId;
  readonly as: 'comment' | 'field' | 'file';
}

/**
 * Every flag defaults false. v1.0 never writes regardless (FR-034); this exists so
 * that a manifest can already express the opt-in a later release will honour.
 */
export interface WriteBackPolicy {
  readonly transitions: boolean;
  readonly gateResults: boolean;
  readonly records: WriteBackRecords | null;
}

export type ConfigFieldType = 'string' | 'number' | 'boolean';

export interface ConfigField {
  /** A dotted path into the manifest, e.g. `gates.tests-pass.check`. */
  readonly key: string;
  readonly title: string;
  readonly type: ConfigFieldType;
  readonly required: boolean;
  readonly default?: unknown;
  readonly description?: string;
}

export interface SdlcDefinition {
  readonly states: readonly State[];
  /** Empty means strictly linear. */
  readonly transitions: readonly Transition[];
  readonly providers: readonly ProviderDecl[];
  /** Exactly one provider per field (Principle VI, validation rule 7). */
  readonly ownership: Ownership;
  readonly items: ItemDiscovery;
  readonly writeBack: WriteBackPolicy;
  readonly repoConfig: readonly ConfigField[];
}

/** Why a manifest could not be loaded. Names the field, and the line where `yaml` supplies one. */
export interface ManifestProblem {
  readonly message: string;
  readonly field?: string;
  readonly line?: number;
}

export interface SdlcPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** The manifest's `sdlc:` value. Refused when unsupported (FR-047). */
  readonly contractVersion: number;
  readonly path: string;
  readonly description?: string;
  /** Null when the package carries no usable manifest — it is then unsupported (FR-045). */
  readonly definition: SdlcDefinition | null;
  /** Why the definition is absent or invalid. Null when the package loaded cleanly. */
  readonly problem: ManifestProblem | null;
}

/** Lookup helpers. Generic over any definition — they never name a state. */

export function findState(
  definition: SdlcDefinition,
  stateId: string,
): State | undefined {
  return definition.states.find((state) => state.id === stateId);
}

export function findGate(
  definition: SdlcDefinition,
  gateId: string,
): GateDecl | undefined {
  for (const state of definition.states) {
    const gate = state.gates.find((candidate) => candidate.id === gateId);
    if (gate) return gate;
  }
  return undefined;
}

export function findProvider(
  definition: SdlcDefinition,
  providerId: ProviderId,
): ProviderDecl | undefined {
  return definition.providers.find((provider) => provider.id === providerId);
}
