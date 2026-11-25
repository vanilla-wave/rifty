---
area: runtime-js
status: draft
title: fs.read and fs.readSync by fd transfer only the requested range on every host
created: 2026-11-25
why: In Workbench every fs.read/readSync(fd) call moves the whole file (fs.ts:944 readFileBytesSync): 16 MiB read in 64 KiB calls takes 18.5–26 s against Node's 3 ms; any positional reader (zip, tar, seek) is quadratic there
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/workbench.jsonl, docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/node.jsonl]
---

## Context

Unit 4b of goal node-streams-as-in-node (map), condition of ADR-0575 §3. Measured (Chromium 148, main
`692babe13`, Workbench ephemeral and OPFS, 64 KiB calls): `fs.read(fd)` loop 23 ms / 0.53–0.79 s /
20.5–25.7 s at 1/4/16 MiB, `readSync` the same, `readFileSync` 2 / 9–11 / 72–79 ms; Node 0–1 / 1 / 3 ms. Per
call ≈ a whole-file read (1.4 / 8.3 / 87 ms). The RPC layer already has a range read
(`ChunkedReadSource.readChunkReply`, `runtime-js/src/ipc/sync-rpc-fs.ts:63-91`); `fs.readSync` does not use it.

Mechanism: a positional read on `FsSync`/`Vfs` (path or open-file handle + offset + length). Each
implementation decides explicitly, never a silent whole-file fallback:
- memory: a slice of the stored bytes, no copy beyond the range; it is linear already
  (`memory-backend.ts:113`; `results/fd-hosts.txt`);
- OPFS (`OpfsFsSync`): a slice of its authoritative content cache, as memory. It must not read the
  disk directly: `readFileBytesSync` serves the cache by reference (`opfs-sync.ts:509`), and the disk
  lags until the write-through drains (`:569`);
- relay / owner (Workbench kernel ↔ owner): the chunk RPC. The owner side today re-reads the whole
  file per chunk (`readChunkReplyOf`, `sync-rpc-fs.ts:89-93`), so it must serve a range of its store
  through the same new positional read. This absorbs the read half of `perf/fs-rpc-chunk-perf` (its
  «Route 1»);
- sync mirror (`SyncMirrorVfs`, workbench glue): forwards to its source;
- isolate guest (`MemoryFsSync`): memory;
- any other implementation without a range: a loud `NotImplementedError` naming it.

Host table, measured: in-process and isolate read linearly already (`results/fd-hosts.txt`); the SDK
reads quadratically (review round 3, not in `results/`); Workbench is quadratic.
`results/chromium-fd/workbench.jsonl`: 16 MiB takes 18.5–26 s.

The `FsSync`/`Vfs` positional read is a `vfs` contract change, so this unit records an ADR (as
`perf/fs-rpc-chunk-perf` noted).

Acceptance: bytes transferred per call ≤ the requested length + constant, by an RPC/byte counter, not
milliseconds; doubling the file size costs ≤ ×2.2; a whole read by 64 KiB calls within a small factor of
`readFileSync`; on isolate, Workbench (memory and OPFS) and SDK. Timer ticks stay unit 4's row.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
