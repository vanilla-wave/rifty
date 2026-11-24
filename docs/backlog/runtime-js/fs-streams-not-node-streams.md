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
- `'close'` follows `'end'` / `'finish'` in the same tick; Node emits it after the async
  `fs.close` (a `closed` read or `WriteStream#close(cb)` between microtasks differs).

Not declared: compat fs.md's `createReadStream` row is ⚠️ but named only `pipe` and `close`.
Same as Node: `path` (the given path), `destroy`, `write`/`end` overloads. Same root as
`fs-readstream-set-encoding` and `fs-readstream-pipe-node-options` (no inherited
`Readable.prototype`). Dedup: grep `fs-streams.ts` / `ReadStream` over
`docs/backlog`, `docs/process/traps.md`, ADR §Declined — only those two siblings.

Owner: runtime-js (fs streams). Carrier undecided (subclass `@riftydev/io` streams vs
keep and complete the EventEmitter classes) — the unit's first decision. Trigger: a package
consuming an fs read stream by `for await`, a late `'data'`/`pipe`, `pause`/`resume`, or a
`readable*`/`writable*`/`bytes*` member; the next library-compat stop on fs streams.
