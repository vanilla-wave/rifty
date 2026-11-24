---
area: runtime-js
status: draft
title: fs.WriteStream / fs.ReadStream cannot be applied to an existing object as Node's callable constructors can
created: 2026-11-24
why: graceful-fs wraps `fs.WriteStream`/`fs.ReadStream` with `fs$WriteStream.apply(this, arguments)`; rifty's ES classes throw `Class constructor FileWriteStream cannot be invoked without 'new'`, so every graceful-fs `createWriteStream`/`createReadStream` fails (fstream's next stop after `process.umask`).
sources: [docs/backlog/runtime-js/process-umask-missing.md, docs/backlog/runtime-js/zlib-class-call-shape.md, docs/backlog/net/http-agent-call-shape.md, docs/adr/runtime-js/0353-callable-node-stream-constructors-preserve-legacy-initialization.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

Probe 2026-11-24 (PR #432 branch, isolate-host `runCode` vs `node -e`, Node v24.16.0):
`const o = Object.create(fs.WriteStream.prototype); fs.WriteStream.apply(o, ['w.txt'])` →
Node ok, rifty `TypeError: Class constructor FileWriteStream cannot be invoked without 'new'`;
`fs.ReadStream` the same (`FileReadStream`). Both are ES classes (`fs-streams.ts:272`, `:532`).

Real path (isolate-library-probe deps, sandbox `exec`): `fstream.Writer({ path }).end('hello')`
→ graceful-fs 4.x `new WriteStream` (`graceful-fs/graceful-fs.js:322`, `fs$WriteStream.apply`)
via `createWriteStream` (`:345`) ← `fstream/lib/file-writer.js:36` → uncaught TypeError, exit 1;
Node writes the file. fstream comes through unzipper → exceljs 4.4.0 main entry (behind
`node:zlib` ❌ today). graceful-fs is a dependency of many packages, so the reach is wider than
fstream. Same defect class as `runtime-js/zlib-class-call-shape` and `net/http-agent-call-shape`;
ADR-0353's `packages/io/src/streams/callable-constructor.ts` covers the io stream classes
only; the fs streams extend `EventEmitter`, not io `Readable`/`Writable` — the same root as
`runtime-js/fs-readstream-set-encoding`, `fs-readstream-pipe-node-options`,
`fs-stream-close-method-missing`. Compat fs.md `createReadStream` / `createWriteStream` row
names it (added with this capture).

Owner: runtime-js (fs streams). Trigger: library-compat work (fstream/unzipper, exceljs main),
or any graceful-fs stream call.

## Challenge

challenge: 2026-11-24 — none (factual capture)
