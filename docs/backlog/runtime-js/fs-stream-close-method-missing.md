---
area: runtime-js
status: draft
title: fs.ReadStream lacks close() and async iteration, fs.WriteStream lacks close()
created: 2026-11-24
why: Node's fs streams are `stream.Readable`/`Writable` with `close(cb)`; rifty's are EventEmitters without `close` or `Symbol.asyncIterator`, so `stream.close()` throws `TypeError: stream.close is not a function` and `for await (const c of rs)` throws `TypeError: rs is not async iterable`.
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-repro.cjs`, isolate-host sandbox vs
Node v24.16.0): `typeof fs.createReadStream(f).close` and `typeof fs.createWriteStream(f).close`
→ Node `function`, rifty `undefined`; `typeof fs.createReadStream(f)[Symbol.asyncIterator]` → Node
`function`, rifty `undefined` (`gen/diag-fsread.cjs`). `FileReadStream` / `FileWriteStream` extend
`EventEmitter` (`fs-streams.ts:272`, `:532`) and define neither. Measured in the isolate guest
only; the class is shared by every host (source).

Real path: exceljs 4.4.0 `wb.xlsx.readFile(path)` calls `stream.close()` after `read(stream)` and
in its catch (`exceljs/lib/xlsx/xlsx.js:56`, `:59`, read from source at the lock version) →
`TypeError: stream.close is not a function`; in the isolate guest the read itself already failed
(`distribution/isolate-host-fs-read-stream-needs-web-readablestream`) and this TypeError masks it.
exceljs `xlsx.read` would iterate the stream (`xlsx.js:247-253`), falling back to `pipe` when
`Symbol.asyncIterator` is absent. Consumer-side route: `wb.xlsx.load(fs.readFileSync(path))`.

Owner: runtime-js (fs streams). Trigger: a guest package closing or async-iterating an fs stream
it opened (any host); first measured consumer: exceljs read-back (isolate library probe).

## Challenge

challenge: 2026-11-24 — none (factual capture, library probe)
