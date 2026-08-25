---
area: perf
status: draft
title: P6a child fs.* RPC chunk perf — O(N²) read re-reads + base64 write inflation + node_modules stat storms
created: 2026-06-16
why: ADR-0150 v1 accepts these; large-file reads/writes over the per-chunk fs.* RPC are quadratic, writes carry base64 inflation, and a child require() walk is many sequential blocking round-trips; P6b's dev-server child amplifies (vite transforms + large bundles/wasm/sourcemaps + from-scratch install writes + big dep walks vs P6a's lighter CLIs)
user_story: As a dev running a CLI that reads/writes large files or resolves a big dependency tree in a child, I want the fs.* RPC to not be O(N²) / hundreds of round-trips — without losing owner-as-SSoT coherence.
sources: [ADR-0150, ADR-0084, ADR-0072]
code: [packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/runtime-js/src/ipc/fs-rpc-protocol.ts]
---

## Context

2026-08-26: item (3)'s hot-path half (small-read double hop + probe storm)
graduated to `epics/child-fs-rpc-hot-path` (`perf/fs-read-single-hop`, binary
request frame, batched-probe fog). THIS item keeps only >256 KiB O(N²)
read/write + base64 write inflation — out of that epic's scope.

ADR-0150 Consequences flag these as accepted-for-v1; concrete record here. (1) `fs-handlers.readChunk` re-reads the WHOLE file per chunk (`readFileBytesSync(path)` then `subarray`) → O(N²) for a file read in K chunks. (2) `writeChunk` append reads prev+concat+writes per chunk → O(N²) multi-chunk writes; plus base64 ~33% inflation on every write request (the request frame is JSON-only, ADR-0032). (3) A child `require()` resolves node_modules via many sequential `statSyncOrNull`/read round-trips — each a blocking SAB round-trip → slow CLI startup.

## P6b amplification + feasibility (recorded 2026-06-17)

P6b moves the dev server into a child reading/writing the owner store over THIS ring — far heavier than P6a CLIs. Decided accept-for-v1 (ADR-0150); recorded here as the deferred lever (contingency if first-e2e shows from-scratch install / large-file transform over RPC unviable — NOT "install on owner", which would violate the owner-non-blocking invariant ADR-0150 §14).

O(N²)→O(N) is real — the quadratic is handler naivety, not inherent to chunking (a chunked transfer is O(N) in bytes; the cost is the handler re-materializing the whole file per chunk). Concentrated risk: quadratic only bites files **> FS_RPC_CHUNK (256 KiB)**; typical vite small-module reads are single-chunk = already O(N). Cost lands on big files (wasm/vendor bundles/sourcemaps), not the bulk of reads.

## Options or Next

- **Route 2 — per-transfer buffer on the owner (no contract change):** ring is single-in-flight ⇒ a file's chunks arrive sequentially; read = open/read once into a buffer (key path+mtime), serve slices, evict on last-chunk/timeout (kills #1); write = accumulate chunks, one `writeFileSync` on the final chunk (kills #2). O(N) time, O(N) transient mem, localized to fs-handlers.
- **Route 1 — positional ops in `FsSync`:** add `readBytesAt`/`writeBytesAt`/append; OPFS `FileSystemSyncAccessHandle` does `read/write {at}` + `truncate` natively, in-memory via subarray. True O(N) streaming, O(1) extra mem — but a `vfs`-core contract change (own decision/ADR).
- **Binary REQUEST frame** to drop base64 on writes — the request-side half of `perf/syncrpc-v2-waitasync-binary-ring` (which added the binary REPLY frame); additive + version-gated (ADR-0032/0084).
- **Immutable node_modules direct-read** — let the child read node_modules straight from shared OPFS (P5) while the live project tree stays owner-RPC (coherent), or ship a resolver-cache image at spawn. Mind owner-SSoT + concurrent-writer coherence when bypassing RPC for reads.
- **Spawn amortization** is `perf/kernel-worker-prewarm-pool` (warm child + caches) — not restated here.

## Reversibility

REVERSIBLE — optimizations behind the existing fs.* surface (a binary request frame is additive + versioned).
