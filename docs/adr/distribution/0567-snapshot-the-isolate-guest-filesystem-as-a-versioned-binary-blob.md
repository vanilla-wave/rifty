# ADR 0567: Snapshot the isolate guest filesystem as a versioned binary blob

Status: Accepted
Date: 2026-11

> TL;DR: The guest's whole in-memory FS becomes one opaque byte string — rifty's own binary format v1 (records + CRC-32), template-bound, read forever by later rifty; a pure-JS codec reads and writes it in the isolate and in the consumer's realm; restore validates every byte, then replaces the FS of a fresh isolate before any guest code; a restore that fails while writing leaves an instance that is thrown away, never a partial tree passed off as whole.

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
   before any other read) → magic → version (0 is not a snapshot: `_CORRUPT`)
   → CRC → structure (truncated record,
   unknown kind, non-canonical path — relative, empty/`.`/`..`/overlong
   segment, trailing `/`, NUL, `/` itself —, a name not after its previous
   sibling (duplicate or out of order), parent not the open directory of the
   walk (absent, a file, closed), a time not finite or outside the Date
   range (±8.64e15 ms), size not a safe integer or past the end, the entry
   budget past `maxBytes` (§7), bytes after `end`) →
   template. Every refusal is `FsSnapshotError` with `code` and a fixed message
   carrying numbers only (offset, sizes, versions) — never blob text — so an
   error never brings guest bytes into host text. Work and memory are bounded
   by the blob's length: no allocation from a claimed size before it is checked
   against the bytes present, no recursion, no Map keyed by blob strings
   (parents and order are checked on the walk's stack of open directories).
6. **Restore** decodes fully, then replaces the whole target FS: a refused
   blob leaves it as it was. A failure after writing began (memory) is
   `ERR_FS_SNAPSHOT_INCOMPLETE`: the target is partial and the caller
   discards it; in the guest bundle the isolate then refuses `run`,
   `snapshot` and `restore` with that code — all of the tree, or an isolate
   thrown away, never a partial tree that runs (no second tree for an atomic
   swap: discarding needs none). File bytes are owned copies of the blob's
   range, whatever the input's class (a view would pin the whole blob per
   file); any realm's `Uint8Array` is accepted. Snapshot refuses what restore
   would refuse (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`: a name over the cap or
   with NUL, a time not finite or outside the Date range), so a writer never
   emits an unrestorable blob. In the guest bundle,
   `GuestEntry.restore` runs only before any guest code in that isolate, else
   `ERR_FS_SNAPSHOT_NOT_FRESH` (module cache, fds and cwd keep the old tree);
   `GuestEntry.snapshot` runs whenever no guest code runs — after the run
   ended included. Who enforces "no exec in flight" is the sandbox's.
7. **Limits.** `maxBytes` is a required argument of both directions (an
   invalid `maxBytes` or template is a `TypeError`: a caller bug, not a
   refusal); export
   sums the size first and refuses before allocating, and refuses what restore
   would (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`, §6); restore checks the
   blob's length before reading it. `maxBytes` is a budget: bytes + 384 per
   entry + 8 per code unit of each entry's path + 80 per level of its depth
   (every FS call resolves a path from `/`, segment by segment, and long
   names cost per unit to decode and hash), charged by both directions
   (restore during validation, before writing). So any blob within a budget M
   needs a memory limit under 2 × M + 16 MiB (≈ 2 × bytes + ~680 B × entries
   + 15 MiB) and ~2 ms per MiB of M, flat, deep, long-named or mixed — the
   trusted side's worst case is bounded by what it passed (64 MiB, measured
   in isolate-guest README: flat 122 665 entries 95 MiB / 116 ms, deepest
   chain 120 ms, long names 79 ms; before the entry charge a 16 MiB blob of
   empty dirs needed 512 MiB, before the depth and path charges a 64 MiB
   chain took 2.6 s and 65 MB of 16 383-unit paths 2.8 s). An allocation the
   limit refuses at snapshot is `ERR_FS_SNAPSHOT_TOO_LARGE`, the FS untouched;
   an isolate the limit kills outright is the embedder's memory termination. A
   snapshot right after a restore with no guest code between can need ~3 × the
   bytes: the restored blob is not yet collected (231–322 MiB at 98 MiB). A
   consumer sizes `memoryLimitMb` for 2 × `maxBytes` + 16 MiB — except for a
   snapshot straight after a restore with no guest code between, which can
   need ~3 × the bytes until the restored blob is collected.
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
- keeping `ino` in v1: one realm-wide inode counter (`stat-metadata.ts`) makes
  a restored `ino` everyone's in the consumer's realm; deferred by the user
  (2026-11-22, `backlog/distribution/isolate-host-fs-snapshot-keep-ino`);
- SHA-256 as the checksum: 4.4 s vs 0.6 s per direction with rifty's pure-JS
  hash (the isolate has no native digest); the CRC guards storage corruption,
  and no checksum can guard against the guest, who authored the bytes;
- file bytes as views into the blob on restore: pins the blob for the life of
  any file, and export needs 2 × S anyway;
- a streaming export to cut the 2 × S memory limit: machinery the contract does not
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
- Not the user's words: format, CRC-32, replace-on-fresh-only and exact
  template match are agent decisions; the `_UNREPRESENTABLE` refusals of NUL
  and out-of-range times are the manager's decision by delegation — guest
  `node:fs` and the sandbox's host ops no longer create either (PR #419); a
  consumer writing a `MemoryFsSync` directly still can, and snapshot refuses it
  by name. The user's words (the name cap, `ino`, «a partial tree is never
  passed off as whole»): `## Decisions` below.

## Decisions

The user's words on the goal's narrowings, relayed by the manager (exported from goal `isolate-host-fs-snapshot` at its close):

- 2026-11-22 — user: «ок» (to the manager's: «Скрипт создаёт файл, у которого одно имя (не путь) длиннее 16 383 символов. Снимок такое дерево не примет, и запуск не сохранит своё состояние, с именованной ошибкой. Настоящий Node такой файл не создаст вовсе: ОС ограничивает имя 255 байтами. Задеты только программы, которые в Node и так падают. Цель обещала „любое имя“») — I1's «any name rifty's FS holds» covers names of at most 16 383 code units (the user's words say «символов»; the cap counts UTF-16 code units, so a name of 8 192–16 383 non-BMP characters is refused too — the manager's reading, not the user's words); a longer name is refused at snapshot by name (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`, ADR-0567 §1), because longer names make decoding quadratic.
- 2026-11-22 — user: «давая в бэклог положим» (to the manager's: «Первый запуск читает `fs.statSync('a.txt').ino` и получает, скажем, 17. Во втором запуске у того же файла будет другое число; на настоящем диске оно сохранилось бы. Задеты программы, которые запоминают `ino` между запусками, чтобы узнавать файл, — например, свои кэши. Размер, времена и содержимое совпадают точно. Цель обещала „`stat` идентичен“») — I1's and scenario step 2's identical `fs.statSync` exclude `ino` here; keeping it is deferred to `backlog/distribution/isolate-host-fs-snapshot-keep-ino` (a per-realm inode counter makes a restored `ino` everyone's in the consumer realm).
- 2026-11-23 — user: «ок» (to the manager's recommendation: «Оставить как есть и принять формулировку „частичное дерево никогда не выдаётся за целое: после сбоя экземпляр выбрасывается“. Атомарность в кодеке записать в backlog с условием взятия: появился embedder, которому нужно восстановление поверх живой ФС»; asked after the user's «вот тут давай аккуратно разберемся. Во время реализации fs не очень приятно ходили по граблям пытаясь обеспечить точный статус файлов. Давай поймем что покупаем и какой ценой») — the Outcome's «never a partial tree» reads: a partial tree is never passed off as whole; a restore that fails while writing is `ERR_FS_SNAPSHOT_INCOMPLETE` and the instance is thrown away (ADR-0567 §6). Atomic restore deferred: `backlog/distribution/isolate-host-fs-snapshot-atomic-restore`.
