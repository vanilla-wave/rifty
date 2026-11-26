---
area: runtime-js
status: ready
title: fs callback APIs complete in an I/O turn, so timers interleave with them as in Node
created: 2026-11-25
why: rifty's fs.read/fs.write call back through a Promise microtask chain, so a read loop starves timers (0 ticks over 16 MiB, Node > 0)
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-fs-streams.txt]
---

## Context

Unit 4 of goal `node-streams-as-in-node` (map). rifty's fs callback APIs complete through a
`Promise.resolve().then(...)` chain (`packages/runtime-js/src/builtins/fs.ts`), so a chain of callbacks
never yields to timers.

Measured today:
- `docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt` «timers run during an fs.read(fd) loop over 16 MiB»: Node gives
  `ticks>0=true`, rifty gives `false` in-process and in the isolate.
- Workbench and SDK: 0 ticks on every fd path (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/`).
- Node's own `fs.WriteStream` over this fs (route B): `docs/backlog/epics/node-streams-as-in-node/reference/results/m5-writestream.txt` «timers run while a
  WriteStream writes» gives `ticks>0=false`, where today's class gives `true`. Route B's write side
  therefore stands on this unit (`docs/backlog/epics/node-streams-as-in-node/reference/results/ownership.txt`).

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. `m4` «timers run during an fs.read(fd) loop over 16 MiB» = Node (`ticks>0=true`) on in-process, isolate, Workbench and SDK. → I10
2. These guard rows stay = Node: `b1` «fs.read callback vs a timer due now» and «fs.write then fs.close in the same tick: bytes land»; `m5` «timers run while a WriteStream writes 16 MiB» in-process and in the isolate (the only hosts where it equals Node today; Workbench gives 0 ticks, `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-d/summary.txt`, so it is no guard there and not this unit's promise). → I10
3. Every case of `tools/node-parity-runner/cases/fs` (41) stays green. → I10
4. Regression lanes stay green: no `packages/*/src` code consumes the guest `fs` callback API (shell, kernel, npm-client and the module loader go through `FsSync`/`Vfs`), so the consumers are guest libraries. They are caught by the isolate-host library tests (`packages/isolate-host/tests/library-exceljs.test.ts`, `library-pptxgenjs.test.ts`) and the e2e dev-server specs (`tests/e2e/generic-dev-server-lifecycle.spec.ts`, `react-vite-*.spec.ts`, `vite7-build-preview.spec.ts`, `webpack-dev-server.spec.ts`). → I10

## Parity cases

1. A new `tools/node-parity-runner/cases/fs/callback-turn-order.case.ts`. It records the order of `fs.readFile`/`stat`/`open`/`read`/`write`/`close` callbacks against: `setTimeout(0)`; `setImmediate`; `process.nextTick`; a promise queued before and after each call. → I10

   It also runs a loop of 256 callback reads and prints whether `setInterval(0)` ticked (a boolean).
2. The same order for error callbacks (ENOENT `stat`, EBADF `read`). → I10
3. `fs.promises` settles in the same turn shape (`readFile`, `stat`, ENOENT `stat`; loops of 256 under a
   0 ms interval). → I10
4. The class rows of Acceptance 5, pinned only where Node gave N/N (counts in the case). → I10
5. The lifecycle rows of Acceptance 6 (carrier on Workbench/SDK, isolate test, parity in-process where
   its `process` is rifty's). → I10

Pinned rows hold 240/240 (16 parallel) in Node or are stable by construction (synchronous checks).
Not pinnable (Node varies, v24.16.0): `read(fd)`'s buffer right after the call (`000` 97/100) or in a microtask (`000` 18/20, `777` 2);
`readFileSync` right after an async write (`writeFile` `''` 18 / old 2; `write(fd)` new 18 / old 2;
`fs.promises.writeFile` `''` 7 / old 13); the completion order of several ops in flight at once.
Declared, not this unit: a multi-round-trip `writeFile` whose bytes the caller mutates in a
`setImmediate` (Node `9,9,9`, rifty `1,2,3`: Node opens first, writes a round trip later) — a
round-trip model, the class draft's.
`'beforeExit'` around the last callbacks (Node: `beforeExit 0`, a `stat` it schedules, `beforeExit 0`,
`exit 0`, 20/20) is never emitted on a rifty host (`runtime-js/process-before-exit-event`): the chain row
pins `'exit'` after the last callback. ESM and `worker.terminate()` rows: Workbench (no ES loader, no
`worker_threads` in the isolate; SDK `Worker` and no-SW `child_process` are pinned ceilings).

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| VFS error × any callback API | the error reaches the callback in the same kind of I/O turn as a success; never thrown synchronously | callback-turn-order case, error rows | → I10 |
| SAB sync-RPC oversize reply × callback on Workbench | the in-band error reply reaches the callback as an error, in its I/O turn | fault test with a reply over the ring size | → I10 |
| SAB sync-RPC responder death mid-exchange × callback on Workbench | unchanged by this unit: the ring's loud permanent wedge, the caller blocked until owner teardown (no timeout exists in production, `packages/kernel/src/ipc/sync-client.ts:21`); no callback runs with partial data | fault test killing the responder in `HANDLING`: no callback, the caller blocked until teardown, then the next caller's exchange refused (`previous request is being handled`) | → I10 |
| SAB sync-RPC responder death × the process end on Workbench | the end runs the submitted op over the ring: the same wedge, blocked until owner teardown, no exit request, no callback (2026-11-26, manager) | fault test: exit in the tick of a submitted `stat`, responder dead in `HANDLING` | → I10 |
| two callback APIs in flight × one ring | each sync exchange completes before the callback's turn is queued, so two exchanges never overlap on the ring | by construction, not by test: an operation is one synchronous call inside one host turn, so no mutant can overlap two (2026-11-26, external review); the case's interleaved row checks the outcomes only | → I10 |

## Out of scope

- The speed of each fd call: units 4b and 4c.
- Sync APIs: they stay synchronous.

## Decisions

- Callbacks complete in a host macrotask turn, not a microtask. This unit picks the shape per host
  (MessageChannel or `setImmediate`).
- A `process.nextTick` queued before an fs call still runs before its callback, as in Node.
- 2026-11-26 (manager): one `ioTurn(op)` for the callback APIs and `fs.promises.*`; `op` runs in the
  first host turn, the outcome settles in the second, so the immediates queued beside a call precede
  its completion (Node 40/40 from an fs callback). `FileHandle` is compat ❌ (no surface to route).
- 2026-11-26 (manager): the process end (`exit()`, a fatal error, one call from `#terminate` and
  `beginFatal`) runs the operations in flight with no callback or promise, as Node joins its threadpool
  (Node 20/20 + 80/80 under load: `write(fd)`+`exit()` → `"data"`, uncaught throw and unhandled
  rejection → `"data"` exit 1, an op an `'exit'` listener submits before an explicit `exit()` → written,
  `exit()` in an fs callback with another write in flight → both — later 239/240, not pinned). Its errors neither surface nor change
  the status; it runs only what is in flight then. An external stop is not a process end:
  `worker.terminate()` drops the not-yet-run op (Node: a queued request is cancelled — pool saturated,
  10/10 `""`; one already running completes, idle pool 79/80 `"data"`: not pinned), a sandbox stop
  does not run it (no Node counterpart; compat isolate-host.md).
  Not pinnable (Node varies): an op an `'exit'` listener submits at a natural exit (13/20 not written).
- 2026-11-26 (manager): cost accepted, two turns stay — the numbers (micro loops, library tests,
  `react-vite-preset` phases and `ioTurn` counters) are in PR #468; no per-batch operation turn.
- 2026-11-26 (manager, external review of PR #468): the completion turn is the host's I/O phase where
  it has one — a Node host's `MessagePort` (poll), so an immediate queued in an fs callback runs
  before a due 0 ms timer (Node's guarantee, `fs/callback-phase-order` 240/240); the operation turn
  stays a check-phase immediate, so timers get their phase every loop turn. Isolate and browsers: the
  immediate queue (browser and isolate order declared: `runtime-js/fs-completion-loop-phase-order`). An immediate's turn
  is bound to its id (a cleared one leaves an empty turn).
- 2026-11-26 (manager): only data bytes are read in the operation turn; a callback form fixes its
  options (copy), path (`Buffer`/`URL` → string), positions and lengths at the call and validates its
  callback there (`makeCallback`; `opendir` names it `callback`, `close` defaults it, `rm` checks
  options instead); a promise form reads its options as it goes (Node's `fs/promises`).
- 2026-11-26 (manager): `Dir` is Node's `dir.js` (batches of `bufferSize`, buffered reads on
  `process.nextTick`, operation queue, closed-handle errors). `fs.read(0)` keeps stdin's path:
  declared (`runtime-js/fs-read-stdin-turn`). The process end also runs the submitted operations before
  the `'exit'` listeners (Node's pool has usually finished them: 212/240, not pinned).
- Host turn = rifty's `setImmediate`, driven per host: a Node host's own `setImmediate` (a Node
  `MessagePort` drains up to 1000 messages per loop turn: 512 chained messages gave 0–1 timer ticks),
  the isolate bridge's next host turn (`timerStart` 0 ms → host `setImmediate`, was a 1 ms timer),
  Chromium's `MessageChannel`. No `setTimeout` (4 ms clamp).
