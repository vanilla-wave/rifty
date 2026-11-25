# ADR 0576: FsSync positional read and write by range

Status: Accepted
Date: 2026-11

> TL;DR: `FsSync` gets one required positional read, `readFileRangeSync(path, position, length)`,
> and this ADR fixes the positional write `writeFileRangeSync(path, data, position)` that unit 4c
> adds; every implementation serves the range from its own authority or forwards it, never a
> whole-file read.

## Context

`fs.read`/`readSync(fd)` read the whole file per call (`readFileBytesSync`) and copied out the
slice. Over sync-RPC that moves the whole file per 64 KiB call: 16 MiB in 257 calls = 4 311 744 512
B out of `FsSync`, 18.5–26 s on Workbench against Node's 3 ms
(`docs/backlog/runtime-js/fs-fd-read-by-range.md`). The ADR-0365 correction made relays forward a
chunk (`ChunkedReadSource`), but the owner store still re-read the whole file per chunk
(`perf/fs-rpc-chunk-perf`). `fs.write(fd)` has the same shape on the write side (unit 4c). ADR-0575 §4
needs both before Node's fd streams run on every host.

Options: a per-transfer owner buffer (Route 2 of the perf item; interleaves on no-COI, where several
children issue sync XHR) or an optional duck-typed method (a wrapper without it falls back to the
quadratic path silently — trap `nested-relay-quadratic-read`). A required interface method makes
every implementation decide.

## Decision

1. **Read** — `FsSync.readFileRangeSync(path: string, position: number, length: number): Uint8Array`.
   - Path and errors as `readFileBytesSync`: `ENOENT`, `ENOTDIR`, `EISDIR`, `EIO`.
   - `position`, `length`: non-negative safe integers, else `TypeError`. fs.ts validates Node's
     argument shapes first: a bigint position past `MAX_SAFE_INTEGER` is past any EOF and goes as
     `MAX_SAFE_INTEGER`; after the position is validated, a zero length returns 0 without touching
     the fd or the store, as Node does.
   - Returns exactly bytes `[position, min(size, position + length))` of the current content. Short
     only at EOF; empty at or past EOF. No mid-file short read.
   - The result is read-only and valid until the next mutation of the store through any surface (a
     view of the store is allowed). A caller keeping it copies. A wrapper guarding its store against
     aliasing copies the range only.
   - One store call sees one state of the file (whole writes only). Over sync-RPC one exchange
     (≤ `FS_RPC_CHUNK`) is one store call; a longer range is one exchange per piece, each the file at
     its exchange: a write landing between them shows in the later pieces, as a read racing a writer
     may in Node. No error, no consistency check (`main` behaved the same; an `mtime` bracket was
     both a false `EIO` on an append outside the range and blind to a same-size rename-over).
   - Required. An implementation that cannot serve a range throws `NotImplementedError` naming
     itself; none does today.
2. **Write** (4c adds it, with this signature; no other `FsSync`/`Vfs` change) —
   `writeFileRangeSync(path: string, data: Uint8Array, position: number | null): number`, returning
   the offset after the written bytes.
   - The file must exist and be a file: `ENOENT`/`EISDIR`/`ENOTDIR`; it never creates. A wrapper's own
     refusals stay as for its `writeFileSync` (`EROFS`, install-claim guard, OPFS `EDQUOT`/`EIO`), and
     a wrapper records the mutation as for `writeFileSync`.
   - `position === null`: append at the store's current end in one store call (`O_APPEND`, no
     stat-then-write race across realms); the returned offset is the fd's next position. fs.ts passes
     `null` for an append fd whatever position the call names (Linux `O_APPEND`), and the fd's own
     position for a `null` position on a non-append fd.
   - Unlink while open: `ENOENT`, as for reads (declared ⚠️).
   - `position > size`: the gap is zero-filled (`pwrite`); size becomes
     `max(size, position + data.length)`; never truncates (truncate stays `writeFileSync`).
   - mtime/ctime as `writeFileSync` (strictly monotonic mtime). The store copies `data`.
   - Decided here: the interface and one call within one exchange (≤ `FS_RPC_CHUNK`) = one store
     call. Wire (a binary range write) and the OPFS write-through shape are 4c's.
   - **Open (unit 4c):** a write longer than one exchange, an append included. A Linux `write(2)` to a
     regular file is atomic against other writers; pieces over sync-RPC are not. Any owner-side
     staging meets five obstacles: no-COI children use sync XHR (no ring to key it by); a relay
     sends its grandchildren to the owner over one ring (two grandchildren's pieces would share a
     staging); the owner does not see caller death on the SAB ring (wedge, no timeout), so nothing
     can drop a half-staged write; staging needs a memory cap; it is a new ledger, so a mechanism
     sweep (`fault-classes.md` §Class-kill) comes first. The `writeFileRangeSync` signature does
     not depend on the answer.
   - A store that 4c mutates in place must keep a held range intact (`SyncMirrorVfs` streams one
     without a copy), or that holder copies.
   - Not added in 4b: no caller, and every implementation would carry a throwing stub.
3. **RPC** — the ADR-0366 `fs.readChunk` (binary offset + length ≤ `FS_RPC_CHUNK` + path) is the range
   RPC: the owner answers it with `getVfs().readFileRangeSync`. Wire and
   `SYNC_RPC_PROTOCOL_VERSION` unchanged. `ChunkedReadSource.readChunkReply` is removed: a relay
   (node-entry raw relay over `SyncRpcFsSync`, dev-server rooted `ProjectTerminalFsSync`) answers
   `fs.readChunk` by `readFileRangeSync` of the `FsSync` it serves, one upstream exchange per
   exchange. Head forwarding stays duck-typed as `ReadFileHeadSource` (`readFileHeadReply` only).
4. **`Vfs`** — no new method. Its positional read is `openReadable({ start, end })`; it is not on the
   fd path (`fs.read`/`readSync` use `FsSync` only). Writes by fd go through `FsSync` too.
5. **fs.ts** — `readSync` makes one `readFileRangeSync` call per call; `EISDIR` comes from the store,
   so the per-call `statSync` goes.

| implementation | read by range |
|---|---|
| `MemoryFsSync` | `subarray` of the store's bytes |
| `OpfsFsSync` | `subarray` of the authoritative content cache, not a disk read: the disk lags the cache until the write-through drains |
| `SyncRpcFsSync` | `fs.readChunk` per ≤ `FS_RPC_CHUNK` piece; a short piece is EOF; an oversized piece is loud |
| `ProjectTerminalFsSync` | guest → owner path, forwarded to its inner `FsSync` |
| `OwnerVfsAuthorityImpl` | inner range, `.slice()` of the range only |
| `createNoCoiProjectFs` | forwarded, `.slice()` of the range only |
| `InstallClaimFs` | forwarded, `.slice()` of the range only |
| `SnapshotFs` | not an `FsSync`, not on the fd path: whole-file preview reads, unchanged |
| `MemoryVfs` | `openReadable` windows a view of the store, unchanged |
| `OpfsVfs` | `openReadable` reads `File.slice` windows from disk, its `readFile` authority, unchanged |
| `ReplicaVfs` | `openReadable` windows its `readFile`: the digest covers the whole record, a range cannot be verified alone; unchanged, not on the fd path |
| `SyncMirrorVfs` | `openReadable` reads only its window, one snapshot at open (`main`'s semantics; live stream reads are unit 9r's), held as the layer below returns it — no copy of its own; window validated as `MemoryVfs`/`OpfsVfs` |

## Consequences

- A positional read moves its range only, on every host; `readFileSync(fd)` and `fs.read` follow.
- Faults keep each transport's model (`docs/process/rules/fault-classes.md`). SAB ring (COI): an
  oversize reply is the in-band error reply; responder death is a loud wedge until owner teardown,
  no timeout; a second caller fails at its claim. no-COI children's sync XHR keep their own model
  (35 s timeout, loud throw); the SDK's in-realm `node` has no transport. No partial bytes reach the
  caller's buffer: fs.ts copies after the whole range returned.
- `readFileBytesSync` over sync-RPC keeps only its size check across pieces (ADR-0365); not changed here.
- Unlink, rename-away or rename-over while open stays ⚠️: rifty has no open-file handle; the next
  read is `ENOENT` or sees the new file.
- A breaking change of the public `FsSync` interface: every implementation, in tests and outside
  rifty, gains the method.
- 4c adds `writeFileRangeSync` as above; base64 write inflation stays `perf/fs-rpc-chunk-perf`.
