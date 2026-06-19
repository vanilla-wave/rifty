---
area: playground
status: parked
title: Extract a shared `runForegroundChild` driver across the owner-child executors
created: 2026-06-20
why: owner-child-node-executor.ts and glue/bin-executor.ts duplicate the same foreground machinery (decodeChunk + stream-with-outputClosed + SIGTERM-on-abort + settle-on-exit); the node executor can't reuse createBinExecutor because the listening-server case needs a wider seam (on('message')→onListening + onExit registry-remove + 'exit'-before-pre-abort listener order). owner-child-dev-server.ts shares only the stream block.
user_story: As a rifty maintainer I want ONE foreground-child driver so the node/bin/dev-server executors don't re-implement stream/abort/exit and drift.
sources: [ADR-0137, ADR-0154]
code: [apps/playground/src/workers/owner-child-node-executor.ts, apps/playground/src/glue/bin-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts]
---

## Context

ADR-0154 §1 (Corrected 2026-06-20) records that `createOwnerChildNodeExecutor` MIRRORS — not reuses —
`createBinExecutor`: it needs a `rifty:node-listening` `on('message')`→`onListening` hook + an `onExit`
registry-remove + the reverse `'exit'`-before-pre-abort listener order (kill() emits `'exit'`
synchronously). So `createBinExecutor`'s `(binPath,args,ctx)=>Promise<number>` seam can't carry it, and
the node executor reimplements `decodeChunk` (==bin) + the stream/outputClosed guard + SIGTERM-on-abort
+ settle-on-exit inline. Real duplication today: ~40 lines node-vs-bin + 3× `decodeChunk`.

## Options or Next

Extract `runForegroundChild(handle, ctx, { onMessage? })` returning `Promise<number>` that owns
decodeChunk/stream/outputClosed + SIGTERM-on-abort + settle-on-exit (with the exit-listener registered
before the pre-abort kill). node + bin both ride it (bin passes no `onMessage`; node passes the
listening hook + registers `onExit` in its own exit handler). dev-server does NOT fit cleanly (resolves
on `rifty:dev-ready` MESSAGE not exit, exit-before-ready = reject, separate stop()/kill, returns a
handle not a number) — leave it, or only share `decodeChunk`. Avoid widening the published `BinExecutor`
seam (ADR-0137) for one consumer.

## Reversibility

REVERSIBLE — internal refactor of duplicated driver code + tests; no public API or wire change.
