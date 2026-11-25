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

| host | 1 / 4 / 16 MiB, 64 KiB calls, ms | evidence |
|---|---|---|
| in-process (memory) | 0 / 0 / 1 — already linear (a view, no copy) | `docs/backlog/epics/node-streams-as-in-node/reference/results/fd-hosts.txt` |
| isolate (memory) | 0 / 0 / 1 — already linear | `docs/backlog/epics/node-streams-as-in-node/reference/results/fd-hosts.txt` |
| SDK (OPFS) | 3 / 32 / 473–497 | `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/sdk.jsonl` |
| Workbench (memory, OPFS) | 23 / 531–818 / 18 487–26 049 | `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/workbench.jsonl` |
| Node v24.16.0 | 0–1 / 1 / 3 | `docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/node.jsonl` |

`readFileSync` is linear on every host. On route B, a 16 MiB `for await` over `fs.createReadStream`
takes 21 s on Workbench, against Node's 11 ms (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-d/summary.txt`).

This unit absorbs the read half of `perf/fs-rpc-chunk-perf` (its «Route 1»). Its owner side is
`readChunkReplyOf` (`packages/runtime-js/src/ipc/sync-rpc-fs.ts:89-93`), which re-reads the whole
file for every chunk.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. One ADR, written in this unit, defines the positional read **and** positional write contract of `FsSync`/`Vfs`: offset, length, EOF and short reads. Each implementation follows it. The lower-layer interface changes once: 4c implements the write half from the same ADR. → I10
2. A positional read moves only its range: a byte/RPC counter shows bytes transferred per call ≤ the requested length plus a constant; doubling the file size costs ≤ ×2.2 by that counter; measured on in-process, isolate, Workbench (memory and OPFS) and SDK. → I10
3. A whole 16 MiB read in 64 KiB calls costs within ×3 of one `readFileSync` of the same file, by the same counter, on every host above. → I10
4. Each `FsSync`/`Vfs` implementation decides explicitly: memory: a slice of the store; OPFS (`OpfsFsSync`): a slice of its authoritative content cache, not a disk read, because the disk lags the cache until the write-through drains (`packages/vfs/src/opfs-sync.ts:509`, `:554`, `:572`); relay/owner: a range RPC, served by a positional read of the owner's store; sync mirror: forwards; an implementation without a range: a loud `NotImplementedError` naming it, never a silent whole-file fallback. → I10

## Parity cases

1. A new `tools/node-parity-runner/cases/fs/read-positional.case.ts`. Against Node, its bytes and return values for: `readSync`/`read` with explicit positions and with a `null` position; reads past EOF (a short read, or 0); a file truncated or extended between calls; `position` as `bigint`. → I10

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| owner RPC timeout × positional read | the call fails with the RPC error; no partial bytes are copied into the caller's buffer | fault test with an injected timeout on the range RPC | → I10 |
| owner RPC break mid-read × positional read | the same, and the next call works | fault test with an injected break | → I10 |
| owner death × positional read in flight | the call fails, never hangs; the fd ends closed or errored, as a dead owner leaves it today | fault test with an owner kill | → I10 |
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
