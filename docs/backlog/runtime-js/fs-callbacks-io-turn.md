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

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| VFS error × any callback API | the error reaches the callback in the same kind of I/O turn as a success; never thrown synchronously | callback-turn-order case, error rows | → I10 |
| SAB sync-RPC oversize reply × callback on Workbench | the in-band error reply reaches the callback as an error, in its I/O turn | fault test with a reply over the ring size | → I10 |
| SAB sync-RPC responder death mid-exchange × callback on Workbench | unchanged by this unit: the ring's loud permanent wedge, the caller blocked until owner teardown (no timeout exists in production, `packages/kernel/src/ipc/sync-client.ts:21`); no callback runs with partial data | fault test killing the responder in `HANDLING`, asserting the wedge diagnostic and no callback | → I10 |
| two callback APIs in flight × one ring | each sync exchange completes before the callback's turn is queued, so two exchanges never overlap on the ring (a second claim would fail loudly) | callback-turn-order case, interleaved calls | → I10 |

## Out of scope

- The speed of each fd call: units 4b and 4c.
- Sync APIs: they stay synchronous.

## Decisions

- Callbacks complete in a host macrotask turn, not a microtask. This unit picks the shape per host
  (MessageChannel or `setImmediate`).
- A `process.nextTick` queued before an fs call still runs before its callback, as in Node.
