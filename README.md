# SDLC Manager

A desktop dashboard for work items moving through agentic software development lifecycles.

It reads each lifecycle from the agent package that executes it, and shows you every work item in
flight, which state each one occupies, and which ones are waiting on you — the items in a
persistent list down the left, the selected one's detail beside it, both at once. The list
collapses when an artifact needs the width, and still says how many items are waiting on you while
collapsed.

**It observes. It does not act.** v1.0 is read-only with respect to every system of record: it
performs no state transition, no gate approval, no check retry. That is not restraint in the use of
a capability — the capability is absent. Neither the provider interface nor the bridge between the
two processes exposes a write method.

---

## Install and run

```
npm install
npm run dev
```

That is the whole of it. No database, no container runtime, no Rust toolchain, no credentials, and
no network.

The application opens with **no repositories registered and no credentials configured**, showing an
empty state that offers to register one. That it opens at all with zero configuration is the point:
if it ever prompts for a credential before showing you anything, that is a bug, not a setup step.

An end user installs a packaged build (`npm run package`) and needs none of the above — not Node,
not a package manager, not a compiler. The packaged artifact embeds its own runtime.

## Try it without configuring anything

```
npm run fixture:create -- ./tmp/demo
```

Creates a repository running a filesystem-backed lifecycle: markdown as the system of record, six
states, gates of all four kinds, and items seeded across them — one awaiting your input, one with a
failed gate, one with a gate that has never been evaluated. Register `./tmp/demo` from the
repositories view.

For a second, deliberately different lifecycle:

```
npm run fixture:create -- ./tmp/demo2 --sdlc alt
```

Both appear in one list, each resolving against its own vocabulary, with no change to the
application. That is the product's central claim.

## Commands

Every repeatable action is one named command, and whatever you run locally is what any automation
runs.

| Command | What it does |
| --- | --- |
| `npm run dev` | The dashboard in development |
| `npm run build` | Production build of main, preload, and renderer |
| `npm run package` | The installable desktop artifact |
| `npm test` | Unit, component, and parity suites — offline |
| `npm run typecheck` | TypeScript `strict` |
| `npm run lint` | ESLint, including the accessibility and layer-boundary rules |
| `npm run size` | Bundle budgets |
| `npm run smoke` | Cold launch of a built application |
| **`npm run verify`** | **Every machine-enforced gate. This is what CI runs.** |
| `npm run fixture:create` | A fixture repository to try the dashboard against |
| `npm run fixture:package` | A bare agent package, with or without a manifest |
| `npm run fixture:fail` | Make a fixture provider fail, to see degraded behaviour |
| `npm run fixture:upgrade` | Add or remove a state, to see a mid-flight package upgrade |

## How a lifecycle gets here

The dashboard ships **no lifecycle definitions of its own**. It reads them from the agent packages
installed on your machine: any directory carrying an `sdlc.yaml` is an available SDLC package.

That file is a contract, specified in
[`specs/001-sdlc-work-item-dashboard/contracts/sdlc-manifest.md`](specs/001-sdlc-work-item-dashboard/contracts/sdlc-manifest.md).
It declares the lifecycle's ordered states, the gates each state carries, the artifacts each state
carries, and which provider owns which field.

Two consequences are worth stating plainly, because they are the design rather than a limitation:

- **A package that carries no manifest is unsupported**, and is reported as such, naming what is
  missing. Its lifecycle is never guessed from the prose of its skills or prompts. A state that is
  described but not declared does not exist.
- **Adding a state, a gate, or a transition is a configuration change**, never a code change. If it
  needed a code change, the design would be broken.

By default, packages are looked for under `~/.claude/plugins`, `~/.claude/skills`, and
`~/.sdlc/packages`. Set `SDLC_PACKAGE_PATHS` to look elsewhere.

## Providers

A lifecycle declares the external systems it reads. v1.0 ships three, plus an advisory console:

| Kind | Reads | Needs |
| --- | --- | --- |
| `filesystem` / `checks` | Markdown artifacts, file-derived state, file-recorded check results | Nothing — works fully offline |
| `jira` | Item discovery by assignment, status, fields, ticket content | Site URL, account email, API token |
| `github` | Check results, issue content, repository markdown | Owner, repository, token |

Credentials are encrypted through the operating system keychain and never written to disk in
plaintext, never logged, and never returned across the process boundary. A lifecycle whose system of
record is entirely local needs no credential and no network at all.

An unconfigured provider does not stop the application: it reports what it needs, by name, and
everything else keeps working.

## What it stores

Nothing authoritative. Your systems of record — the markdown files, the tickets, the check results —
drive the process, and the local cache under the application's user-data directory is derived from
them. Deleting it is a supported recovery path, and a test asserts that a rebuild reproduces
identical state.

Registrations and credentials are your configuration rather than cached data, so they live beside
the cache and survive its deletion.

## Architecture, in one paragraph

The workflow engine, the manifest reader, and every provider run in Electron's main process, where
they are plain TypeScript with no access to React and no DOM. The renderer is React and can reach
them only through a narrow, typed, validated bridge. This makes the constitution's "engine logic
must be unit-testable without rendering a component" a fact about where the code runs rather than a
discipline that erodes: `src/core` cannot import React, because React does not exist in its process.
The renderer runs sandboxed, with context isolation on and no Node access, which matters because
this application renders markdown from repositories and rich text from issue trackers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the quality gates, and
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) for the principles they enforce.
