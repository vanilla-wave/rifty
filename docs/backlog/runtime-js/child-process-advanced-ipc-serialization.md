---
area: runtime-js
status: ready
title: `child_process.fork` with `serialization: 'advanced'` round-trips structured-clone values
created: 2026-09-15
why: vitest's default forks pool calls `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`; rifty throws `NotImplementedError('child_process.serialization.advanced')` at spawn, so the default pool cannot start
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md, docs/adr/runtime-js/0448-advanced-fork-ipc-over-the-existing-process-channel.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-worker.ts, packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/internal/node-ipc-serialization.ts, packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts]
---

## User scenario

Vitest 4.1.11 default forks pool calls `fork(worker, [], { stdio: 'pipe',
serialization: 'advanced' })`. The child starts in a real Worker, exchanges
test data through `process.send` / `child.send`, and reports results instead of
failing at spawn. → I4

## Reference contract

Node v24.16.0 oracle and rifty RED commands/output:
`reference/child-process-advanced-ipc-serialization-evidence.md`. Native
advanced fork preserves Date, Map, Set, RegExp, Error, `[undefined]`, Uint8Array, BigInt and cycles
in both directions. Top-level undefined/function and nested function reject
synchronously with Node's observed error classes/codes; the channel remains
usable. ADR-0448 fixes the standard structured-clone subset and the loud
Buffer/accessor boundary on the existing ADR-0326 MessagePort.

## Acceptance

1. `fork(..., { serialization: 'advanced' })` starts one physical Worker.
   Child→parent and parent→child preserve Date, Map, Set, RegExp, Error,
   `[undefined]`, Uint8Array, BigInt and a cyclic plain object by
   type/value/identity. → I4
2. Invalid sends reject synchronously with Node's error class/code; a later
   valid send is delivered in order, then logical disconnect leaves both
   ends disconnected and the child exits 0. An invalid serialization option
   rejects before spawning. → I4, ADR-0448
3. Omitted/default `serialization` remains Node JSON: existing
   `child_process/public-ipc-json` parity still passes, including dropped
   methods and circular-send failure. → ADR-0326
4. A Buffer nested in an advanced payload and plain-object accessors
   throw named `NotImplementedError`, not a silently changed type or
   getter evaluation. SharedArrayBuffer gets Node's clone error; unknown host
   objects stay loud. → ADR-0448

## Parity cases

1. `child_process/fork-structured-serialization` runs the same fork program
   against Node v24.16.0 and a physical rifty Worker. Node's pinned result
   includes exact type checks, both directions, message order, validation,
   disconnect and exit. RED: rifty throws
   `NotImplementedError('child_process.serialization.advanced')` before the
   Worker can be constructed. → I4
2. `fork-advanced-ipc.test.ts` uses the real VFS and child runner. RED is the
   same feature-specific throw at `fork`; after the repair it proves the
   same-realm carrier does not silently fall back to JSON. → I4
3. `child_process/public-ipc-json` remains green against Node. → ADR-0326

## Fault matrix

| Fault | Boundary and outcome | Proof |
|---|---|---|
| `corrupt-input` | top-level undefined/function and nested function reject synchronously; next valid message still arrives | physical parity case → ADR-0448 |
| `observable-order` | two valid messages after rejected sends arrive in send order before disconnect | physical parity case → ADR-0448 |
| `sibling-drift` | default JSON retains its old coercions and circular failure | existing public IPC parity case → ADR-0326 |
| `provenance-lie` | nested Buffer/plain-object accessor is named loud rather than losing brand or invoking getters | advanced IPC fault test → ADR-0448 |
| `sibling-drift` | SharedArrayBuffer follows Node's rejection although host structured clone accepts it; unknown host objects fail loudly | advanced IPC fault test → ADR-0448 |
| `corrupt-input` | unknown launch IPC discriminator fails before guest entry | node-entry bootstrap test → ADR-0448 |
| `corrupt-input` | unknown `options.serialization` rejects before Worker allocation | physical parity and conformance test → ADR-0448 |

## Out of scope

- Node's V8-specific Buffer wire representation, plain-object accessors, handles, callbacks/options,
  channel `ref()`/`unref()` and non-structured-cloneable host objects remain
  loud gaps in compat; no JSON fallback.

## Decisions

- ready-verdict: 2026-09-23 — Contract+RED @ ce86f977b6724eb6c10a15954b7503412837bae0
- re-cut: 2026-09-23 — strengthened typed graph and unknown-option validation already owned by ADR-0448 — trace: ADR-0448
- re-cut: 2026-09-23 — ADR-0448: plain-object accessor ceiling; Error.stack keeps native Node serialization — trace: ADR-0448
- 2026-09-23 — ADR-0448 extends ADR-0326's launch discriminator, keeps one MessagePort and the JSON default; native structured clone carries the admitted graph, V8-only values stay loud.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P4 cost shown)
