---
area: runtime-js
status: draft
title: fs.read(0) calls back outside the I/O turn: a stdin read loop starves timers, an error callback runs before a promise queued after it
created: 2026-11-26
why: "`fs.read(0, …, cb)` takes stdin's own path (`readStdin`), not the fs I/O turn (`fs-io-turn.ts`): Node completes it on a loop turn like every other fs request"
sources: ["PR #468 external review (manager-relayed, 2026-11-26)", packages/runtime-js/src/builtins/fs-io-turn.ts]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-stdio.ts]
---

## Context

PR #468 (`runtime-js/fs-callbacks-io-turn`) routes every other async fs request through
`ioTurn`. `fs.read(0, …)` still goes to `readStdin`, and its synchronous error goes back to the
callback in a `queueMicrotask`. Measured by the PR #468 external review (2026-11-26, Node v24.16.0,
in-process runner, 10 000 bytes on stdin):

- `fs.read(0, …)` on a seekable-position error, with a promise and an immediate queued after it:
  Node `promise,cb:ESPIPE,immediate`, rifty `cb:ESPIPE,promise,immediate`.
- 512 chained 1-byte `fs.read(0)` reads under `setInterval(…, 0)` (`/tmp/xr468-sol-stdin-chain.cjs`
  in the review): Node `ticks>0=true` 30/30, rifty `ticks>0=false`.

Not re-measured per host. Compat: `docs/public/compat/fs.md` (async completion row). Dedup: no
stdin or fs-turn match (`runtime-js/node-stdin-program` is `node -`'s program source).

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
