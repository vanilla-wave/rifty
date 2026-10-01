---
area: runtime-js
status: ready
title: `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as named-loud members
created: 2026-09-15
why: absent members surface as link-time SyntaxError (named import of statfsSync/spawnSync) or `undefined.bind` TypeError (vitest worker init binds process.memoryUsage) — worse than a NotImplementedError and fatal even when the member is never called on the claimed path
user_story: As a developer running vitest in the browser shell, I want the CLI and test worker to load past their `statfsSync`/`spawnSync`/`memoryUsage` references, but today the members are absent entirely and module init dies before any test runs
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

vitest 4.1.11: `import { statfsSync } from 'node:fs'` (cli-api; called only
in browser-mode chromium GC), tinyexec `import { spawn, spawnSync } from
'node:child_process'` (spawnSync only for `--changed` git), worker init
`process.memoryUsage.bind(process)` (called only with `logHeapUsage`).
None is CALLED on the claimed `vitest run` path — the wall is link/bind
time. Oracle (Node v24.16.0): `typeof statfsSync`, `typeof spawnSync`,
`typeof process.memoryUsage` all `function` (evidence §Oracle).

Why loud members, not real values (AGENTS.md §Fidelity):
- `statfsSync`: Node returns real volume statistics (bsize/blocks/bfree/…).
  The Memory VFS has no volume — any number would be fabricated.
- `process.memoryUsage`: Node returns the process's real V8 heap
  (rss/heapTotal/heapUsed/external/arrayBuffers). The browser realm cannot
  supply process-faithful heap statistics (`performance.memory` measures the
  whole host page, is non-standard, and is rounded) — fabricated numbers are
  forbidden.
- `spawnSync`: the kernel sync channel carries only shell-string `execSync`
  (`child_process-sync.ts`); an honest no-shell args-array spawnSync needs a
  new kernel sync method plus Node's full result shape
  (`{pid, output, status, signal, error}`, stdio options, maxBuffer,
  timeout/killSignal) — machinery the claimed path never calls (§Simplicity).

`process.setSourceMapsEnabled`/`process.emitWarning` are guarded by vitest
(native mode / deprecation path) and stay absent here — `emitWarning` belongs
to `process-module-loader-surface`.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. `import { statfsSync } from 'node:fs'` links and `typeof statfsSync ===
   'function'`; calling it throws `NotImplementedError('fs.statfsSync')`
   (parity case for the typeof surface; unit test for the throw) → I6
2. `import { spawnSync } from 'node:child_process'` links and `typeof
   spawnSync === 'function'`; calling it throws
   `NotImplementedError('child_process.spawnSync')` (parity + unit) → I6
3. `process.memoryUsage` is a function: `process.memoryUsage.bind(process)`
   succeeds (the vitest worker-init shape); calling it throws
   `NotImplementedError('process.memoryUsage')` (parity typeof + unit) → I6
4. Compat matrix carries one ❌ row per member (`docs/public/compat/fs.md`,
   `process.md`) naming the NotImplementedError gap → I6 honesty

## Reference contract

- Oracle: Node v24.16.0 (host) — epic evidence §Oracle line 222: `typeof
  statfsSync`/`typeof spawnSync`/`typeof process.memoryUsage` → `function`.
- Mechanism: the established named-loud-stub pattern — a real exported
  function whose body throws `NotImplementedError('<area>.<feature>')`, so
  named imports link, `typeof`/`bind`/`new Function` introspection behave,
  and only an actual CALL hits the loud gap. No fabricated return values.

## Parity cases

1. Node v24.16.0 CJS: `typeof require('node:fs').statfsSync`, `typeof
   require('node:child_process').spawnSync`, `typeof process.memoryUsage` →
   `function function function`; `process.memoryUsage.bind(process)` is
   callable-shaped — carrier
   `tools/node-parity-runner/cases/process/absent-members-link.case.ts` with
   `expected` pinned from the oracle → I6

## Out of scope

- REAL statfsSync/memoryUsage/spawnSync implementations — the browser cannot
  supply the first two faithfully; the third needs a new kernel sync method
  (recorded in Decisions). The CALL-time divergence vs Node is the declared
  ❌ compat rows.
- `process.emitWarning`, `process.setSourceMapsEnabled`,
  `module.register*`, `vm.SourceTextModule/SyntheticModule` — guarded or
  native/vm-pool paths, owned by other items.
- The async/promises twins (`fs.promises.statfs`) — not on the vitest path;
  stay absent (link error only if something imports them — same loud class).

## Decisions

- 2026-10-01 — all three members are named-loud, none real: statfsSync and
  memoryUsage cannot be honest in a browser realm; spawnSync's honest form
  needs a new kernel sync method the claimed path never calls (§Simplicity).
  Recorded divergence: Node CALLS succeed, rifty calls throw — compat ❌ rows.
