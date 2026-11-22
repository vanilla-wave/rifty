# ADR 0567: Snapshot the isolate guest filesystem as a versioned binary blob

Status: Accepted
Date: 2026-11

> TL;DR: The guest's whole in-memory FS becomes one opaque byte string — rifty's own binary format v1 (records + CRC-32), template-bound, read forever by later rifty; a pure-JS codec reads and writes it in the isolate and in the consumer's realm; restore replaces the FS of a fresh isolate before any guest code, all or nothing.

## Context

Goal `isolate-host-fs-snapshot`. A Node service runs guest code in a rifty
isolate (ADR-0557/0563); the sandbox dies after an agent run and the next turn
must see the same files. Requirements (`2026-11-17-rifty-isolate-requirements.md`
§Снимок ФС): files only, a blob the host stores without parsing, full snapshot,
integrity checks, a size limit, template id/version recorded; format left open
(tar per ADR-0386 vs `WorkspaceArchiveV1` JSON+base64). The blob outlives rifty
versions in the consumer's storage, so its format is irreversible. Its bytes
are written by an isolate that ran hostile code; the side that reads them may
be the consumer's own realm (manager, 2026-11-22).

Probes: `docs/backlog/distribution/reference/isolate-host-fs-snapshot-fit-probes.md`
(P1 formats, P2 memory, P3 bridge copies, P4 what the guest FS holds).

## Decision

1. **Format v1** (all integers little-endian):

   ```
   magic    8 B   "RIFTYFS" 0x00
   version  u32   1
   template u8    0 = none | 1 = u16 n, n UTF-16 code units (id), u16 m, m code units (version)
   entry*         u8 kind (1 dir, 2 file), u32 n + n UTF-16 code units (path),
                  f64 mtimeMs, f64 atimeMs, f64 ctimeMs, f64 birthtimeMs,
                  file: f64 size + size bytes
   end      u8    0
   crc      u32   CRC-32 (ISO-HDLC, zlib's `crc32`) of every byte before it
   ```

   Entries: `/` first, then every directory and file, pre-order, siblings in
   code-unit order — the reader requires that order. A name is at most
   16 383 code units: V8 hashes longer strings by length alone, so
   equal-length longer names make any Map of them quadratic (Final+GREEN
   probe: 76 MiB of such paths decoded in 22 s). Paths are canonical absolute JS strings stored as code
   units, so any name rifty's FS holds up to the cap below round-trips (lone surrogates included,
   P4). The snapshot is the sandbox's disk between runs, not a copy of it, so
   the four times come back verbatim — `ctime`/`birthtime` included, which a
   copy onto a real filesystem would renew (P4 oracle). `ino` is renewed, as
   after a copy: rifty draws inodes from one counter per realm, so a restored
   `ino` would move every other FS of the consumer's realm (a hostile blob
   could push it past what restore accepts). No symlink, hard link, mode or
   owner: rifty's FS has none (ADR-0050, P4); `mode`/`nlink`/`uid` follow from
   kind and tree.
2. **Deterministic.** The same tree (paths, kinds, bytes, times) gives the same
   bytes; export reads without touching atime. A consumer may compare blobs (or
   a hash it computes) to skip storing an unchanged one.
3. **Versions.** A reader reads every format version ever released up to its
   own; a higher version is refused (`ERR_FS_SNAPSHOT_VERSION`, found and
   supported numbers); the writer writes the newest. Format versions are
   independent of package versions. Dropping a version needs a superseding ADR.
4. **Template binding.** The header records the caller's `{id, version}` or
   none; restore requires exactly the same (both none, or equal strings), else
   `ERR_FS_SNAPSHOT_TEMPLATE`. v1 snapshots the whole FS: no template layer
   exists. The layer's own ADR defines how a snapshot leaves out its immutable
   paths (a new version if records change).
5. **Reading untrusted bytes.** One linear pass validates the whole blob before
   anything is written: size over `maxBytes` (`ERR_FS_SNAPSHOT_TOO_LARGE`, first,
   before any other read) → magic → version → CRC → structure (truncated record,
   unknown kind, non-canonical path — relative, empty/`.`/`..`/overlong
   segment, trailing `/`, NUL, `/` itself —, a name not after its previous
   sibling (duplicate or out of order), parent not the open directory of the
   walk (absent, a file, closed), non-finite
   time, size not a safe integer or past the end, bytes after `end`) →
   template. Every refusal is `FsSnapshotError` with `code` and a fixed message
   carrying numbers only (offset, sizes, versions) — never blob text — so an
   error never brings guest bytes into host text. Work and memory are bounded
   by the blob's length: no allocation from a claimed size before it is checked
   against the bytes present, no recursion, no Map keyed by blob strings
   (parents and order are checked on the walk's stack of open directories).
6. **Restore** decodes fully, then replaces the whole target FS: a refused
   blob leaves it as it was. File bytes are copied out
   of the blob (a view would pin the whole blob per file). In the guest bundle,
   `GuestEntry.restore` runs only before any guest code in that isolate, else
   `ERR_FS_SNAPSHOT_NOT_FRESH` (module cache, fds and cwd keep the old tree);
   `GuestEntry.snapshot` runs whenever no guest code runs — after the run
   ended included. Who enforces "no exec in flight" is the sandbox's.
7. **Limits.** `maxBytes` is a required argument of both directions (an
   invalid `maxBytes` or template is a `TypeError`: a caller bug, not a
   refusal); export
   sums the size first and refuses before allocating, and refuses a name over
   16 383 code units (`ERR_FS_SNAPSHOT_TOO_LARGE`); restore checks the
   blob's length before reading it. Peak memory ≈ 2 × S in either realm, for
   snapshot (tree + blob) and for restore (blob + copies) (P2 in the isolate:
   205 / 197 MiB for S = 90.7 MiB; FS alone 111). A snapshot right after a
   restore with no guest code between can need ~3 × S: the restored blob is
   not yet collected (231–322 MiB at S = 98 MiB). A consumer sizes
   `memoryLimitMb` for 2 × S.
8. **Where.** One pure-JS module in `@riftydev/isolate-guest` (root exports
   `snapshotFs(fs, options)`, `restoreFs(fs, bytes, options)`,
   `FsSnapshotError`; ADR-0558, unstable) over a structural FS interface that
   rifty's `MemoryFsSync` implements; it uses `Uint8Array`, `DataView`, `Map`,
   `Set` and `String.fromCharCode` only — no Web API, crypto, Node or vfs
   import — so the same code runs in the bare isolate (bundled into
   `guest.js`) and in the consumer's Node realm. `GuestEntry` gains `snapshot`
   and `restore` over the realm's FS, which is installed at bundle load.
   The decoder relies on nothing an honest encoder guarantees: a snapshot
   taken after guest code ran is produced in the guest's realm, whose
   intrinsics the guest may have replaced. There `snapshot`'s own promises —
   an exact-length buffer, the `maxBytes` refusal before allocating — hold
   only while the realm is unaltered (ADR-0557 §6: the boundary is outside
   the guest realm): the consumer takes the result as guest-authored bytes,
   bounded by the isolate's memory limit (ivm copies a view's whole backing
   store, P3), and accepts them only through `restoreFs`.

Rejected (P1, template scale, S ≈ 95 MB):
- JSON+base64 (`WorkspaceArchiveV1`): +33 % bytes, gzip 1.67× larger, 831 MiB
  heap after export against 204 MiB;
- tar (ADR-0386): pax/ustar names are UTF-8, so a lone-surrogate name rifty's
  FS keeps cannot round-trip; +18 % bytes, +41 % with the per-entry pax times
  millisecond mtimes need; its tooling buys nothing for a blob the host never
  opens; dups, links and devices it allows would each need a refusal;
- keeping `ino`: one realm-wide inode counter (`stat-metadata.ts`) makes a
  restored `ino` everyone's in the consumer's realm; a per-FS counter is a vfs
  refactor no consumer needs (Node over a copy renews `ino` too);
- SHA-256 as the checksum: 4.4 s vs 0.6 s per direction with rifty's pure-JS
  hash (the isolate has no native digest); the CRC guards storage corruption,
  and no checksum can guard against the guest, who authored the bytes;
- file bytes as views into the blob on restore: pins the blob for the life of
  any file, and export needs 2 × S anyway;
- a streaming export to cut the 2 × S peak: machinery the contract does not
  need yet (`REV-7`).

## Consequences

- Measured on landed code (isolate-guest README §Snapshot, M3 Pro): 23 654
  files / 100.6 MB — snapshot 138 ms and restore 173 ms in the isolate, 142 /
  161 ms in Node, ivm copy ≤ 10 ms, smallest `memoryLimit` for restore → run →
  snapshot 223 MiB; 10 files / 958 kB — ≤ 2.3 ms each way, 19 MiB. Not
  measured on Linux.
- The consumer stores ~S bytes per snapshot; gzip, if wanted, is the host's
  (template scale 95 → 18 MB).
- A snapshot from an isolate that ran guest code is guest-authored: CRC and
  structure checks keep it consistent, not truthful.
- Not the user's words: format, CRC-32, renewed `ino`, replace-on-fresh-only
  and exact template match are agent decisions; the 16 383-unit name cap and
  I1's narrowing to it are the manager's decision by delegation (goal `isolate-host-fs-snapshot` Decisions).
