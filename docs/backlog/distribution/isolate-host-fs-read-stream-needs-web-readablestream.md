---
area: distribution
status: draft
title: In the isolate guest fs.createReadStream fails at the first read with the ReadableStream ceiling
created: 2026-11-24
why: rifty's own fs read stream reads through `Vfs.openReadable`, which builds a web `ReadableStream` — a ceiling global in the isolate guest — so every `fs.createReadStream` read emits `NotImplementedError('isolate-host.ReadableStream')` where Node reads the file; the guest never named web streams.
epic: isolate-guest-web-api
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/isolate-host.md]
code: [packages/vfs/src/memory.ts, packages/runtime-js/src/builtins/fs-streams.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-fsread.cjs`, isolate-host sandbox vs Node
v24.16.0): `fs.createReadStream('t.txt')` with a `'data'` listener → Node `abc`; the guest emits
`'error'` `NotImplementedError: Not implemented: isolate-host.ReadableStream` with frames
`new ReadableStream < MemoryVfs.openReadable < FileReadStream.start`; with no `'error'` listener
the run ends exit 1. Code: `FileReadStream` reads via `Vfs.openReadable`
(`packages/runtime-js/src/builtins/fs-streams.ts:445`), `MemoryVfs.openReadable`
(`packages/vfs/src/memory.ts:64`) returns a web stream; `ReadableStream` is in the guest's
`CEILING_GLOBALS` (`packages/isolate-guest/src/guest/web-shim.ts:343`). Same mechanism class as
`runtime-js/isolate-web-globals-captured-at-load` (a runtime path depending on a host global the
isolate withholds). Browser hosts have the global; not run there.

Real path: exceljs 4.4.0 `wb.xlsx.read(fs.createReadStream(f))`, `wb.csv.read(fs.createReadStream(f))`
and `wb.xlsx.readFile(f)` (whose catch then hits `runtime-js/fs-stream-close-method-missing`,
masking this error) — the agent's "edit the previous workbook" turn. Consumer-side route:
`wb.xlsx.load(fs.readFileSync(f))`.

Compat: isolate-host.md row "`fs.createReadStream` reads".

Owner: distribution (isolate host) with vfs/runtime-js (the read path). Trigger: the isolate
guest's web-stream ceiling being lifted (ROADMAP M14 E), or a guest program reading a file as a
stream — whichever comes first; the fork is whether the read path stops needing the web global or
the guest gets it.

## Challenge

challenge: 2026-11-24 — none (factual capture, library probe)
