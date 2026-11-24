---
area: runtime-js
status: draft
title: fs.createReadStream reads the file it opened, live, as Node
created: 2026-11-24
why: rifty's read stream delivers bytes taken at one moment (sync path after 'open', async path before it) where Node reads its open file description live, so a file changed while streamed yields stale bytes and an unlink inside 'open' yields an ENOENT Node never raises
user_story: As a program that unlinks a temp file once its read stream opened it (or appends to a log another stream tails), I want the stream to read the opened file as Node does, but today rifty errors with ENOENT or delivers the old bytes
sources: [docs/backlog/distribution/isolate-host-fs-read-stream-needs-web-readablestream.md, docs/backlog/runtime-js/fs-read-stream-flows-without-consumer.md, docs/public/compat/fs.md, docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, packages/vfs/src/memory.ts, packages/vfs/src/memory-backend.ts]
---

## Context

Discovered during `distribution/isolate-host-fs-read-stream-needs-web-readablestream`
(2026-11-24). Node v24.16.0 (`lib/internal/fs/streams.js`): `ReadStream` opens an fd in
`_construct` and `fs.read`s it by position per `_read` until `_destroy` closes it — writes
through the same inode are seen, an unlink leaves the inode readable. rifty
(`fs-streams.ts` `FileReadStream.start`): the sync fallback (`asyncVfs()` null — the parity
runner, the isolate guest) emits `'open'`/`'ready'`, then takes the whole file by path
(`syncMirror().readFileBytesSync`); the async path (`installMemoryFs`, the browser hosts)
takes it in `MemoryVfs.openReadable` before `'open'` (`memory.ts`). Neither reads by position
afterwards. `MemoryBackend.writeFile` sets a new file node under the name (`makeFile`), so the taken
array stays old — and a stream holding the old node would not see the write either (Node's
`writeFileSync` truncates and writes the same inode).

Probe (scratch, file `'abcdefghij'`, `highWaterMark: 4`, events and chunk text printed; rifty
@ 14005d833 and again @ fbb4468a4 (same rows) in-process per path; the isolate via `runCode` on the sync-only guest carrier of
that unit equals the sync column):

| scenario | Node | sync path | async path |
|---|---|---|---|
| `writeFileSync(f, 'ABCDEFGHIJKLMNOP')` in 1st `'data'` | `abcd EFGH IJKL MNOP` | `abcd efgh ij` | `abcd efgh ij` |
| `appendFileSync(f, 'XYZ')` in 1st `'data'` | `abcd efgh ijXY Z` | `abcd efgh ij` | `abcd efgh ij` |
| `writeFileSync(f, 'ab')` in 1st `'data'` | `abcd` end | `abcd efgh ij` | `abcd efgh ij` |
| `unlinkSync(f)` in `'open'` | `abcd efgh ij` | `error:ENOENT:read` close | `abcd efgh ij` |
| `writeFileSync(f, 'OPEN-REWRITE')` in `'open'` | `OPEN -REW RITE` | `OPEN -REW RITE` | `abcd efgh ij` |

Same on both paths and as Node: `unlinkSync` in the 1st `'data'` (rest delivered), a write or
unlink synchronously after `createReadStream` (taken at open). Isolate corpus `ceiling:` row
`fs-read-stream-changed` pins today's output.

Root: no open-file handle in rifty's FS surface (`FsSync`/`Vfs` are path-based); shared with
`runtime-js/fs-read-stream-flows-without-consumer` and open PR #434's
`fs-streams-not-node-streams` (Node's stream is a `Readable` holding its fd from `_construct`
to `_destroy`). Dedup: grep `createReadStream`/`ReadStream`/`unlink`/`snapshot` over
`docs/backlog`, `docs/process/traps.md`, ADR §Declined — `fs-read-stream-flows-without-consumer`
(flowing without a consumer, not the read source), `vfs/memory-vfs-openreadable-true-backpressure`
(flow control); no match.

Owner: runtime-js (fs streams) with vfs (the read source). Trigger: a program that
unlinks or rewrites a file while streaming it (temp-file idiom, log tailing), or fs streams
becoming `stream.Readable` (their read source is chosen there).
