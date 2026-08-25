---
area: perf
subsystem: runtime-js
status: draft
title: Guest small-file readFileSync = 1 sync-RPC hop, not 2 (kill the sizing hop)
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: readFileBytesSync pays a statOrNull hop BEFORE the first readChunk hop — every small read costs 2×18 µs where 1 hop would do; vite resolution is almost entirely small files
user_story: As a dev whose vite build / require walk reads thousands of small files in the product child, I want each read to cost one ring round-trip, but today `sync-rpc-fs.ts` issues `statOrNull` then `readChunk` — a 0 B read ≈ 18 µs (1 hop), a 1 KiB read ≈ 36 µs (2 hops).
sources: [ADR-0150, ADR-0084, spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/FINDINGS.md §2b]
code: [packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/fs-rpc-protocol.ts]
---

## Context

`sync-rpc-fs.ts:38` `readFileBytesSync`: hop 1 = `statOrNull` (existence +
size), hop 2..K = `readChunk` per `FS_RPC_CHUNK` (256 KiB). Proven by size
sweep (FINDINGS §2b): 0 B ≈ 18 µs, 1 KiB ≈ 36 µs; hop itself is not the
problem (8.2 µs Atomics + 3.1 µs JSON + ~7 µs unattributed). A reply carrying
(stat outcome + total size + first chunk) collapses the small-read case to one
hop; ENOENT rides the same single reply. Files > 1 chunk keep extra hops
(out of epic scope — `perf/fs-rpc-chunk-perf`). Owner remains SSoT; short-read
loud-throw semantics (store shrank mid-read) preserved — fault row.

Wire note: new/extended fs method = wire-format change → ADR; both peers
recompile atomically (`sync-rpc.ts` contract, ADR-0084 version mechanism).

## Options or Next

- Single `readFile`-style method: reply = binary frame `size + chunk0` or
  typed ENOENT/EISDIR; child loops `readChunk` only past chunk 0.
- Keep `statOrNull`/`readChunk` untouched for other callers.

## Reversibility

IRREVERSIBLE-class carrier (wire method + protocol version) → ADR at pickup.
