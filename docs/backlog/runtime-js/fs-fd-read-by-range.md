---
area: runtime-js
status: ready
title: fs.read and fs.readSync by fd transfer only the requested range on every host
created: 2026-11-25
why: In Workbench every fs.read/readSync(fd) call moves the whole file (fs.ts:944 readFileBytesSync): 16 MiB read in 64 KiB calls takes 18.5–26 s against Node's 3 ms; any positional reader (zip, tar, seek) is quadratic there
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/workbench.jsonl, docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/node.jsonl]
---

## Context

Unit 4b of goal `node-streams-as-in-node` (map). It is the condition of ADR-0575 §3 (fd reads on every
host). Today every `fs.read`/`readSync(fd)` call reads the whole file
(`packages/runtime-js/src/builtins/fs.ts:944` `readFileBytesSync`) and copies out the slice.

Measured per host:

Medians of 3 runs per mode (`readSync`, `fs.read`) and persistence; a range spans those medians, and
the extremes of single runs follow in brackets.

| host | 1 / 4 / 16 MiB, 64 KiB calls, ms (median) | evidence |
|---|---|---|
| in-process (memory) | 0 / 0 / 1 — already linear (a view, no copy) | `docs/backlog/epics/node-streams-as-in-node/reference/results/fd-hosts.txt` |
| isolate (memory) | 0 / 0 / 1 — already linear | `docs/backlog/epics/node-streams-as-in-node/reference/results/fd-hosts.txt` |
| SDK (OPFS) | 3 / 32 / 473–497 (runs 2–565) | `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/sdk.jsonl` |
| Workbench (memory, OPFS) | 23–24 / 526–795 / 18 988–23 413 (runs 4 MiB 520–818, 16 MiB 18 487–26 049) | `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/workbench.jsonl` |
| Node v24.16.0 | 0 / 0–1 / 1–3 | `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/node.jsonl` |

`readFileSync` is linear on every host. On route B, a 16 MiB `for await` over `fs.createReadStream`
takes 21 s on Workbench, against Node's 11 ms (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-d/summary.txt`).

This unit absorbs the read half of `perf/fs-rpc-chunk-perf` (its «Route 1»). Its owner side is
`readChunkReplyOf` (`packages/runtime-js/src/ipc/sync-rpc-fs.ts:89-93`), which re-reads the whole
file for every chunk.

Bytes today: every 64 KiB call moves the whole file across `FsSync`, so a 16 MiB file read in 257 calls
moves 257 × 16 777 216 = 4 311 744 512 B out of `FsSync` (and, on Workbench, through the RPC reply).
In-process memory is fast only because it returns a view; it moves the same bytes by this count.

Implementations of the interface, found by the method, not by `implements`: every definition of
`readFileBytesSync` with a body in `packages/*/src` (`grep -rnE "readFileBytesSync(\([a-zA-Z_]+[:,)]| *:)"
packages/*/src --include='*.ts'`, tests and fixtures excluded; arrow properties included), plus the
`Vfs` classes (`implements Vfs`). Each copies or reads the whole file on a read today.
- `FsSync`, on the guest read path:
  - `MemoryFsSync` (`packages/vfs/src/sync-mirror.ts:43`);
  - `OpfsFsSync` (`packages/vfs/src/opfs-sync.ts:509`);
  - `SyncRpcFsSync` (`packages/runtime-js/src/ipc/sync-rpc-fs.ts:159`, the guest side of the owner RPC);
  - `ProjectTerminalFsSync` (`packages/workbench/src/workers/project-terminal-namespace.ts:183`, the
    Workbench relay);
  - `OwnerVfsAuthorityImpl` (`packages/workbench/src/workers/owner-vfs-authority.ts:201`;
    `OwnerVfsAuthority extends FsSync` at `:56`), the Workbench owner's store, which returns
    `readFileBytesSync(path).slice()` (`:202`);
  - `createNoCoiProjectFs` (`packages/workbench/src/workers/no-coi-project-fs.ts:70`, the SDK path,
    `.slice()` of the inner read);
  - `InstallClaimFs` (`packages/workbench/src/workers/install-claim-fs.ts:47`, `.slice()` of the raw
    read).
- Off the fd path: `SnapshotFs` (`packages/workbench/src/workbench/internal/snapshot-fs.ts:198`, the
  page's read-only preview of the worker tree, `content.slice()`).
- `Vfs`: `MemoryVfs` (`packages/vfs/src/memory.ts:21`), `OpfsVfs` (`packages/vfs/src/opfs.ts:44`),
  `ReplicaVfs` (`packages/vfs/src/opfs-replica.ts:11`), `SyncMirrorVfs`
  (`packages/workbench/src/glue/sync-mirror-vfs.ts:16`).

The other matches are narrow structural interfaces without a body (`isolate-host/src/sandbox.ts:16`,
`isolate-guest/src/snapshot.ts:70`, `terminal/src/state.ts:17`, `terminal/src/history.ts:19`,
`vfs/src/fs-sync.ts:20`, and four in `workbench/src/glue/`).

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. One ADR, written in this unit, defines the positional read **and** positional write contract of `FsSync`/`Vfs`: offset, length, EOF and short reads. Each implementation follows it. The lower-layer interface changes once: 4c implements the write half from the same ADR. → I10
2. A positional read moves only its range. The counter is bytes leaving `FsSync` per call (the `Uint8Array` length an implementation returns) and, on Workbench, bytes in the RPC reply; not the number of copies. Per call ≤ the requested length plus a constant; doubling the file size changes the per-call count by ≤ ×1.1. Measured on in-process, isolate, Workbench (memory and OPFS) and SDK. Today: 4 311 744 512 B for a 16 MiB file in 257 calls. → I10
3. A whole 16 MiB read in 64 KiB calls moves ≤ ×1.1 of the file's size by the same counter, and takes within ×3 of one `readFileSync` of the same file in time, on every host above. → I10
4. The ADR has one row per implementation listed in Context, each with its decision: `MemoryFsSync`/`MemoryVfs` a slice of the store; `OpfsFsSync` a slice of its authoritative content cache, not a disk read, because the disk lags the cache until the write-through drains (`packages/vfs/src/opfs-sync.ts:509`, `:554`, `:572`); `SyncRpcFsSync` a range RPC, served by a positional read of the owner's store; `ProjectTerminalFsSync` maps the path and forwards the range to its inner `FsSync`; `OwnerVfsAuthorityImpl` reads the range from its store, without the whole-file `.slice()`; `createNoCoiProjectFs` and `InstallClaimFs` forward the range and copy only it; `SnapshotFs` keeps whole-file preview reads and is not on the fd path (stated, not changed); `OpfsVfs`, `ReplicaVfs` and `SyncMirrorVfs` read the range from the same authority their `readFile` reads today, or forward. An implementation without a range throws a loud `NotImplementedError` naming it, never a silent whole-file fallback. → I10

## Parity cases

1. A new `tools/node-parity-runner/cases/fs/read-positional.case.ts`. Against Node, its bytes and return values for: `readSync`/`read` with explicit positions and with a `null` position; reads past EOF (a short read, or 0); a file truncated or extended between calls; `position` as `bigint`. The existing `tools/node-parity-runner/cases/fs/fd-read-write-position.case.ts` already covers positions (including `bigint`); the new case adds only what it lacks, and both stay green. → I10

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| SAB sync-RPC oversize reply × range read | the ring's in-band error reply reaches the caller as an error; no partial bytes are copied into its buffer | fault test with a range over the ring's reply size | → I10 |
| SAB sync-RPC responder death mid-exchange × range read | as the ring's model gives it (`docs/process/rules/fault-classes.md`, SAB sync-RPC row): a loud permanent wedge, the caller blocked until owner teardown; production has no timeout (`packages/kernel/src/ipc/sync-client.ts:21`). This unit must not change it; no partial bytes reach the buffer | fault test killing the responder in `HANDLING`, asserting the wedge diagnostic | → I10 |
| second caller × one ring | the second claim fails loudly, as today; a range read takes one exchange | fault test with two callers on one ring | → I10 |
| concurrent write (second fd, second tab) × positional read | a range read sees whole writes only, as through the cache today; never a torn range | fault test with an interleaved writer | → I10 |
| file truncated or unlinked between calls × positional read | truncate gives a short or 0 read, as in Node; unlink while open is a declared ⚠️ (`fs-read-stream-reads-snapshot-not-open-file`: rifty has no open-file handle) | parity case rows + compat row | → I10 |

## Out of scope

- Positional writes: unit 4c, from the same ADR.
- Base64 write inflation over the RPC: stays in `perf/fs-rpc-chunk-perf`.
- An open-file (inode) handle that survives unlink: declared ⚠️.

## Decisions

- One ADR covers both the read and the write positional ops, so 4c changes no interface.
- OPFS reads come from the authoritative cache.
- An implementation without a range throws loudly.
