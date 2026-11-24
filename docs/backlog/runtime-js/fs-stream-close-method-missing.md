---
area: runtime-js
status: ready
title: fs.ReadStream and fs.WriteStream have Node's close([callback])
created: 2026-11-24
why: Node's fs streams have `close(cb)`; rifty's are absent members, so `stream.close()` throws `TypeError: stream.close is not a function` after the work itself succeeded.
user_story: As an agent editing an existing workbook in an isolate sandbox, I want `wb.xlsx.readFile(path)` to read it, but today exceljs's `stream.close()` throws after the read
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-repro.cjs`, isolate-host sandbox vs
Node v24.16.0): `typeof fs.createReadStream(f).close` and `typeof fs.createWriteStream(f).close`
→ Node `function`, rifty `undefined`. `FileReadStream` / `FileWriteStream` extend `EventEmitter`
(`fs-streams.ts:272`, `:532`) and define no `close`, `closed`, `destroySoon`; `destroyed` is
the private guard field, so it reads `false` after `'end'`/`'finish'`/an error where Node reads
`true`. Not in compat fs.md's `createReadStream` / `createWriteStream` row.

Node 24 (`lib/internal/fs/streams.js`): `ReadStream#close(cb)` =
`if (typeof cb === 'function') finished(this, cb); this.destroy()`; `WriteStream#close(cb)` =
`if (cb) { if (this.closed) nextTick(cb), return; this.on('close', cb) }; if (!this.autoClose)
this.on('finish', this.destroy); this.end()`;
`WriteStream#destroySoon === WriteStream#end`. Orders below probed live (scratch parity cases, rifty @ 82a7738c7); rifty throws at
the first `close` call.

## Challenge

challenge: 2026-11-24 — none (existing-baseline repair: a Node member rifty lacks; premise
inherited from the library probe)

## User scenario

exceljs 4.4.0 in an isolate-host sandbox (probe route `require('exceljs/lib/doc/workbook')`,
`isolate-library-probe/gen/diag-outputs.cjs`): `await new Workbook().xlsx.readFile('w.xlsx')`
reads the workbook through `fs.createReadStream`, then calls `stream.close()`
(`exceljs/lib/xlsx/xlsx.js:56`). Today: `TypeError: stream.close is not a function`; Node:
resolves, `getWorksheet('S').getCell('A1').value === 'a'`.

## Acceptance

1. Parity `fs/read-stream-close` and `fs/write-stream-close` (sync-mirror path) green vs live
   Node; the same code as isolate-host corpus rows (`installMemoryFs`, async `openReadable`
   path, the browser hosts' and isolate guest's) green vs `node -e` → scenario
2. `probe.mjs diag-outputs diag-repro` in the isolate sandbox: the `exceljs xlsx.readFile (read
   back)` and both `typeof … .close` lines equal real node's → scenario
3. compat fs.md `createReadStream` / `createWriteStream` row states `close`/`destroySoon`/
   `closed`/`destroyed` support and names the remaining Readable/Writable gap with its backlog
   item; no "no close()" text → scenario

## Reference contract

- Oracle: Node v24.16.0 (`lib/internal/fs/streams.js` close/destroySoon; `finished` from
  `lib/internal/streams/end-of-stream.js` for ReadStream's callback).
- Mechanism: reproduced on rifty's EventEmitter streams; no copy of `finished`. Rows run
  concurrently (one per stream, own file): the parity harness caps a case's drain at 1 s.

## Parity cases

ReadStream (`close(cb)`; cb argument, `this`, `closed`/`destroyed` printed in it) → scenario:

1. before `'open'` / after `'ready'` / in `'open'` / after a `destroy()` / mid-`'data'`
   (`highWaterMark: 10`): `open|ready|close|cb(ERR_STREAM_PREMATURE_CLOSE)`, `this` the stream,
   `closed=true destroyed=true`; no `'end'` → scenario
2. after `'close'` of a fully read stream, and inside `'end'`: `end|close|cb()` (zero
   arguments) → scenario
3. twice (pre-open and post-open): both callbacks, same argument, after one `'close'` → scenario
4. missing file, before the error: `error:ENOENT|cb(ENOENT)|close`; inside `'error'` / after
   `'close'`: `error|close|cb(ENOENT)`; `close()` with no cb before open: `error:ENOENT|close`
   → scenario
5. directory target after `'open'`: `open|ready|close|cb(ERR_STREAM_PREMATURE_CLOSE)` → scenario
6. `emitClose:false`: post-open close → no `'close'`, cb never called, `closed=true`; after or
   inside `'end'` → `cb()` with `destroyed=true` (`closed` not printed: Node's flips after its
   async `fs.close`, out of scope below); with a missing file → `cb(ENOENT)` → scenario
7. `close()` returns `undefined`; non-function arg ignored; synchronously after `close()`
   `closed=false destroyed=true`; in `'end'` handler `destroyed=false`, after settle `true`;
   in `'error'` handler `closed=true destroyed=true` → scenario

WriteStream (`close(cb)` = `on('close', cb)` + `end()`; file content printed) → scenario:

WriteStream rows print `wcb`/`ecb`/`dcb` with one (`null`/`undefined`) argument; `cb` gets
zero, `this` the stream via `on('close')`, not the stream when already closed (nextTick).

8. pending write pre-open / post-open / inside `'ready'`: data lands,
   `wcb|finish|close|cb()` → scenario
9. no cb; twice (same tick and after `'close'`, the latter `this` not the stream); after
   `end(chunk, cb)`; inside `'finish'`: one `finish|close`, every cb called once → scenario
10. `write()` after `close()`: `wcb(ERR_STREAM_WRITE_AFTER_END)` with `destroyed=true` before
    `'open'`, then `open|ready|error:ERR_STREAM_WRITE_AFTER_END|close|cb()`, file empty
    → scenario
11. open failure (`EISDIR`, `wx` on an existing file) with close before the error, inside
    `'error'`, after `'close'`: `error|close|cb()`; inside `'error'` and after `'close'`
    `this` is not the stream (`closed` already true) → scenario
12. `emitClose:false`: before finish → cb never called; 10 ms after `'finish'` (past Node's
    async `fs.close`) → `cb()` → scenario
13. after `destroy()`, and `destroy()` right after `close()`: `close|cb()`, no `'finish'`,
    pending pre-open bytes discarded → scenario
14. `highWaterMark: 2` write then `close()`: `write()` returns `false`, no `'drain'` → scenario
15. `close()` returns `undefined`; after `close()` sync `closed=false destroyed=false`; in `'finish'` handler
    `destroyed=false`, after settle `true`; in `'error'` handler `closed=true destroyed=true`
    → scenario
16. `destroySoon === end`, returns the stream; `destroySoon(chunk, cb)`; a second
    `destroySoon(cb)` after `'close'` → `cb(ERR_STREAM_ALREADY_FINISHED)` → scenario

## Out of scope

- `autoClose: false` stays `NotImplementedError('fs.createReadStream.autoClose:false')` /
  `('fs.createWriteStream.autoClose:false')` at create (compat ❌ "Stream unsupported
  options"), so `close()`'s `!autoClose` branch is unreachable: `runtime-js/fs-stream-autoclose-false`
  (Node facts there).
- fs streams are not `stream.Readable`/`Writable` (no `pause`/`resume`/async iteration,
  `readable*`/`writable*`, `bytesRead`/`bytesWritten`, `pending`, `fd`, Node `flags`/`mode`):
  `runtime-js/fs-streams-not-node-streams`.
- `'close'` timing vs Node's async `fs.close` (rifty emits it in the tick of `'end'`/`'finish'`;
  observable only between microtasks) — same item.
- `WriteStream#close('notfn')`: Node throws `ERR_INVALID_ARG_TYPE` from `on('close', cb)`;
  rifty's EventEmitter accepts any listener and throws at `'close'`:
  `runtime-js/events-listener-argument-validation`.
- A pre-aborted `signal` followed by a synchronous `destroy()`/`close()` drops the abort error:
  `runtime-js/fs-readstream-preaborted-signal-sync-destroy`.

## Decisions

- ReadStream callback = Node's end-of-stream rules for a readable that will emit `'close'`
  (or not, `emitClose:false`), reimplemented in `fs-streams.ts`; rifty `stream.finished` is
  not reused (approximate: `runtime-js/stream-pipeline-finished-callback-args`).
- `closed`, Node `destroyed` and `end()` returning the stream ship here: `close()`'s
  contract reads `closed`, parity case 7/15 prints both, and `destroySoon` is `end`.
- `autoClose:false` not built here: a mode with its own corners (fd kept past `'end'`/
  `'finish'`; Node's `close()` after `'finish'` never closes) — beyond `close()`; the create-time
  throw keeps it loud.
- Pre-open `destroy()` of a missing file emits the open error unless the stream already
  errored (Node); the old rule swallowed it for every pre-open destroy, generalized from the
  pre-aborted-signal case.
- No `'drain'` after `end()` (Node `afterWrite` checks `!ending`): case 14 is `close()` with
  unwritten data.
- `fs-streams.ts` sits at its ratchet (1016): option/flag helpers move to
  `fs-stream-options.ts` to make room.
