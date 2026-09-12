# Contract: Provider Interface

**Status**: Draft · **Created**: 2026-09-11 · **Feature**: [spec.md](../spec.md)
**Satisfies**: Constitution Principles III, IV, VI · FR-017, FR-026, FR-033, FR-037

Every external system this application reads — the filesystem, Jira, GitHub checks, and anything
added later — is reached only through this interface. Application code never imports a vendor SDK
and never calls a vendor endpoint directly.

---

## 1. The interface

```ts
interface Provider {
  readonly id: ProviderId;
  readonly kind: ProviderKind;

  /** Configured and reachable? Never throws; reports instead. */
  health(): Promise<ProviderHealth>;

  /** Items this provider considers the engineer's own, per the manifest's discovery rules. */
  discoverItems(ctx: RepoContext): Promise<Result<RawItem[]>>;

  /** The raw status value for an item. Mapping to a state is the engine's job, not the provider's. */
  readState(ctx: RepoContext, key: ItemKey): Promise<Result<RawState>>;

  /** Artifact content for a declared locator. */
  readArtifact(ctx: RepoContext, decl: ArtifactDecl, key: ItemKey): Promise<Result<ArtifactContent>>;

  /** The recorded result for a gate, or not_evaluated when nothing is recorded. */
  readGate(ctx: RepoContext, decl: GateDecl, key: ItemKey): Promise<Result<GateResult>>;

  /** Fires when this provider's data may have changed. Watch locally, poll remotely. */
  subscribe(ctx: RepoContext, onChange: () => void): Unsubscribe;
}
```

There are **no write methods in v1.0**. This is FR-034 expressed in the type system: a read-only
release cannot accidentally write, because no method exists to call. Adding write operations later
is additive — the Planned Direction constraint that "adding write operations does not change how
items are read" is satisfied by leaving every method above untouched when they arrive.

## 2. Rules every implementation obeys

1. **Never throw for an expected failure.** Unreachable hosts, expired credentials, rate limits,
   and missing files are `Result` failures with a typed reason, not exceptions. One failing
   provider must not take down unrelated parts of the dashboard (Principle III).
2. **Never map.** A provider returns the system's raw vocabulary. Translating a raw value into a
   declared state is the engine's job, because the mapping lives in the manifest. A provider that
   knows about states has leaked lifecycle knowledge into an adapter.
3. **Validate at the boundary.** Every response is parsed through a Zod schema before leaving the
   provider (Principle IX). A response that does not match its schema is a typed failure.
4. **Never log a credential.** Secrets arrive from `safeStorage` and appear in no log line, no
   error message, and no telemetry.
5. **Return `not_evaluated`, never a guess.** A gate whose result cannot be read is
   `not_evaluated`. Absence is never success (FR-014).
6. **Be absent by default.** A provider is constructed only because a loaded manifest declares it.
   Unconfigured means `health()` reports what is missing, by name (FR-026, FR-035).

## 3. Every provider ships a fake

Principle III and Principle IV both require it, and the requirement is stronger than "a test
double": the fake implements the *same interface* and the engine's test suite runs against every
fake **unmodified**.

```
src/providers/fakes/
  filesystem.fake.ts
  jira.fake.ts
  github.fake.ts
```

A fake must be able to produce, on demand: a healthy provider, an unreachable one, an
unauthenticated one, a missing artifact, a rate-limited response, and a gate with no recorded
result. Those are the branches the engine's error paths need and that a live system will not
produce on request.

**The parity suite is the diagnostic.** `tests/parity/` runs the engine's behavioural suite against
each fake in turn. A test that passes for one provider and fails for another does not indicate a
provider bug — it indicates that provider-specific knowledge has leaked into the engine, which is
exactly the failure Principle IV names. That is the suite's purpose: it is a coupling detector, not
a compatibility check.

## 4. Provider kinds in v1.0

| Kind | Reads | Notes |
|---|---|---|
| `filesystem` | Markdown artifacts, file-derived state and ownership | The offline path. Must work with no network at all (FR-036). |
| `jira` | Item discovery by assignment, status, fields, tracker artifacts | Plain `fetch`, no SDK. |
| `github` | Check results for `kind: check` gates, issue content | Plain `fetch`, no SDK. |
| `assistant` | The advisory console (Story 5) | Same discipline: absent by default, degrades in place. |

Adding a kind requires no change to `src/core` or `src/renderer` (FR-042, Principle III). A change
to either in order to add a provider is a design failure, not a task.

## 5. Ownership and composition

A single lifecycle may compose providers — markdown for artifacts, Jira for state. The manifest's
`ownership` block decides which provider owns which field, and the engine consults it rather than
asking providers to negotiate. Two providers claiming one field is a manifest validation error
(Principle VI, FR-048), so no runtime conflict resolution exists and none is needed.

Where a cached value disagrees with a provider's, the provider wins. The cache never overwrites a
system of record — in v1.0 it could not, since no write method exists.
