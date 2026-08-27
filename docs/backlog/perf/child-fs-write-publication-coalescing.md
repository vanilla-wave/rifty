---
area: perf
status: draft
title: child writeChunk runs full owner publication per 256 KiB chunk — 4.4 s of a ~6 s product vite build
created: 2026-08-27
why: measured, not modeled — instrumented product lane run (2026-08-27, d4caf2e6a + uncommitted per-method counters in sync-dispatch + child-blocked timers in sync-rpc-fs): child blocked 7.49 s of a 10.75 s `vite build` command in sync-RPC; 6 fs.writeChunk calls cost 4,416 ms (~736 ms each), fs.mkdir 856 ms — 74% of product selfTime; probe volume explains only ~0.36 s (16,533 hops × 18 µs + 63 ms handlers), so this is THE dominant term of the product-vs-in-realm gap
user_story: As a dev running `vite build` in the product child, I want dist writes to cost owner-write speed, but today every 256 KiB output chunk runs the owner's full mutation-publication pipeline, so 6 chunk writes eat ~4.4 s of a ~6 s build.
sources: [docs/backlog/perf/reference/child-fs-rpc-hot-path.md, ADR-0150]
code: [packages/workbench/src/workers/workbench-project-vfs.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts]
---

## Context

Per-chunk cost is owner-side publication, not transport: each guest write chunk
runs `mutationGuard` → `admitMutation` → `withSemanticReplacements` +
`recordAppliedMutation` + `await publishThroughCurrent(true)`
(`workbench-project-vfs.ts` guard ~:555, applyMutation ~:496) — a full owner
tree publication per 256 KiB chunk. Owner VFS handlers themselves are trivial
(63 ms for 16.5 k calls). Same run: probe latency inflates 5–70× above the
18 µs idle hop while the owner digests publication work, so fixing writes also
deflates the measured 2.1 s stat-latency term. Repro: instrument
`SyncRpcDispatcher.pumpOnce` (per-method count + handler ms) and
`SyncRpcFsSync.callFs*` (child-blocked ms), run
`pnpm bench:child-fs --runs 1 --out /tmp/x.json --port 5411`, read phase dumps.

Distinct from `fs-rpc-chunk-perf` (>256 KiB O(N²) + base64 inflation) — same
file family, different term; binary write bodies (ADR-0366 envelope) compose.

## Options / Next

- Coalesce publication per file: the chunk protocol is already
  truncate-then-append keyed by path/offset; publish once on the final chunk
  (or per write burst) instead of per chunk. Owner stays SSoT; no child cache.
- Open fork to resolve at compile: visibility vs durability — ADR-0150 says
  every op observes latest owner state; coalescing must not delay visibility
  to concurrent readers, only the durable publication. Needs an explicit
  decision on what `publishThroughCurrent(true)` guarantees per chunk today.

## Reversibility

REVERSIBLE — owner-side handler/publication scheduling behind the existing
`fs.*` surface; the visibility fork is the only decision point.
