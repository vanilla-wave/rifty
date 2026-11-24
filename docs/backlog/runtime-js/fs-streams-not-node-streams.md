---
area: runtime-js
status: draft
title: fs.ReadStream / fs.WriteStream are stream.Readable / stream.Writable
created: 2026-11-24
why: rifty's fs streams are hand-rolled EventEmitters, so a late `'data'` listener silently gets nothing, `for await` / `pause` / `resume` throw, and `instanceof stream.Readable` is false where Node inherits the whole Readable/Writable surface
sources: [docs/backlog/runtime-js/fs-stream-close-method-missing.md, docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

Discovered during `runtime-js/fs-stream-close-method-missing` (2026-11-24; scratch parity
cases, Node v24.16.0 vs rifty @ 82a7738c7, sync-mirror path). `FileReadStream` /
`FileWriteStream` (`fs-streams.ts`) extend `EventEmitter`, not `Readable` / `Writable`.

Silent wrong behavior — a read stream emits `'data'` whether or not anyone listens:

```
const rs = fs.createReadStream('l.txt');           // 'hello'
setTimeout(() => rs.on('data', (c) => (s += c)), 20);
node:  late data listener got: "hello"
rifty: late listener after 50ms got: ""            (no 'end' either)
```

### Read steps are microtasks (declared class)

rifty's read stream advances by microtask continuations (open a microtask after create; each
read step, `highWaterMark: 0`'s end, a directory's `EISDIR` one microtask after the previous —
one guarded loop, `FileReadStream.pump`); Node's are I/O turns, some end-of-read events
`nextTick`s. Every consequence below is this one class, on all three read paths alike (sync
mirror, `installMemoryFs`, workbench `SyncMirrorVfs`; measured on PR #434's head, Node
v24.16.0; reviewer scripts `xreview-434-r2-claude/sc-hops.mjs`, `sc-windows.mjs`,
`xreview-434-codex/late.mts` + `nextTick`/`setImmediate`/`pipe`). A request (close/destroy)
up to one microtask after `'ready'`/`'data'` behaves as Node (parity `fs/read-stream-close`
rows sit on that boundary); later ones do not:

| situation | Node v24.16.0 | rifty |
|---|---|---|
| `close(cb)` 2 microtask hops after `'ready'`, `'data'` listener | `REQ\|close\|cb(PREMATURE)` | `data\|REQ\|close\|cb(PREMATURE)` |
| the same ≥3 hops, `nextTick`, `setImmediate`; `const s = await open(); await null; s.close()` | `REQ\|close\|cb(PREMATURE)` | `data…\|end\|close\|REQ\|cb()` |
| `const s = await open(); s.close()` (`open` awaits `'ready'`) | `REQ\|close\|cb(PREMATURE)` | `data\|REQ\|close\|cb(PREMATURE)` |
| directory, `'data'` listener, `close(cb)` a microtask after `'ready'` | `REQ\|error:EISDIR\|cb(EISDIR)\|close` | `REQ\|close\|cb(PREMATURE)`; `destroy()`: the error is lost silently |
| directory, the same ≥2 hops | as above | `error:EISDIR\|close\|REQ\|cb(EISDIR)` |
| `highWaterMark: 0`, `close(cb)` a microtask after `'ready'` | `ready\|end\|REQ\|close\|cb()` (end on a tick) | `ready\|REQ\|close\|cb(PREMATURE)` |
| `close(cb)` in the `'data'` of a decoder's flushed tail | `end\|cb()\|close` | `end\|close\|cb()` |
| `close()` a microtask after `'end'` | `end\|REQ\|close\|cb()` | `end\|close\|REQ\|cb()` (`'close'` timing, below) |

Late consumers — `'data'`+`'end'` listeners, or `pipe(createWriteStream(…))`, attached after
N `await Promise.resolve()` / a `nextTick` / a `setImmediate` / a 20 ms timer, 5-byte file
(Node: `hello` + `'end'`, pipe copies, in every row):

| attached after | sync mirror (parity runner, sync-RPC fs, dev-server child) | async `openReadable` (`installMemoryFs`) |
|---|---|---|
| 0–1 awaits | `hello`, end, pipe copies | `hello`, end, pipe copies |
| 2 awaits | `""`, end, pipe empty | `hello`, end, pipe copies |
| 3 awaits | `""`, no end, pipe empty | `""`, end, pipe empty |
| ≥4 awaits, `nextTick`, `setImmediate`, a timer | `""`, no end, pipe empty | `""`, no end, pipe empty |

Each further step loses one more chunk on a multi-chunk file. The read also runs with no
`'data'` listener (non-flowing): `close(cb)` ≥3 hops after `'ready'` gives `end|close|REQ|cb()`.

Absent or different public members (`typeof` / value right after create, Node | rifty):

- both: `instanceof stream.Readable` / `Writable` true | false; `stream.isReadable(rs)`
  true | null; `pending` true | undefined; `fd` null | undefined; `mode` 438 | undefined;
  `autoClose` true | undefined; `errored` null | undefined.
- ReadStream: `pause`, `resume`, `read`, `setEncoding` (`runtime-js/fs-readstream-set-encoding`),
  `unpipe`, `unshift`, `wrap`, `isPaused`, `push`, `[Symbol.asyncIterator]`, `iterator`, `map`,
  `filter`, `toArray` function | undefined; `pipe` own, not `Readable#pipe`
  (`runtime-js/fs-readstream-pipe-node-options`); `bytesRead` 0, 5 at `'end'` | undefined;
  `flags` 'r' | undefined; `start` undefined | a function (private method leaks); `end`
  Infinity | undefined; `readable`, `readableEnded`, `readableHighWaterMark`, `readableFlowing`,
  `readableAborted`, `readableDidRead`, `readableEncoding`, `readableLength`,
  `readableObjectMode` | undefined.
- WriteStream: `cork`, `uncork`, `setDefaultEncoding` function | undefined; `bytesWritten`
  0 | undefined; `flags` 'w' | the parsed-flags object; `pos` undefined | 0 (private field
  leaks); `writable`, `writableEnded`, `writableFinished`, `writableHighWaterMark`,
  `writableLength`, `writableNeedDrain`, `writableObjectMode`, `writableCorked` | undefined.
- `stream.finished(rs, cb)` success: cb gets 0 arguments | 1 (`null`) —
  `runtime-js/stream-pipeline-finished-callback-args`. `stream.pipeline(rs, ws, cb)` copies.
- `destroy(err)` ignores `err` on both streams in every state before `'close'` (after it Node
  ignores it too) (Node: `'error'` with it, then
  `'close'`; `errored` = it): pre-open existing file → rifty `open|ready|close`, missing file →
  rifty `error:ENOENT|close` (Node `error:mine|close`), after `'ready'` → `close`; `errored`
  undefined (Node `null`, then the error). Scratch case, Node v24.16.0.
- The open is a microtask after create (class above): a callback Node delivers a tick after a
  pre-open `close()` lands after rifty's `'ready'` (`emitClose:false` + `close(cb)` twice
  pre-open: Node `cb2|ready`, rifty `ready|cb2`).
- `'close'` follows `'end'` / `'finish'` in the same tick; Node emits it after the async
  `fs.close` (a `closed` read or `WriteStream#close(cb)` between microtasks differs; e.g. the second
  `close(cb)` with `emitClose:false` sees `closed=true`, Node `false`).

Async iteration (also probed by `isolate-library-probe/gen/diag-fsread.cjs`): `for await (const c
of rs)` → rifty `TypeError: … is not async iterable`; exceljs `xlsx.read(stream)` iterates when
`Symbol.asyncIterator` exists and falls back to `pipe` otherwise (`xlsx.js:247-253`).

Not declared: compat fs.md's `createReadStream` row is ⚠️ but named only `pipe` and `close`.
Same as Node: `path` (the given path), `destroy`, `write`/`end` overloads. Same root as
`fs-readstream-set-encoding` and `fs-readstream-pipe-node-options` (no inherited
`Readable.prototype`). Dedup: grep `fs-streams.ts` / `ReadStream` over
`docs/backlog`, `docs/process/traps.md`, ADR §Declined — only those two siblings.

Owner: runtime-js (fs streams). Carrier undecided (subclass `@riftydev/io` streams vs
keep and complete the EventEmitter classes) — the unit's first decision. Trigger: a package
consuming an fs read stream by `for await`, a late `'data'`/`pipe`, `pause`/`resume`, or a
`readable*`/`writable*`/`bytes*` member; the next library-compat stop on fs streams.
