---
area: runtime-js
status: ready
title: Every stream hook rifty has (`_transform`, `_flush`, `_write`, `_writev`, `_final`, `_read`) runs as in Node however it is defined
created: 2026-11-24
why: Node calls a subclass's `_transform`/`_flush`/`_write`; rifty's Transform and Duplex take only constructor options or instance own properties, so `class X extends Transform { _transform() }` silently becomes a PassThrough and a Duplex subclass's `_write` drops its data — wrong output with exit 0, while compat streams.md claimed `Transform` ✅.
user_story: As an agent running exceljs in a rifty sandbox, I want `wb.csv.writeBuffer()` to return Node's CSV bytes, but today fast-csv's `CsvFormatterStream extends Transform` passes row arrays through unformatted and exceljs throws
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/transform.ts, packages/io/src/streams/duplex.ts, packages/io/src/streams/writable.ts, packages/io/src/streams/readable.ts, packages/io/src/streams/pass-through.ts, packages/io/src/streams/callable-constructor.ts, tools/compat-matrix-generator/streams-inventory.js]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-repro.cjs`, isolate-host sandbox vs
Node v24.16.0): `class T extends Transform { _transform(c, e, cb) { this.push('<'+c+'>'); cb() } }`,
`end('x')` → Node `<x>`, rifty `x`; a subclass `_flush` pushing `!` → Node `y!`, rifty `y`.
`class D extends Duplex { _read() {} _write(c, e, cb) { log(c); cb() } }`, `end('d')` → Node logs
`d`, rifty nothing. Real path: exceljs 4.4.0 `wb.csv.writeBuffer()` → `@fast-csv/format`
`CsvFormatterStream` (subclass `_transform`, `CsvFormatterStream.js:6-55`) passes the row arrays
through, and exceljs's `StreamBuf.write` throws `Chunk must be one of type String, Buffer or StringBuf.`

Matrix probe 2026-11-24 (class × hook × way, live Node v24.16.0 vs rifty parity runner, same
program). Ways: constructor option; own property after construction; ES `class extends`
prototype method; ES5 `util.inherits` + `Base.call(this, opts)`; two-level subclass chain;
prototype method assigned after construction. Code read confirms each cause:

- Transform/PassThrough: `prepareTransform` (`transform.ts`) reads only `opts.transform`/`opts.flush`;
  no `_transform`/`_flush` lookup exists. Every non-option way → chunks pass through, `_flush`
  never runs. PassThrough replaces a user `transform` option with its identity, so even the
  option way is ignored. A `final` option and a prototype `_final` on a Transform are ignored.
- Duplex: the inner writable honours `_write`/`_final` only as instance own properties
  (`ownFunction`, `duplex.ts`); prototype ways drop the data. `write`/`writev`/`final` options run
  with `this` = the internal writable side, not the Duplex. A `writev`-only Duplex drops every chunk
  (the wrapper `write` always exists, so `_writev` is never chosen).
- `_destroy`/`_construct`: absent on every class and way — a lifecycle change, split out to
  `runtime-js/stream-destroy-construct-hooks` (manager, 2026-11-24).
- Missing hook: Node throws `ERR_METHOD_NOT_IMPLEMENTED` (`_write()`, `_transform()`); rifty's base
  Writable `_write` succeeds silently, a hookless Duplex drops writes, a hookless Transform passes through.
- Readable `_read` and Writable `_write`/`_writev`/`_final` already dispatch through the prototype
  chain on every way (late `this._read`/`this._write` lookup) — the reference model.

The same `@riftydev/io` streams back `node:stream` on every host (`runtime-js/src/builtins/stream.ts`):
browser hosts and the isolate guest.

## Challenge

challenge: 2026-11-24 — none (existing-baseline repair: compat promised ✅, Node behavior measured)

## User scenario

exceljs 4.4.0 in an isolate-host sandbox (`isolate-library-probe`, `xlsx-workbook` route):
`const wb = new Workbook(); wb.addWorksheet('s').addRow(['a', 1]); await wb.csv.writeBuffer()`
→ Node: the CSV bytes `a,1`; rifty today: throws
`Chunk must be one of type String, Buffer or StringBuf.` (fast-csv `CsvFormatterStream._transform`
never runs).

## Acceptance

1. Every parity case below passes against live Node v24.16.0 (`pnpm test:parity stream/stream-hook`),
   committed RED before the fix → scenario
2. The probe's `gen/diag-repro.cjs` and `gen/diag-outputs.cjs` lines for the Transform/Duplex
   subclass hooks and exceljs `csv.writeBuffer` equal real Node in the isolate-host sandbox
   (`probe.mjs` run, output recorded in the PR) → scenario
3. compat streams.md `Transform` row returns to ✅ only where the parity cases prove it (one
   `@riftydev/io` for every host); `_destroy`/`_construct` get an honest ❌ row → scenario

## Reference contract

- Oracle: Node v24.16.0 `lib/internal/streams/{readable,writable,duplex,transform,passthrough,destroy}.js`.
- Mechanism: hooks are looked up on the stream at call time through its prototype chain;
  constructor options install own `_x` properties; base prototypes carry Node's defaults
  (`_write` → `_writev` or `ERR_METHOD_NOT_IMPLEMENTED`, `_transform` throws, no base `_final`,
  `_writev` `null`); Transform's `_final` runs `_flush`, and a replaced `_final` still gets `_flush`
  on `'prefinish'`; a Duplex calls its hooks with `this` = the Duplex.

## Parity cases

1. `stream/stream-hook-transform`: Transform and PassThrough × 6 ways × `_transform`+`_flush` —
   Node calls each, data `<a><b>!`; a Transform `_final` (every way) runs and `_flush` still runs
   after it → scenario
2. `stream/stream-hook-duplex`: Duplex × 6 ways × `_read`+`_write`+`_final` — each called, `this`
   is the Duplex; `_writev` batches a pile-up behind a pending `_write`; a `_writev`-only Duplex
   delivers every chunk → scenario
3. `stream/stream-hook-readable-writable`: Readable `_read`, Writable `_write`/`_writev`/`_final` ×
   6 ways (already Node; guard) → scenario
4. `stream/stream-hook-missing`: no hook → `write()` throws `ERR_METHOD_NOT_IMPLEMENTED`
   (`_write()` for Writable/Duplex, `_transform()` for Transform), bare and subclassed; Readable
   emits `_read()` → scenario

## Out of scope

- `_destroy`/`_construct` (no hook on any class; destroy/construct lifecycle) — backlog
  `runtime-js/stream-destroy-construct-hooks`, RED matrix in its `reference/`; compat ❌ row.
- `Duplex`/`Transform` `cork`/`uncork`/`writableCorked`/`setDefaultEncoding`: absent on Duplex
  (`TypeError: d.cork is not a function`) — backlog `runtime-js/duplex-writable-surface-gaps`.
- Transform/Duplex event order (`'finish'` before `'end'` or `'data'`, no `'close'` after both sides end) —
  backlog `runtime-js/duplex-end-finish-close-order`; parity cases here assert hook calls, data and
  errors, never `'finish'`/`'end'`/`'close'` relative order on a Duplex.
- `readableObjectMode`/`writableObjectMode` options (ignored) — `runtime-js/duplex-writable-surface-gaps`.
- Transform callback backpressure (Node holds the `_transform` callback while the readable buffer is
  full): unchanged here.
- Pending-write callback errors after `destroy()` (message/code) — unchanged here.

## Decisions

- Node's dispatch model, not more override lookups: options → own `_x`; base prototypes carry Node's defaults.
- Duplex keeps its embedded Writable; that side calls the Duplex's `_write`/`_writev`/`_final` with `this` = Duplex.
- `_destroy`/`_construct` split out (manager): they need a new lifecycle, not dispatch.
- No real fast-csv fixture: its lock pulls `@types/node`; the probe run (Acceptance 2) and the fast-csv-shape case cover it.
- The symbol-keyed writable-side factory, symbol hooks and own-property overrides are deleted; their tests go with them.
- `Writable.prototype._final` is removed (Node has none); Transform's prefinish rule needs that distinction.
- `_writev` on Duplex is proven by a pile-up behind a pending write, since Duplex `cork` is missing (Out of scope).
