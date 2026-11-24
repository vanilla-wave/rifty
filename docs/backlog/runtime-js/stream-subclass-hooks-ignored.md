---
area: runtime-js
status: draft
title: A stream.Transform or Duplex subclass's own _transform, _flush or _write never runs
created: 2026-11-24
why: Node calls a subclass's `_transform`/`_flush`/`_write`; rifty's Transform and Duplex take only constructor options or instance own properties, so `class X extends Transform { _transform() }` silently becomes a PassThrough and a Duplex subclass's `_write` drops its data — wrong output with exit 0, while compat streams.md claimed `Transform` ✅.
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/transform.ts, packages/io/src/streams/duplex.ts, tools/compat-matrix-generator/streams-inventory.js]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-repro.cjs`, isolate-host sandbox vs
Node v24.16.0): `class T extends Transform { _transform(c, e, cb) { this.push('<'+c+'>'); cb() } }`,
`end('x')` → Node `<x>`, rifty `x`; a subclass `_flush` pushing `!` → Node `y!`, rifty `y`.
`class D extends Duplex { _read() {} _write(c, e, cb) { log(c); cb() } }`, `end('d')` → Node logs
`d`, rifty nothing. A `transform` constructor option works on both, and so do Writable/Readable
subclasses (`_write`/`_read`). Code: `prepareTransform`
(`packages/io/src/streams/transform.ts:50-112`) reads only `opts.transform` / `opts.flush`
(or their symbol hooks), no `_transform` lookup exists in `packages/io/src`; the inner writable
side honours `_write`/`_final` only as instance own properties (`ownFunction`,
`packages/io/src/streams/duplex.ts:44-57`). Tests cover only the option path (`transform.test.ts`,
`tests/conformance/builtins/stream.test.ts:77`).
The same `@riftydev/io` Transform backs `node:stream` on every host (`runtime-js/src/builtins/stream.ts`);
measured only in the isolate guest, browser hosts not run.

Real path: exceljs 4.4.0 `wb.csv.writeBuffer()` → `@fast-csv/format` `CsvFormatterStream`
(subclass `_transform`, `CsvFormatterStream.js:6-55`) passes the row arrays through, and exceljs's
`StreamBuf.write` throws `Chunk must be one of type String, Buffer or StringBuf.`
(`exceljs/lib/utils/stream-buf.js:239`). A subclass whose output a sink accepts would write wrong
bytes with exit 0.

Owner: runtime-js (`@riftydev/io` streams). Trigger: a guest package subclassing
`stream.Transform`/`Duplex` with its own hooks (any host); first measured consumer: exceljs CSV
write (isolate library probe). The compat rows read ⚠️ until fixed.

## Challenge

challenge: 2026-11-24 — none (factual capture, library probe)
