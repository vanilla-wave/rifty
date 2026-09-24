---
area: runtime-js
status: ready
title: A live `worker_threads.Worker` holds its parent and a worker thread exits when its loop drains, as in Node
created: 2026-09-15
why: the keepalive counts timers/immediates/pending imports (+ fetch, ADR-0158; referenced MessagePorts, ADR-0447) only; a program whose only pending work is a running Worker drains and exits 0 before the worker's message, and a kernel worker thread never exits by itself (Node keeps the parent alive until the worker exits or is unref'd, and ends a worker whose loop drained)
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-evidence.md, docs/adr/runtime-js/0446-count-live-worker-threads-workers-in-child-realm-keepalive.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/worker-threads-kernel-run-to-completion-exit.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, tools/node-parity-runner/src/worker-env-kernel-worker.ts]
---

## Context

On BASE (evidence §Baseline), `new Worker('./w.cjs')` whose worker posts after
700 ms exits 0 before the message: no message and no `'exit'`. Node
(v24.16.0, same files) prints `got hi true`, `wexit 0`, `EXIT 0`.
`worker_threads.ts` takes no keepalive ref and its `ref`/`unref` are no-ops. The
kernel Worker is spawned `serve: true`, so a worker thread never exits by itself
(absorbed draft `runtime-js/worker-threads-kernel-run-to-completion-exit`). If
the parent were counted without fixing that, it would hang instead. The draft's
map fog line (which handle vitest's silent exit drains on) was answered by
`message-port-ref-keepalive` (ADR-0447).

Node's model (evidence §Node's Worker reference model) has two holds per
Worker. `Symbol(kHandle)` is referenced from construction. `Symbol(kPublicPort)`
is referenced while the Worker has `'message'` listeners. `Worker#ref`/`unref`
call through both. napi-rs neuters `ref` through those own objects, so rolldown's
pool never holds vite/vitest. Inside a worker, `parentPort` is referenced by its
`'message'` listeners. Natural exit never calls a reassigned `process.exit`,
which vitest's pool workers patch. That answers the map's open question for
every node-entry owner. Carrier: ADR-0446.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P3 verified)

## Reference contract

- Oracle: Node v24.16.0 `worker_threads` (`Worker`, `parentPort`, the internal
  `setupPortReferencing` / `kDispose` read from `process.binding('natives')`) and
  natural process exit. Real consumers, from npm 11.17.0's install of the goal
  scenario: `@rolldown/binding-wasm32-wasi` 1.0.3 `rolldown-binding.wasi.cjs:62-91`,
  `@emnapi/wasi-threads` 1.2.1, `@emnapi/core` 1.10.0, vitest 4.1.11
  `init-threads.6kl1khcL.js:9-11` and `base.B6Opl8PE.js:108-110`.
- Mechanism (ADR-0446): each Worker has two own symbol-keyed reference objects,
  and each referenced one is one ADR-0152 keepalive ref. `Worker#ref`/`unref` use
  Node's own code. The Worker's `'message'` listeners drive `kPublicPort` through
  `'newListener'`/`'removeListener'`. At the Worker's end both are released and set
  to `null` before `'exit'`. In the worker realm, `parentPort` is a listener-driven
  reference. The Workbench bootstrap drains a worker-thread realm without a cap and
  exits the Node way, using the `NodeProcess` exit it captured before any user code.

## Acceptance

1. The parity runner (`kind: 'worker-env'`, a physical kernel Worker running the production node-entry bootstrap) matches live Node v24.16.0 stdout for Parity cases 1–7, and `kind: 'node-cli-eval'` matches stdout, stderr and status for Parity case 8. → I2, I3, ADR-0446
2. In a real Chromium child realm (`tests/browser-unit/worker-handle-keepalive.spec.ts`), `node main.cjs` runs each program in `tests/browser-unit/fixtures/worker-handle-keepalive-cases.ts`: Parity cases 1–7 verbatim, plus Parity cases 9–12. Each prints the same `WT|` rows and exits with the same code as a live Node run of the same sources, without timing out. → I2, I3, ADR-0446
3. Production build (`tests/e2e-prod/worker-threads-keepalive.spec.ts`): in the shell, `node keepalive.cjs` prints `KA|got hi true`, `KA|wexit 0`, `KA|EXIT 0`, and `node listener.cjs` prints `KA|echo ping`, `KA|echo-exit 1`. Both exit 0, matching the Node artifact (evidence §Prod programs). → I2, ADR-0446
4. Rolldown's wasm32-wasi pool never holds its parent. The existing real-package spec, `tests/browser-unit/message-port-ref-keepalive.spec.ts` "detached rolldown build on the vite 8 template completes as under Node", still passes, with its rows and exit 0 unchanged. The pool Workers run the napi-rs neutering from Parity case 4. → I2, I4, ADR-0446
5. `docs/public/compat/process.md` gets these rows. ✅: Worker keepalive (`ref`/`unref`, `'message'`-listener referencing, `parentPort` referencing) and worker-thread natural exit, which replaces the ⚠️ "Worker-thread natural exit" row. ⚠️: the internal reference objects' shape, the public-port-only `'exit'` delivery, and the same-realm fallback's worker lifetime. ❌: the kernel-path `'error'` for a worker-runtime throw. → ADR-0446

## Parity cases

Sources: `tools/node-parity-runner/cases/worker_threads/*.case.ts` (1–7),
`tools/node-parity-runner/cases/process/natural-exit-patched-process-exit.case.ts` (8),
and `tests/browser-unit/fixtures/worker-handle-keepalive-cases.ts` (9–12). Node rows: evidence §Parity cases and §Browser-unit programs.

1. `handle-keepalive`: a Worker that posts after 300 ms is the program's only pending work. Node rows: `start`, `message late`, `exit 0`. → I2, ADR-0446
2. `handle-reference-api`: Node's reference shape and transitions, ending unreferenced so the worker's late rows never print. Node rows: `symbols Symbol(kHandle) Symbol(kPublicPort)` … `removed-once false,false` (the 14 rows in evidence). → I2, ADR-0446
3. `handle-listener-reference`: after `unref()`, a first `'message'` listener holds the parent until the message arrives, and a `once` listener holds only until it fires. Node rows: `start`, `first message late`, `second message late1`; `late2` never prints. → I2, ADR-0446
4. `handle-napi-rs-unref`: rolldown's `onCreateWorker` neutering runs verbatim, followed by emnapi's `once`/`unref`/`ref`/`on` calls, and nothing holds. Node row: `neutered false false true true`. → I2, ADR-0446
5. `worker-natural-exit`: worker realms drain and exit. Messages come before `'exit'`, the code is `exitCode ?? 0` or the explicit `exit(5)`, the worker's own `'exit'` listener runs, a reassigned `process.exit` is ignored, and both references are `null` after exit. Node rows: 4 rows in evidence. → I2, ADR-0446
6. `worker-port-reference`: the worker-side `parentPort` reference API and its drain cases (`once`, `off`, `unref()` with a listener). Node rows: 4 rows in evidence. → I2, ADR-0446
7. `worker-port-held`: a referenced `parentPort` keeps its worker alive until `terminate()`. That covers `on`, `onmessage`, a bare `ref()`, and `removeAllListeners('message')`, which does not unreference. Node rows: 4 rows `… exit:1 terminate:1`. → I2, ADR-0446
8. `natural-exit-patched-process-exit` (`node -e`): natural exit ignores a reassigned `process.exit`. Node: `patched-exit` gives stdout `tick\nexit-event 0\n`, no stderr and status 0; `patched-exit-code` gives `exit-event 4` and status 4. → I3, ADR-0446
9. `i2-oracle`: the goal's `t3.cjs`. Node rows: `WT|got hi true`, `WT|wexit 0`, `WT|EXIT 0`, code 0. → I2
10. `unref-process-exit`: an `unref()`'d Worker. The process's `'exit'` fires first and no worker row prints. Node rows: `WT|start`, `WT|EXIT 0`, code 0. → I2
11. `patched-exit-program` (`node <file>`): Node rows `WT|tick`, `WT|exit-event 0`, code 0. → I3, ADR-0446
12. `patched-exit-exec-sync` (the execSync child's natural exit): Node rows `WT|child tick`, `WT|child exit-event 0`, `WT|exec-ok`, code 0. → I3, ADR-0446

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| `torn-state` × repeated `ref`/`unref`, `'message'` listener add/remove, and calls after exit on one Worker | Each reference object adds at most one hold and releases only its own. After `'exit'`, both are `null`, `ref()`/`unref()` do nothing, and nothing is held (Node rows) | Parity 2 (transition rows), Parity 5 (`after-exit:null,null,undefined,undefined`) | → I2, ADR-0446 |
| `torn-state` × a Worker constructor that throws (invalid path, `eval` with a URL) | no hold is taken; a valid Worker holds from construction | `worker_threads-keepalive.fault.test.ts` "takes no hold when the constructor throws…" | → ADR-0446 |
| `observable-order` × worker messages (including one posted from the worker's own `'exit'` listener) vs the parent's `'exit'` | every message arrives before `'exit'`; the hold is released only at the Worker's end | Parity 5 (`message:first message:second exit:0`, `message:worker exit event 0 exit:0`) | → I2, ADR-0446 |
| peer death (fault-classes §Boundary: dedicated Worker) × a kernel peer closing, or the DOM Worker boundary refusing the spawn | `'error'` then `'exit'` 1, and every hold the Worker took is released; the parent never hangs | `worker_threads-keepalive.fault.test.ts` rows 1–2 (real ProcessManager; only the absent DOM Worker is substituted) | → I2, ADR-0446 |
| `unbounded-read` × a worker whose `parentPort` stays referenced | the worker and its referencing parent stay alive until `terminate()` or Ctrl-C, as in Node. The worker drain is uncapped; the parent's own drain policy is unchanged (the terminal `node` is uncapped, `.bin`/execSync keep ADR-0152 §4's loud 30 s cap) | Parity 7 | → I2, ADR-0152 |
| `provenance-lie` × napi-rs replacing `ref` on the reference objects | no later `ref()` or `'message'` listener holds again; rolldown's pool never pins its parent | Parity 4; Acceptance 4 | → I2, ADR-0446 |
| `sibling-drift` × natural-exit owners (worker thread, `node <file>`, `node -e`, execSync child; the parity runner's worker-env adapter) | the same Node exit on each: one `'exit'` with `exitCode ?? 0`, never through a reassigned `process.exit` | Parity 5, 8, 11, 12; Acceptance 1 (adapter) and 2 (Workbench bootstrap) | → I2, I3, ADR-0446 |

## Out of scope

- Kernel-path `'error'` for a worker-runtime throw: Node emits `'error'` (the real Error) and then `'exit'` 1. Rifty emits only `'exit'` 1, which is unchanged. Draft `runtime-js/worker-threads-kernel-error-event`; compat ❌. A kernel peer death still emits `'error'` first.
- The internal reference objects carry only `ref`/`unref`/`hasRef`. Node's `kHandle` has `startThread`, `getResourceLimits`, … and its `kPublicPort` is a `MessagePort`, so `instanceof MessagePort` is `false` here and other members read `undefined`. Node's other own Worker symbols (`kPort`, `kNewListener`, …) are absent. Compat ⚠️.
- `'exit'` delivery when the only hold is the listener-referenced public port. Node's delivery depends on its loop timing (evidence §Unref'd port hold); rifty always delivers it. Compat ⚠️.
- Node's listener cleanup at exit (`removeAllListeners('message')` before `'exit'`, all listeners after): unchanged, not claimed.
- `terminate()` before the worker starts: Node reports `'exit'` 0 and resolves 0, rifty 1. This predates the unit, is not claimed, and is recorded as a discovery (evidence §Discoveries).
- The same-realm fallback (no SAB or no kernel URL) keeps its own worker lifetime. Its Worker still takes and releases the parent holds. Not claimed; compat ⚠️.
- The no-COI in-process project command's natural exit (`no-coi-project-command.ts:145`): an unclaimed owner (ADR-0445), recorded as a discovery.
- Worker `stdout`/`stderr` streams and `execArgv`: map item 11. `eval: true` and `data:` URL entries: unchanged loud gaps.

## Decisions

ready-verdict: 2026-09-24 — Contract+RED @ 09f929faa197f35ead4f1474aff91e35b304bd2b
- 2026-09-24 — carrier: ADR-0446, a short ADR citing ADR-0152 §1 (following ADR-0158 and ADR-0447) that decides ADR-0445 rule 6's worker-thread clause. Rejected: #349's single hold without Node's objects, a real MessagePort as `kPublicPort`, #351's `serve:false` + kernel drain hook, and a kernel-side IPC count.
- 2026-09-24 — scope: absorbs `runtime-js/worker-threads-kernel-run-to-completion-exit`. The draft and its `worker_threads.ts` TODO marker are deleted when this unit lands. Its 2026-09-10 parent-lifetime question ("does a pending kernel Worker message keep its CJS parent alive?") is answered by Parity 1/9: a live Worker holds its parent.
- 2026-09-24 — scope: the map's open question (natural exit calls the reassignable `process.exit`, owner: agent, first exercised here) is answered for every node-entry owner (ADR-0446 §6, Parity 5/8/11/12, traced to I3). The no-COI owner is recorded as a discovery.
- 2026-09-24 — carriers: the parity-runner worker-env adapter must run worker-thread launches through the Workbench bootstrap (sibling-drift row). Every row whose Node outcome is not timing-dependent has a live-Node carrier. No carrier puts an `'exit'` listener on a Worker held only by its public port (evidence §Unref'd port hold).
