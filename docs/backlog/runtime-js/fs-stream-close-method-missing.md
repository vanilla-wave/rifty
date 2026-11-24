---
area: runtime-js
status: draft
title: fs.ReadStream and fs.WriteStream have no close() method
created: 2026-11-24
why: Node's fs streams have `close(cb)`; rifty's are absent members, so `stream.close()` throws `TypeError: stream.close is not a function` after the work itself succeeded.
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-repro.cjs`, isolate-host sandbox vs
Node v24.16.0): `typeof fs.createReadStream(f).close` and `typeof fs.createWriteStream(f).close`
→ Node `function`, rifty `undefined`. `FileReadStream` / `FileWriteStream` extend `EventEmitter`
(`fs-streams.ts:272`, `:532`) and define no `close`. Not in compat fs.md's
`createReadStream` / `createWriteStream` row.

Real path: exceljs 4.4.0 `wb.xlsx.readFile(path)` reads the workbook, then calls `stream.close()`
(`exceljs/lib/xlsx/xlsx.js:56`, `:59` on error) → `TypeError: stream.close is not a function`;
the agent's "edit the previous xlsx" turn fails. Consumer-side route today:
`wb.xlsx.load(fs.readFileSync(path))`.

Owner: runtime-js (fs streams). Trigger: the library-compat work (ROADMAP M14 E,
requirements §6,
exceljs read-back), or any package closing an fs stream it opened.

## Challenge

challenge: 2026-11-24 — none (factual capture, library probe)
