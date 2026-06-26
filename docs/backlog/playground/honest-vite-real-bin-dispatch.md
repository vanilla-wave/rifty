---
area: playground
status: blocked
title: `vite` runs the real `node_modules/.bin/vite` (retire the curated dispatch)
created: 2026-06-26
why: registerCommand('vite') shadows the installed binary (ADR-0137 resolution order) and dispatches to curated Vite-API handlers; Mission = maximally faithful to real Node → the installed CLI should execute, with dev/build/preview going through the real entry, its arg parsing and config resolution.
user_story: As a developer, I want `which vite` → the installed shim and `vite` → the real CLI running, so any Vite feature/flag/config behaves as in real Node, but today a hand-curated owner command intercepts `vite` and only a fixed subcommand set is real.
sources: [ADR-0148, ADR-0173, ADR-0137, ADR-0155, ADR-0150, docs/backlog/shell/node-modules-bin-execution.md, docs/backlog/playground/vite8-production-build-preview.md, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/owner-child-vite-command.ts]
---

## Context

`vite` resolution today: the registered command wins → never reaches the `.bin/vite`
walk-up + `execBin` mechanism (`shell/node-modules-bin-execution` delivered, ADR-0137).
The curated child (`createOwnerChildViteCommand`) runs Vite's Node API programmatically;
the real CLI entry, its arg parsing, config resolution, and mode handling never run.
This is the north star of the honest-vite umbrella — the curated dispatch is the interim.

**Depends on:**

- `playground/honest-vite-config-file-loading` (the real CLI loads `vite.config.*`).
- The bundler-under-worker_threads / emnapi-pthread path real `vite build` needs —
  `playground/vite8-production-build-preview`, `kernel/real-worker-threads`.
- Preserving HMR + preview routing when `vite` is a plain `.bin` child (not the owner's
  co-resident handler).

## Options or Next

- Narrow, then remove, `registerCommand('vite')`: let `vite` resolve through `.bin/vite`
  + the node-entry loader. Keep the co-residency benefits (HMR bridge, preview slot) by
  attaching them to the child the bin spawns — the `node <file>` server child already
  registers a preview slot via `onListening` (ADR-0155); reuse that seam for the bin path.
- Until the real CLI runs end-to-end, the curated dispatch stays AND every unsupported
  surface loud-throws (items `honest-vite-dev-path-arg-honesty` / `-config-file-loading`).
  No silent shim in the interim.

## Done when (no partial delivery)

- `which vite` resolves to `node_modules/.bin/vite`; `vite`, `vite build`, `vite preview`
  run the real binary end-to-end, parity vs real Vite on observable output.
- HMR proven, not assumed: editor edit → module update still works (e2e); preview slot
  still registers.
- The `registerCommand('vite')` curated dispatch is removed (or reduced to a documented,
  loud-gated fallback); no behaviour silently changed.
- ADR amending ADR-0148 §2 + ADR-0173 (which made `vite` a curated owner command)
  recorded before merge.

## Reversibility

IRREVERSIBLE — changes which entity executes `vite` (curated owner command → real
binary), amends ADR-0148 / ADR-0173, may rewire preview/HMR. Needs an ADR.
