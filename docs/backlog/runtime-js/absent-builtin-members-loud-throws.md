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
'node:child_process'` (a pure link-time need — vitest's `--changed` git
scanning uses async spawn, never spawnSync), worker init
`process.memoryUsage.bind(process)` (called only with `logHeapUsage`; the
vm pools call it unconditionally, but vm pools are their own loud wall —
map Out of scope). None is CALLED on the claimed `vitest run` forks/threads
path — the wall is link/bind time. Oracle (Node v24.16.0): `typeof
statfsSync`, `typeof spawnSync`, `typeof process.memoryUsage` all `function`
(evidence §Oracle).

Why loud members, not real values (AGENTS.md §Fidelity):
- `statfsSync`: Node returns real volume statistics (bsize/blocks/bfree/…).
  The Memory VFS has no volume — any number would be fabricated.
- `process.memoryUsage`: Node returns the process's real V8 heap
  (rss/heapTotal/heapUsed/external/arrayBuffers). The browser realm cannot
  supply process-faithful heap statistics (`performance.memory` measures the
  whole host page, is non-standard, and is rounded) — fabricated numbers are
  forbidden.
- `spawnSync`: the kernel sync-RPC transport is universal (it already serves
  the `fs.*` sync handlers — `kernel/src/ipc/sync-rpc.ts`); an honest
  no-shell args-array spawnSync needs a new sync HANDLER on that transport
  plus Node's full result shape (`{pid, output, status, signal, error}`,
  stdio options, maxBuffer, timeout/killSignal) — machinery the claimed path
  never calls (§Simplicity).

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
4. Compat matrix carries one ❌ row per member naming the NotImplementedError
   gap → I6 honesty. `docs/public/compat/fs.md` is GENERATED — the statfsSync
   row is added to the fs inventory in `tools/compat-matrix-generator/cli.js`
   and the file regenerated (`pnpm compat:generate`), never hand-edited.
   `docs/public/compat/process.md` is hand-maintained and holds the
   child_process rows (e.g. the `execFile()` row) — spawnSync and
   memoryUsage rows are edited there directly.

## Reference contract

- Oracle: Node v24.16.0 (host) — epic evidence §Oracle line 222: `typeof
  statfsSync`/`typeof spawnSync`/`typeof process.memoryUsage` → `function`.
- Mechanism: the established named-loud-stub pattern — a real exported
  function whose body throws `NotImplementedError('<area>.<feature>')`, so
  named imports link, `typeof`/`bind`/`new Function` introspection behave,
  and only an actual CALL hits the loud gap. No fabricated return values.
  `process.memoryUsage` lands as a `NodeProcess` method, so the item-3
  freeze test's pinned prototype name set grows from 12 to 13 names
  (`memoryUsage`) — that update is part of this unit, and Node parity for
  `memoryUsage` as a named export is carried by the parity case above.

## Parity cases

1. Node v24.16.0 ESM carrier
   `tools/node-parity-runner/cases/process/absent-members-link.case.ts`
   (`kind: 'esm'`): the claimed wall is the ESM named import, so the case
   imports `statfsSync`/`spawnSync` by name, reads the rifty process via
   `require('node:process')` (NEVER the ambient global — the in-process
   harness's `process` is the HOST, traps.md parity-runner-in-process), and
   pins typeof / `.length` arity (1/3/0) / `memoryUsage.bind(proc)` /
   CJS↔ESM identity — `expected` oracle-pinned → I6

Unit REDs (the CALL-time loud throws): `packages/runtime-js/src/builtins/absent-members-loud.test.ts`
asserts each member's exact `NotImplementedError('<area>.<feature>')` —
a no-op function passes the parity carrier but dies here.

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
  needs a new sync handler + Node's full result shape on the existing
  universal sync-RPC transport — machinery the claimed path never calls
  (§Simplicity). Recorded divergence: Node CALLS succeed, rifty calls throw
  — compat ❌ rows.
- 2026-10-01 — reception (REV-12) of Contract+RED R1 (blocker, 6 findings):
  F1 ambient-host-`process` read replaced by explicit
  `require('node:process')`; F3 ESM named imports became the parity carrier
  (was require-only); F2 unit REDs for the three exact NotImplementedError
  throws added (`builtins/absent-members-loud.test.ts`). Concern amendments:
  spawnSync justification reworded (handler + result shape, not a new
  transport); Context precision (tinyexec's spawnSync import is link-only,
  `--changed` uses async spawn; vm pools call memoryUsage but are their own
  loud wall); compat-row mechanism corrected (fs.md is GENERATED via
  inventory + `pnpm compat:generate`; process.md hand-maintained, holds the
  child_process rows).
