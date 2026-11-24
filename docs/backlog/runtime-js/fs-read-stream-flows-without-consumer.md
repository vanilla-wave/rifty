---
area: runtime-js
status: draft
title: An fs read stream waits for its consumer, as Node
created: 2026-11-24
why: rifty's fs read stream opens and emits its data in the microtasks of its creation whether or not anyone listens, so a `'data'` listener or `pipe` attached after an asynchronous step silently loses data where Node's paused stream delivers everything
user_story: As a program that creates a read stream, awaits something (a `mkdir`, an open of the destination) and then pipes it, I want every byte delivered as Node does, but today rifty has already emitted the data and the consumer gets part of it or nothing
sources: [docs/backlog/distribution/isolate-host-fs-read-stream-needs-web-readablestream.md, docs/public/compat/fs.md, docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts]
---

## Context

Discovered during `distribution/isolate-host-fs-read-stream-needs-web-readablestream`
(2026-11-24). `FileReadStream` (`fs-streams.ts`) extends `EventEmitter`: the constructor queues
`start()` as a microtask, which emits `'open'`/`'ready'` and the first chunk, then one chunk per
microtask, then `'end'`/`'close'` — with or without a listener. Node's `ReadStream` is a paused
`Readable`: nothing is read before a `'data'` listener, `pipe` or `resume`, and it opens after
an I/O turn.

Probe (isolate corpus `ceiling:` row `fs-read-stream-late-consumer`; file `'abcdefghij'`;
listeners attached after the named wait; Node v24.16.0 vs the isolate guest on the sync mirror
@ fbb4468a4 + this unit, equal to rifty's sync-mirror path in-process):

| wait after `createReadStream` | Node | rifty (sync mirror: isolate, parity runner) |
|---|---|---|
| hwm 4, 1 / 2 / 3 / 4 microtask steps | `abcd efgh ij end close` | `efgh ij end close` / `ij end close` / `end close` / nothing |
| one chunk (default hwm), 1 / 2 steps | `abcdefghij end close` | `end close` / nothing |
| `setTimeout(0)` / `setImmediate` | `abcdefghij end close` | nothing |
| `nextTick` + microtask queued at create, listeners synchronous | `micro tick open abcdefghij end` | `open abcdefghij tick micro end` |

The async `openReadable` path (browser hosts) loses later — 25 bytes at hwm 10: all after one
step, the first chunk after three (in-process probe). One microtask step = one `await` of a
settled value; `await f()` of an async function adds one more.

Not declared on main before this unit (compat fs.md `createReadStream` row named `pipe`/
`close` only). Same root as open PR #434's `runtime-js/fs-streams-not-node-streams` (fs streams
are not `stream.Readable`; recorded on that branch, not on main) — whichever lands second
folds into the other. Dedup: grep `createReadStream`/`ReadStream`/`late`/`listener` over
`docs/backlog`, `docs/process/traps.md`, ADR §Declined on main — `fs-readstream-pipe-node-options`
(pipe options), `fs-readstream-set-encoding` (a member), no match.

Owner: runtime-js (fs streams). Trigger: a program attaching its consumer after an `await`
(exceljs `xlsx.read(stream)` is not one: its probe line equals Node), or fs streams becoming `stream.Readable`.
