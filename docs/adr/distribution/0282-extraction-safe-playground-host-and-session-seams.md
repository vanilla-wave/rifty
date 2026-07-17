# ADR 0282: Extraction-safe Playground host and session seams

Status: Accepted
Date: 2026-07

> TL;DR: the Playground host supplies its dedicated TypeScript worker, while
> the companion exposes only root-free durability, TS recovery, and persisted
> terminal restoration semantics needed across the sealed package boundary.

## Context

ADR-0263 required PR3 to be mechanically extractable before merge. The dry-run
moved the Workbench closure and passed package typecheck/architecture, then
found one bundle error and three private App calls: owner bootstrap imported a
fifth Worker with Vite `?worker&url`; Cmd+S and TS recovery used WeakMap-backed
private functions; terminal migration read the captured physical legacy prefix.
None survives a published package boundary.

## Decision

- `PlaygroundWorkbenchOptions` refines `WorkbenchOptions` with required
  `deployment.workers.typescript`. Generic `WorkbenchOptions` remains unchanged.
  The browser host resolves this fifth URL and the package exports a dedicated
  TypeScript worker entry; package code contains no bundler query import.
- `PlaygroundTypeScript.reinitialize()` rebuilds only the captured session's TS
  service. It accepts no root. `PlaygroundSessionTools.awaitDurability()` waits
  for the captured owner's admitted mutations and durability report. It exposes
  no backend, report, owner, path, or transport.
- `playground.restoreTerminalState({ format, state })` accepts
  `project-rooted | legacy-workspace-absolute`, closes over the exact legacy
  selection captured for owner adoption, and returns a frozen project-rooted
  snapshot. Missing, stale, malformed, or outside legacy cwd becomes `/`;
  opaque string env entries survive. The prefix never crosses the public API.
- App production code imports Workbench only through `public.ts` and
  `playground.ts`. Monaco draining, document reopening, toasts, and persistence
  format selection remain App policy.

Reusing owner/kernel for TS was rejected: the language service is an existing
independent serve lifecycle. Keeping the three operations private was rejected:
the App could not invoke them after extraction. Exposing raw prefixes or flush
reports was rejected because it leaks topology instead of semantics.

## Consequences

- PR4 can move the Workbench closure without semantic edits or Vite syntax.
- Companion consumers must deploy one additional Worker asset.
- The public additions are finite lifetime-scoped operations; no generic
  extension registry, physical root, or owner capability is introduced.
- Corrects ADR-0263's four-worker/extraction clauses, ADR-0278's exact session
  tools and host-prefix conversion clauses, and ADR-0281's package-private
  durability-operation clause. Their remaining decisions stand.
