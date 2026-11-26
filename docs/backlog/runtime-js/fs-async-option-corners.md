---
area: runtime-js
status: draft
title: "Async fs option corners Node honours and rifty does not: `encoding: 'buffer'` for names, `opendir` `recursive`, `opendir` option read counts, `cp` error code"
created: 2026-11-26
why: "A program asking for Buffer names, a recursive Dir or matching `cp` errors gets another result than in Node; each exists on main, found while widening `fs/async-options-at-call`"
sources: ["PR #468 review round 3 (R3-7, manager-relayed, 2026-11-26)", tools/node-parity-runner/cases/fs/async-options-at-call.case.ts]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-arguments.ts, packages/runtime-js/src/builtins/fs-dir.ts]
---

## Context

Measured 2026-11-26, Node v24.16.0 vs PR #468 in-process (and main `c2250727d` where it has the
API), a directory `d/e/f`:

| call | Node | rifty |
|---|---|---|
| `fs.readdir('d', 'buffer', cb)` | entries are `Buffer`s | strings |
| `fs.mkdtemp('t', 'buffer', cb)` | a `Buffer` | a string |
| `fs.opendir('d', { recursive: true }, cb)`, every `read()` | `e`, `f` | `e` |
| `fs.opendir('d', o, cb)`, `o` getters counting reads | `encoding` 6, `signal` 3, `bufferSize` 1, `recursive` 1 | `encoding` 5, the rest equal |
| `fs.cpSync`/`fs.promises.cp` of a directory without `recursive` | `ERR_FS_EISDIR` | `EISDIR` (main too) |

`fs/async-options-at-call` pins only what equals Node: its `promises.cp recursive` row prints
whether the copy happened, not the error code.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
