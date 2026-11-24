---
area: runtime-js
status: draft
title: fs.WriteStream / fs.ReadStream cannot be applied to an existing object as Node's callable constructors can
created: 2026-11-24
why: graceful-fs wraps `fs.WriteStream`/`fs.ReadStream` with `fs$WriteStream.apply(this, arguments)`; rifty's ES classes throw `Class constructor FileWriteStream cannot be invoked without 'new'`, so every graceful-fs `createWriteStream`/`createReadStream` fails (fstream's next stop after `process.umask`).
sources: [docs/public/compat/process.md, docs/backlog/runtime-js/zlib-class-call-shape.md, docs/backlog/net/http-agent-call-shape.md, docs/adr/runtime-js/0353-callable-node-stream-constructors-preserve-legacy-initialization.md]
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

A callable constructor alone does not reach Node (PR #432 review, reproduced 2026-11-24, isolate
`runCode` vs `node -e`): graceful-fs 4.2.11 replaces `open` on its prototype
(`graceful-fs.js:243`, `:249`) and its `open` runs `open(that.path, that.flags, that.mode, cb)`, then
sets `that.fd`, emits `'open'`, and ReadStream calls `that.read()` (`:306`, `:315`, `:329`). rifty's
constructor calls `this.open()` through the prototype (`fs-streams.ts:584`), so rifty's own open
never runs, and its fields are not Node's: `[flags, mode, fd]` → Node `["w", 438, null]`, rifty
`[{append,exclusive,truncate,mustExist}, null, absent]`. A `Reflect.construct` subclass with a
graceful-fs-style `open` → rifty `EINVAL: invalid argument, open`, no file; Node writes `hello`.
So the unit is: Node's fields (`flags` string, `mode`, `fd`), the overridden-`open` branch (wait
for `'open'`, then I/O by `this.fd`), acceptance on the real graceful-fs. Related:
`runtime-js/fs-streams-not-node-streams` (record arrives with PR #434): fs streams are not Node
streams; no carrier chosen; whether and how to take this work is put to the user, no answer yet.

Owner: runtime-js (fs streams). Trigger: library-compat work (fstream/unzipper, exceljs main),
or any graceful-fs stream call.

## Challenge

challenge: 2026-11-24 — none (factual capture)
