# Contributing

The governing document is [`.specify/memory/constitution.md`](.specify/memory/constitution.md).
Where anything here conflicts with it, that document wins.

This is a single-maintainer project, which is the fact the quality process is built around: **there
is no second reviewer, so a gate that depends on someone remembering to check it is not a gate.**
Every gate below is either machine-enforced or explicitly labelled self-attested, and the one
self-attested item is tracked as automation debt rather than presented as enforcement.

## One command

```
npm run verify
```

That runs all nine machine-enforced gates, and it is what any automation invokes. Not a variant of
it — the same command. If a pipeline grows its own inline equivalent, gate 9 fails.

## The nine machine-enforced gates

| # | Gate | Where it runs | What it protects |
| --- | --- | --- | --- |
| 1 | **Green suite** | `npm test` | Every behaviour is covered by a test, and the suite runs offline (Principle IV). |
| 2 | **Typecheck and lint** | `npm run typecheck`, `npm run lint` | TypeScript `strict`; the accessibility ruleset (Principle XI); the layer-boundary rule; and the rule rejecting lifecycle vocabulary inside engine and UI code (Principles II, VI). |
| 3 | **Zero-config boot** | `tests/unit/boot.zero-config.test.ts` | The application boots with empty configuration, and a workflow declaring an unconfigured provider renders an actionable prompt rather than failing (Principle I). |
| 4 | **Cache rebuild** | `tests/unit/cache.rebuild.test.ts` | Deleting the cache and rebuilding from provider fakes reproduces identical state (Principle VI). |
| 5 | **Provider parity** | `tests/parity/` | The engine suite passes unmodified against every provider fake (Principle IV). |
| 6 | **Accessibility assertions** | `tests/component/` with `vitest-axe` | Automated a11y checks against rendered components; every interactive element keyboard reachable (Principle XI). |
| 7 | **Bundle budget** | `npm run size` | Initial, per-route, and total JS plus initial CSS stay within Principle XII's budgets. |
| 8 | **Cold start** | `npm run smoke` | A clean build and launch of the real application succeeds (Principle I). |
| 9 | **Command parity** | `tests/unit/commands.parity.test.ts` | Automation invokes only named commands, never an inline equivalent (Principle XIV). |

### Gate 5 is a coupling detector, not a compatibility check

This is the one that gets misread, so it is worth stating twice. `tests/parity/` runs the engine's
behavioural suite against every provider fake **unmodified**. When it goes red for one fake only,
**do not start by fixing the fake.** A test that passes for one provider and fails for another
indicates that provider-specific knowledge has leaked into the engine — which is exactly the failure
Principle IV names. Start by asking what the engine now knows about a particular provider that it
should not.

## The one self-attested item

**10. Design-judgment principles — VII, VIII, IX, X, and XIII.** These govern how code is written
and are largely not machine-checkable. They are reviewed by the maintainer during planning, **not
enforced at merge**, and this document says so plainly rather than implying a reviewer will catch
them. Where a piece of one can be turned into a lint rule, it should be, and it then moves up into
the machine-enforced list.

Two already have: Principle VIII's "no import-time side effects" and Principle II's vocabulary ban
are lint rules today.

## Rules with teeth

A few conventions here are enforced rather than encouraged, and it saves time to know which:

- **`src/core` and `src/providers` may not import Electron, React, or anything under
  `src/renderer`.** This is a lint error. It is also true at runtime — they run in a different
  process — but the lint rule catches it before the process split has to.
- **No state, gate, transition, or provider name may appear as a string literal in
  `src/core/engine` or `src/renderer`.** Also a lint error. A lifecycle is data; code that names one
  state has stopped being generic over lifecycles. Read it from the loaded definition.
- **No import-time side effects.** Export a function and let a composition root call it. The only
  exemptions are `src/preload/index.ts` and `src/main/entry.ts`, which exist in order to run on
  load.
- **`any` and unchecked type assertions require a justification in the commit message.** Static
  types are not runtime validation: external input — manifests, provider responses, IPC payloads —
  is validated with Zod at the boundary.
- **A new runtime dependency requires a justification in the commit message**, against a simpler
  alternative and against the route's remaining bundle budget. The current ledger is in
  [`research.md` §17](specs/001-sdlc-work-item-dashboard/research.md).

## Tests

- Test through public behaviour — rendered output and user interaction. **Do not reach into
  component internals or private state.**
- Every schema rule has a test asserting that a violating definition is rejected at runtime.
  Workflow definitions are untrusted user input.
- Every bug fix includes a regression test that reproduces the defect.
- Writing the test first is recommended and usually fastest, but it is **not a rule** — it cannot be
  verified after the fact, and a rule nothing can check is not a rule. Principle IV requires the
  coverage, not the ordering.
- No test performs a live network call. Every provider ships a fake, and that is what the suites run
  against.

## Commits

Record any deviation from a principle in the commit message, with its justification and the simpler
alternative that was rejected.

## Amending the constitution

Expected, not exceptional. An amendment is a commit that edits
[`.specify/memory/constitution.md`](.specify/memory/constitution.md), states its rationale in the
commit message, and describes the migration path for anything the change makes non-compliant. A
principle that has become unenforceable, disproportionate to this project's scope, or routinely
waived **must be amended or removed rather than silently ignored**.
