---
area: net
status: active
title: Exact node:sqlite builtin registration module path
created: 2026-06-08
why: Harness-local side-effect registration is provisional; TODO(backlog: net/sqlite-registration-path) marker still open
sources: [Q-2026-05-31-302, ADR-0065 D3, ADR-0035]
code: [packages/net/src/sqlite/register-builtins.ts:19]
---
## Context
`node:sqlite` registers via the side-effect module `@riftydev/net/sqlite/register-builtins`, opt-in and harness-local (imported by the opencode harness / parity-runner `kind: 'sqlite'` mode), mirroring the `net`/`https` precedent. Lives in net (not runtime-js) so top-down layering holds and the heavy sql.js WASM engine is NOT pulled into every load. TODO(backlog: net/sqlite-registration-path) marker at register-builtins.ts:19.

## Options / Next
Option A (chosen): harness-local side-effect registration — keeps `node:sqlite` out of unrelated default loads, correct layer; con: each consumer must import. Option B (rejected): always-on global registration — leaks the WASM-SQLite engine into ALL loads, wrong scope. Next: confirm at M12 DoD → promote Q-2026-05-31-302 to ADR via `pnpm adr:new net` (manual), re-anchor the `TODO(backlog: net/sqlite-registration-path)` marker.

## Reversibility
REVERSIBLE — placement of a side-effect registration module, no cross-package public API change. The backlog item is this file (Q-2026-05-31-302); confirm→promote.
