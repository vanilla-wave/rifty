---
area: runtime-js
status: draft
title: A stream's `_destroy` and `_construct` hooks never run, however they are defined
created: 2026-11-24
why: Node calls `_destroy(err, cb)` on every `destroy()` and `_construct(cb)` before the first read/write; rifty has neither hook on any stream class, so cleanup never runs, a replaced error is never reported and work starts before construction — silently, exit 0.
sources: [docs/backlog/runtime-js/reference/stream-destroy-construct-hooks/matrix.cjs, docs/backlog/runtime-js/reference/stream-destroy-construct-hooks/node-v24.16.0.txt, docs/backlog/runtime-js/reference/stream-destroy-construct-hooks/rifty-diff.txt, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts, packages/io/src/streams/callable-constructor.ts]
---

## Context

Found by PR #433 (stream hook dispatch), split out by the manager: that unit
fixes dispatch of hooks rifty already has; these two need a new destroy/construct lifecycle.

Matrix 2026-11-24 (`reference/stream-destroy-construct-hooks/matrix.cjs`: Readable, Writable, Duplex,
Transform, PassThrough × option / own property / ES class / ES5 inherits / chain / late prototype, plus
lifecycle rows). Run: `node matrix.cjs` (Node v24.16.0 → `node-v24.16.0.txt`); rifty: the same file
as a parity-runner case (`code: readFileSync(matrix.cjs)`) at `c957fbe43` → `rifty-diff.txt`
(69 of 76 lines differ; the Duplex/Transform/PassThrough `_construct` rows also carry the
hook-dispatch gap of the parent unit — `ops=R`, `ops=` — which PR #433 fixes). Node behaviour measured there:

- `_destroy(err, cb)`: called with the destroy error, `this` = stream, every way; its callback error
  replaces the destroy error; `'error'`/`'close'` follow the callback (async callback delays them);
  `destroyed` true synchronously; once per Duplex/Transform; a second `destroy()` does not call it; a
  write error reaches it. rifty: never called, emits the original error.
- `_construct(cb)`: read once at construction (option/prototype ways run it, own/late never), called on
  the next tick even when synchronous; `_read`/`_write`/`_transform`/`_final` wait for its callback; a
  callback error destroys through `_destroy`; `destroy()` during construction calls `_destroy` after
  the callback. rifty: never called, work runs immediately.
- `Readable/Writable/Duplex/Transform/PassThrough.prototype._destroy` is a function in Node
  (`Duplex.prototype._destroy === Readable.prototype._destroy`); rifty: `undefined`.
- Destroy moment after a failing `_final`/`_flush` (PR #433 review round 2, reproduced 2026-11-24;
  `new Writable({ write(c,e,cb){cb()}, final(){ throw new Error('boom') } })`, `end('x', cb1)`, then
  `destroyed`, `end(cb2)`, `write('y', cb3)`): Node `sync destroyed=true | end1 boom | end2
  ERR_STREAM_DESTROYED | wcb ERR_STREAM_WRITE_AFTER_END`; rifty `sync destroyed=false | wcb boom |
  end1 boom | end2 boom` — rifty destroys a tick later (`finalize` defers `destroyInternal`), so later
  calls see an errored, not destroyed, stream. Same for a synchronous `cb(err)` from `_final`, before
  PR #433 too.
- Sibling, outside the title: rifty has no `errored` getter on Readable/Writable (`sync errored=undefined` row).

Code: `Readable.destroy`/`Writable.destroyInternal` emit directly, no hook; no `constructed` state;
`initializeReadable`/`initializeWritable` read no `destroy`/`construct` option. Writable's internal
`onDestroy` (used by `Writable.fromWeb`) is the only teardown hook.

Owner: runtime-js (`@riftydev/io` streams). Trigger: the next library-compat unit (manager, thread
cf2ae711), or any package defining `_destroy`/`_construct` (fs-like streams, archivers). Compat
streams.md `_destroy` / `_construct` row ❌.

## Challenge

challenge: 2026-11-24 — none (factual capture, matrix vs live Node)
