---
area: perf
subsystem: runtime-js
status: ready
title: Guest small-file readFileSync = 1 sync-RPC hop, not 2 (kill the sizing hop)
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: readFileBytesSync pays a statOrNull hop BEFORE the first readChunk hop — every small read costs 2×18 µs where 1 hop would do; vite resolution is almost entirely small files
user_story: As a dev whose vite build / require walk reads thousands of small files in the product child, I want each read to cost one ring round-trip, but today `sync-rpc-fs.ts` issues `statOrNull` then `readChunk` — a 0 B read ≈ 18 µs (1 hop), a 1 KiB read ≈ 36 µs (2 hops).
sources: [ADR-0150, ADR-0084, spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/FINDINGS.md §2b]
code: [packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/fs-rpc-protocol.ts, packages/kernel/src/ipc/sync-rpc.ts, tools/perf/src/child-fs-orchestrator.test.ts]
---

## User scenario

In the COI playground, run the canonical 2180-module `vite build` and Express
cold-start fixtures in a kernel-spawned child. Their resolver/package walks use
`SyncRpcFsSync.readFileBytesSync`; almost every source/package file fits within
`FS_RPC_CHUNK`. Today each non-empty small file sends `fs.statOrNull`, waits,
then sends `fs.readChunk`. The same source run in the in-realm comparison lane
does not pay those owner round-trips.

## Reference contract

Node v24.16.0 byte/error probe:

```sh
node -e "/* write/read 0, 1, 262144, 262145 B; read missing + directory */"
# v24.16.0 {"zero":0,"one":[165],"chunk":262144,"large":262145,"missing":"ENOENT","dir":"EISDIR"}
```

The executable local form is pinned in the RED's Node-parity case. Both Rifty
`FsSync` backends already share the stricter path/error suite:
`pnpm vitest run packages/vfs/src/fs-sync-strict-paths.test.ts` (2 backends,
green on 2026-08-26). The remote adapter must return the same bytes/codes as the
live owner, not a copied error table.

Pre-change real rig:

```sh
pnpm bench:child-fs -- --runs 1 --port 55671 --out perf/child-fs-baseline.json
# Chromium 148.0.7778.96, both lanes 2180 modules
# product: Vite 6.03 s; Express 277.2350000143051 ms
# in-realm: Vite 1.27 s; Express 198.94000001251698 ms
```

Exact raw artifact and commit identity are
`perf/child-fs-baseline.json` / ledger commit
`c7e19f249e6ae6131449048b6bee050f10372fb0`.

## Acceptance

1. `fs.readFileHead(path)` performs exactly one current owner
   `readFileBytesSync(path)` and returns ADR-0365's exact 8-byte total-size
   header plus `min(size, FS_RPC_CHUNK)` bytes. It carries no cache or second
   stat/read authority.
2. Exact child call traces: 0 B, 1 B, and exactly `FS_RPC_CHUNK` use one
   `fs.readFileHead` call and no `statOrNull`/`readChunk`; a
   `FS_RPC_CHUNK + 1` file uses one head plus one continuation beginning at
   `FS_RPC_CHUNK`. Every result is byte-exact.
3. Missing, directory, and traversal-through-file reads preserve the live
   owner `VfsError` code/path (`ENOENT`, `EISDIR`, `ENOTDIR`) in that first
   round-trip. Rewriting the owner between two reads is observed by the second
   read.
4. A malformed head is rejected before allocation/continuation. A large file
   that shrinks after the head, or a continuation larger than its requested
   remainder, still throws loudly rather than returning partial/stale-shaped
   bytes.
5. Kernel sync-RPC protocol version is 4; an old v3 peer fails through the
   existing `EPROTOVERSION` guard. The TypeScript language-service adapter
   keeps using the same `SyncRpcFsSync`, with the shared call trace exercised.
6. The unchanged public `bench:child-fs` rig records
   `perf/child-fs-after-single-hop.json` from the implementation commit. Its
   strict artifact/ledger test proves two real 2180-module lanes and exact
   Vite/Express raw samples; the ledger records both before and after values.

## Parity cases

- `small-read-one-hop`: the Node probe's 0/1/exact-chunk bytes are identical;
  the recorded RPC trace contains one head request only.
- `large-read-continuation`: `FS_RPC_CHUNK + 1` bytes equal Node/owner bytes;
  the second request begins at the first unread byte and no sizing request
  exists.
- `read-error-identity`: direct owner and remote reads of missing/directory/
  through-file paths expose the same `VfsError` name, code, and path.
- `owner-freshness`: two sequential remote reads around an owner overwrite
  observe old then new bytes without invalidation or cache state.
- `two-real-lanes-after`: the committed post-I1 artifact passes the same
  `validateChildFsArtifact` + exact pretty-byte oracle as the baseline and
  carries both canonical lanes at 2180 modules.

## Fault matrix

| Boundary / fault class | Injected fault | Required observable result |
|---|---|---|
| owner response / `corrupt-input` | non-bytes, <8-byte header, NaN/fractional/negative/unsafe size, short or extra head body | reject before allocation or continuation |
| continuation / `corrupt-input` | empty-before-size or larger-than-requested chunk after a valid head | loud short/oversized read; no partial bytes |
| owner mutation / `observable-order` | overwrite between two operations; shrink/grow after a large-read head | next operation sees latest bytes; in-flight inconsistent continuation rejects or stays within admitted size |
| shared adapter / `sibling-drift` | language-service small and multi-chunk reads | same `SyncRpcFsSync` trace/bytes; no second protocol implementation |
| protocol / `corrupt-input` | v3 frame presented to v4 peer | `EPROTOVERSION` before payload decode/dispatch |

## Out of scope

- Child-side content/stat caches, direct OPFS/shared-store reads, or any RPC
  bypass. These contradict the goal and ADR-0150 rather than becoming gaps.
- Binary request frames and compact stat/exists requests — next goal slice
  `perf/syncrpc-v2-waitasync-binary-ring`.
- Whole-file/chunk handles and the large-file O(N²) owner reread — remains
  `perf/fs-rpc-chunk-perf`.
- Guest install-write/base64 request cost, non-COI fallback, and a numeric
  speedup threshold.

## Decisions

- ADR-0365 selects one additive `fs.readFileHead` binary success shape:
  little-endian float64 safe-integer size + exact first chunk; owner errors use
  the existing JSON error reply.
- Bump the global sync-RPC version 3→4 and compile both peers atomically. Keep
  `statOrNull` and `readChunk` unchanged for other calls.
- The owner performs one real read per head request. No cache, lease,
  invalidation, alternate store authority, or correlation mechanism ships.
- The existing 256 KiB chunk is retained; changing capacity is not needed to
  deliver the contract.
- Expected RED band: 8–10 failing cases across five focused files: wire
  codec/call trace, owner error/fault behavior, exact v3→v4 rejection, shared
  adapter traces, and the absent post-I1 artifact. The two-peer wire plus the
  already-public benchmark proof require all five seams in this one atomic
  unit; no child can deliver a reviewable behavior independently.

## Reversibility

IRREVERSIBLE two-peer wire surface; ADR-0365 accepted at pickup.
