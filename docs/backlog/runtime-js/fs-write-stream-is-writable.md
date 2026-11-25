---
area: runtime-js
status: draft
title: fs.WriteStream is Node's Writable subclass in every class shape packages use (graceful-fs WriteStream.apply + overridden open)
created: 2026-11-25
why: Today fs.WriteStream is a hand-written EventEmitter. graceful-fs's `fs$WriteStream.apply(this)` throws, so every graceful-fs/fs-extra/fstream write stream fails, and cork, close, prefinish and `errored` are missing.
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/m5-writestream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/c-graceful-fs.txt]
code: [packages/runtime-js/src/builtins/fs-streams.ts]
---

## Context

Unit 5 of the goal (I5). Node's `WriteStream` (`lib/internal/fs/streams.js:325-560`) is a
`Writable` subclass:

- the function constructor works without `new`;
- `_construct` opens the file, and calls a monkey-patched `open()` when one is present;
- `_write`/`_writev` write through the fd;
- `_destroy` closes it;
- `close(cb)` exists.

It stands on unit 1 and reuses unit 4's shared part (`_construct` with the monkey-patched `open`
path, `_destroy` closing the fd, the callable constructor shape), so it comes after 4.

Run at `8ec679b04` (main `b6d37fc01`'s code), `m5`: 4 of 14 rows equal on every rifty column.

- `instanceof Writable` is false.
- `cork`, `uncork`, `setDefaultEncoding`, `close`, `destroySoon`, `_write`, `_construct` are
  `undefined`.
- `flags` is a parsed object (Node `'w'`), and a private `pos` leaks.
- `WriteStream(p)` without `new` and `WriteStream.apply(this)` throw `Class constructor
  FileWriteStream cannot be invoked without 'new'`. That is the graceful-fs carrier case (`c-graceful-fs`).
- There is no `'prefinish'`.
- `destroy(err)` emits no `'error'`.

Absorbs the write half of `fs-stream-class-call-shape` and of `fs-stream-close-method-missing`,
plus the branch-only `fs-streams-not-node-streams` (write half).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
