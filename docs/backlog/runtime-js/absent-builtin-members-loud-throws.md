---
area: runtime-js
status: ready
title: `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as real or named-loud members
created: 2026-09-15
why: absent members surface as link-time SyntaxError (named import of statfsSync/spawnSync) or `undefined.bind` TypeError (vitest worker init binds process.memoryUsage) — worse than a NotImplementedError and fatal even when the member is never called on the claimed path
user_story: As a real npm package running in the browser shell, I want named imports of rarely-called Node builtin members to link and bind like on my machine, but today absent members kill the process before the code ever runs
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/process.ts]
---

## User scenario

Goal I4/I6: vitest's `cli-api` does `import { statfsSync } from 'node:fs'`,
tinyexec `import { spawn, spawnSync } from 'node:child_process'`, and the pool
worker init does `process.memoryUsage.bind(process)` (evidence §I6/§I4 raw
fork). Today the two named imports link-fail (`SyntaxError: … does not provide
an export named …`) and `memoryUsage.bind` throws
`TypeError: Cannot read properties of undefined (reading 'bind')` — before
any of them is called on the claimed path.

## Context

vitest 4.1.11: `import { statfsSync } from 'node:fs'` (cli-api; called only
in browser-mode chromium GC), tinyexec `import { spawn, spawnSync } from
'node:child_process'` (spawnSync only for `--changed` git), worker init
`process.memoryUsage.bind(process)` (called only with `logHeapUsage`).
Oracle (Node v24.16.0): `typeof statfsSync`, `typeof spawnSync`,
`typeof process.memoryUsage` all `function` (evidence §Oracle).
`node-builtins-loud-stub-capability-gaps` already lists statfs/spawnSync as
"absent — not even a loud throw". `process.setSourceMapsEnabled` and
`process.emitWarning` are also absent but guarded by vitest
(`if (process.setSourceMapsEnabled)`, native mode; deprecation path) — not on
this item; `emitWarning` stays with `process-module-loader-surface`. A member whose real value the browser cannot
supply (heap statistics) is a named `NotImplementedError` per AGENTS.md
§Fidelity, never a fabricated number; `spawnSync` may follow `execSync`'s
existing sync-child path if that is a real implementation, else loud.

## Acceptance

1. `import { statfsSync } from 'node:fs'` and
   `import { spawnSync } from 'node:child_process'` link in ESM with
   `typeof === 'function'` (`→ I6`).
2. `typeof process.memoryUsage === 'function'` and
   `process.memoryUsage.bind(process)` does not throw (`→ I4`, vitest worker
   init shape).
3. CALLING each of `statfsSync()`, `spawnSync(...)`, `process.memoryUsage()`
   throws a named `NotImplementedError` (`fs.statfsSync`,
   `child_process.spawnSync`, `process.memoryUsage`) — never a fabricated
   result (`→ I6`, §Fidelity named-loud).

## Parity cases

Real Node v24.16.0: `typeof statfsSync` / `typeof spawnSync` /
`typeof process.memoryUsage` all `function` (evidence §Oracle). RED targets:
`fs/esm-named-absent-members.case.ts` (link + typeof, fails today with the
link-time SyntaxError) and `process/node-eval-memory-usage-member.case.ts` (typeof +
bind). Call-time loudness is browser-only — no Node oracle exists for
NotImplementedError; pinned by unit fault tests (Acceptance 3).

## Out of scope

- `process.emitWarning` / `process.setSourceMapsEnabled` — guarded by vitest,
  stay with `runtime-js/process-module-loader-surface`.
- Real statfs/spawnSync/memoryUsage values — browser cannot supply; named
  loud throws are the honest carrier (`→ I6`, out-of-scope row of the goal:
  `--changed` (git via spawnSync) loud).
- `vm.SourceTextModule`/`SyntheticModule` (vm pools) — goal Out of scope.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| absent capability | call `statfsSync()` / `spawnSync(...)` / `memoryUsage()` | loud `NotImplementedError('<member>')`, feature named, no fabricated data (`→ I6` §Fidelity named-loud) |

## Challenge

challenge: 2026-10-02 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); unit premise re-verified by Contract+RED @ 24a8a854 (Node v24.16.0 typeof oracle)

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ 24a8a8546976c82de76e4f4ef1a6d2dfad6cd9e7
- 2026-10-02 — agent (PICKUP): all three members are named-loud functions.
  `execSync`'s SAB child path exists but `spawnSync`'s full Node contract
  (result object, options matrix) is a separate honest-npm/goal-fog item — a
  half-spawnSync would fake the shape. Loud-throw first class: existing
  `NotImplementedError` import sites already follow this pattern
  (`child_process.ps`, `fs.watchFile.bigint`).