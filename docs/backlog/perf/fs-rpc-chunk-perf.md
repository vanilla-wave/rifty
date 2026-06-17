---
area: perf
status: active
title: P6a child fs.* RPC chunk perf — O(N²) read re-reads + base64 write inflation + node_modules stat storms
created: 2026-06-16
why: ADR-0150 v1 accepts these; large-file reads/writes over the per-chunk fs.* RPC are quadratic, writes carry base64 inflation, and a child require() walk is many sequential blocking round-trips
user_story: As a dev running a CLI that reads/writes large files or resolves a big dependency tree in a child, I want the fs.* RPC to not be O(N²) / hundreds of round-trips — without losing owner-as-SSoT coherence.
sources: [ADR-0150, ADR-0084, ADR-0072]
code: [packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/runtime-js/src/ipc/fs-rpc-protocol.ts]
---

## Context

ADR-0150 Consequences flag these as accepted-for-v1; concrete record here. (1) `fs-handlers.readChunk` re-reads the WHOLE file per chunk (`readFileBytesSync(path)` then `subarray`) → O(N²) for a file read in K chunks. (2) `writeChunk` append reads prev+concat+writes per chunk → O(N²) multi-chunk writes; plus base64 ~33% inflation on every write request (the request frame is JSON-only, ADR-0032). (3) A child `require()` resolves node_modules via many sequential `statSyncOrNull`/read round-trips — each a blocking SAB round-trip → slow CLI startup.

## Options or Next

- **Ranged read on the owner** — slice the cached buffer ref by offset without re-reading the whole file per chunk (kills #1).
- **Binary REQUEST frame** to drop base64 on writes — the request-side half of `perf/syncrpc-v2-waitasync-binary-ring` (which added the binary REPLY frame); additive + version-gated (ADR-0032/0084).
- **Immutable node_modules direct-read** — let the child read node_modules straight from shared OPFS (P5) while the live project tree stays owner-RPC (coherent), or ship a resolver-cache image at spawn. Mind owner-SSoT + concurrent-writer coherence when bypassing RPC for reads.
- **Spawn amortization** is `perf/kernel-worker-prewarm-pool` (warm child + caches) — not restated here.

## Reversibility

REVERSIBLE — optimizations behind the existing fs.* surface (a binary request frame is additive + versioned).
