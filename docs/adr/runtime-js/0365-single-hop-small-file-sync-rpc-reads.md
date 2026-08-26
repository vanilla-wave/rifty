# ADR 0365: Single-hop small-file sync-RPC reads

Status: Accepted
Date: 2026-08

> TL;DR: `fs.readFileHead` returns one binary `total size + first chunk`
> snapshot, so a file at most 256 KiB costs one owner round-trip while larger
> reads retain the existing loud continuation semantics.

## Context

ADR-0150 makes the owner VFS the single source of truth for supervised child
processes. Its child adapter currently calls `fs.statOrNull`, then
`fs.readChunk` from offset zero. A one-byte file therefore pays two synchronous
SAB round-trips even though the owner already has both its length and bytes.
The committed child-fs baseline records the real consequence in Chromium:
the same 2180-module Vite graph takes 6.03 s in the product child versus 1.27 s
in one in-realm Worker at commit
`c7e19f249e6ae6131449048b6bee050f10372fb0`.

Three carriers were considered:

- A child content/stat cache or shared-store bypass removes later RPCs too,
  but violates ADR-0150 freshness and the goal's explicit no-cache boundary.
- A single full-file binary reply is smallest for small files, but cannot
  represent a file beyond the fixed 1 MiB ring without a second escalation
  mechanism; lowering/changing that ceiling belongs to the existing
  `perf/fs-rpc-chunk-perf` work.
- A first-chunk reply carrying its total size composes with the existing
  `fs.readChunk` continuation. It removes exactly the redundant sizing hop and
  adds no state owner.

## Decision

Add `fs.readFileHead(path)`. The owner performs exactly one current
`FsSync.readFileBytesSync(path)` and returns a binary value:

```
offset  size  encoding
0       8     total byte length, IEEE-754 float64 little-endian
8       N     bytes [0, min(total length, FS_RPC_CHUNK))
```

The total length must be a non-negative safe integer and the body length must
equal `min(total length, FS_RPC_CHUNK)`. The child validates the complete shape
before allocating or issuing a continuation. An owner `ENOENT`, `EISDIR`, or
`ENOTDIR` remains the ordinary JSON error reply; the binary success body has no
duplicate status field.

`SyncRpcFsSync.readFileBytesSync` calls only `fs.readFileHead` for files at
most `FS_RPC_CHUNK`. A larger snapshot copies the head then calls the existing
`fs.readChunk` from the first unread offset until the declared size. Empty,
short, or oversized continuations remain loud. `statOrNull` and `readChunk`
stay unchanged for their other callers.

This additive application method is still a two-peer wire contract. Bump
`SYNC_RPC_PROTOCOL_VERSION` 3→4 and recompile kernel + runtime-js together, so
a partially deployed peer rejects before dispatch instead of discovering an
unknown method after admission.

## Consequences

- Every 0 B through 256 KiB owner-backed read uses one sync-RPC round-trip;
  every larger read saves the former sizing round-trip.
- The owner is still consulted on every operation. No child cache, invalidation
  protocol, or alternate storage authority exists.
- Direct owner errors now preserve `EISDIR`/`ENOTDIR` instead of the former
  `statOrNull` projection collapsing every non-file to `ENOENT`.
- Large reads retain the existing repeated whole-file owner reads and O(N²)
  behavior. That separate problem remains `perf/fs-rpc-chunk-perf`.
- Binary request frames remain the next goal slice; v4 changes only this fs
  success payload and the shared version stamp.
