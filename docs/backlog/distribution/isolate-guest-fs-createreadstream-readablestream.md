---
area: distribution
status: draft
title: fs.createReadStream reads an existing file in the isolate guest
created: 2026-11-24
why: in the isolate guest every `fs.createReadStream` of an existing file emits `NotImplementedError('isolate-host.ReadableStream')` — rifty's own `MemoryVfs.openReadable` builds a web `ReadableStream`, a guest ceiling global; Node reads the file
user_story: As an agent editing an existing workbook in an isolate sandbox, I want `wb.xlsx.readFile(path)` to read it, but today the read stream errors before any data
sources: [docs/backlog/runtime-js/fs-stream-close-method-missing.md, docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/isolate-guest/src/guest/web-shim.ts, packages/vfs/src/memory.ts, packages/runtime-js/src/builtins/fs-streams.ts]
---

## Context

Discovered during `runtime-js/fs-stream-close-method-missing` (2026-11-24), once `close()`
stopped masking it. `runCode` (isolate-host build of this unit's branch):

```
const s = fs.createReadStream('a.txt');           // after writeFileSync('a.txt', 'abc')
s.on('error', (e) => console.log('ERR', e.message)); s.on('data', …); s.on('end', …);
isolate: ERR Not implemented: isolate-host.ReadableStream (not available in the rifty isolate host, ADR-0557)
           at new ReadableStream → MemoryVfs.openReadable → FileReadStream.start
node:    data abc / end
```

The guest entry runs `installMemoryFs()` (`entry.ts:46`), so `asyncVfs()` is set and
`FileReadStream` takes `Vfs.openReadable` (`memory.ts:74` `new ReadableStream`); the guest's
`CEILING_GLOBALS` (`web-shim.ts`) make that global a loud throw. A missing file still gives
`ENOENT` (stat first). Was undeclared (the isolate-host compat ✅ row claimed "fs on the in-memory VFS"); declared
by `runtime-js/fs-stream-close-method-missing`: compat isolate-host.md row ❌.

Library effect: probe `isolate-library-probe` `diag-outputs` after the close() fix —
`exceljs xlsx.readFile (read back): NotImplementedError: … isolate-host.ReadableStream`
(node: `ok string 1`); before it, exceljs's `stream.close()` in its catch threw the
`TypeError` that hid this error. The isolate corpus row `fs-read-stream-close` fails on it (`ceiling:`, expected failure).

Spike 2026-11-24 (not committed, on this unit's branch): `entry.ts` `installMemoryFs()` →
`setSyncMirror(new MemoryFsSync())` (no paired async VFS; fs-streams takes its sync-mirror
fallback, parity-proven vs Node; in the guest bundle only `fs-streams.ts` reads `asyncVfs()`).
Result: `packages/isolate-host` `tests/parity.test.ts` 176/176 incl. `fs-read-stream-close`;
probe `diag-outputs` `exceljs xlsx.readFile (read back)` equals node. Not run: the guest's
snapshot/restore tests, the rest of the isolate-host and isolate-guest suites. Cost: no true
streaming in the guest (whole-file `readFileBytesSync`, sliced per `highWaterMark`).

Open: the carrier (guest without a paired async VFS → the sync-mirror fallback; a
rifty-internal web-streams implementation the guest ceiling does not cover; MemoryVfs
streaming without web streams) — undecided. Dedup: grep `ReadableStream` / `openReadable` /
`createReadStream` over `docs/backlog`, `docs/process/traps.md` — `vfs/memory-vfs-openreadable-true-backpressure`
(backpressure, not availability), no match.

Owner: distribution (isolate guest) with vfs. Trigger: any guest program reading a file by
stream (exceljs `xlsx.readFile`, `readline` over a file, `pipeline(createReadStream…)`).
