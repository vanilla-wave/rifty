---
area: runtime-js
status: draft
title: fs.ReadStream is Node's Readable subclass, opened and read through fd, in every class shape packages use
created: 2026-11-25
why: Today fs.ReadStream is a hand-written EventEmitter. It has no paused mode, no for await, no read/pause/setEncoding/close, and a late listener silently reads nothing. In the isolate it fails at the first read.
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/c-late-listener.txt]
code: [packages/runtime-js/src/builtins/fs-streams.ts]
---

## Context

Unit 4 of the goal (I4). Node's `ReadStream` (`lib/internal/fs/streams.js:164-320`) is a
`Readable` subclass:

- the function constructor works without `new`;
- `_construct` opens the file, and calls a monkey-patched `open()` when one is present (`:57`,
  graceful-fs);
- `_read` reads with `fs.read(fd)`;
- `_destroy` closes the fd;
- `close(cb)` is `finished` + `destroy`.

It stands on unit 1: `_construct`/`_destroy` are never called today (`m1`).

Main `b6d37fc01` (`m4`): 3 of 18 rows equal Node in-process and 2 of 18 in the isolate.

- `instanceof Readable` is false.
- `pause`, `resume`, `read`, `setEncoding`, `close`, `_read`, `_construct`, `[Symbol.asyncIterator]`
  are `undefined`.
- `ReadStream(p)` without `new` and `ReadStream.apply(this)` throw `Class constructor
  FileReadStream cannot be invoked without 'new'`.
- `pipe` to a slow Writable buffers 300000 bytes where Node buffers 65536.
- `destroy(err)` emits no `'error'`.
- In the isolate, every read gives `NotImplementedError isolate-host.ReadableStream`, because the
  async VFS's `openReadable` returns a web stream.

The fd path Node reads through (`fs.open`/`fs.read`/`fs.close` callbacks) gives Node's result on all
three columns today (`m4` row «Node's ReadStream source»). So the expected outcome on the isolate
host is that the read wall goes away with this unit and PR #437's sync-only wiring is not needed
(map §Links).

Absorbs:

- `fs-readstream-pipe-node-options`;
- `fs-readstream-set-encoding`;
- the read half of `fs-stream-class-call-shape` and of `fs-stream-close-method-missing`;
- `distribution/isolate-host-fs-read-stream-needs-web-readablestream`;
- the branch-only `fs-streams-not-node-streams` (read half) and `fs-read-stream-flows-without-consumer`.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
