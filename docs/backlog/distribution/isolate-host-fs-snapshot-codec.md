---
area: distribution
status: ready
title: Guest FS snapshot codec v1 in the isolate and the consumer realm
created: 2026-11-22
why: the goal's one expected wall — no export/import of the guest FS exists
user_story: As a Node service, I want snapshotFs/restoreFs over a rifty MemoryFs in either realm, but today the guest FS dies with its isolate
epic: isolate-host-fs-snapshot
blocked_by: []
sources: [ADR-0567, ADR-0558, docs/backlog/distribution/reference/isolate-host-fs-snapshot-fit-probes.md]
code: [packages/isolate-guest/src/snapshot.ts, packages/isolate-guest/src/guest/entry.ts, packages/isolate-guest/src/contract.ts, packages/vfs/src/sync-mirror.ts, packages/vfs/src/memory-backend.ts, packages/vfs/src/stat-metadata.ts]
---

## Context

Format v1 per ADR-0567. Seam (the sandbox goal builds on it):

```ts
// @riftydev/isolate-guest (root; pure JS, no Web API / Node / vfs import)
snapshotFs(fs: SnapshotFs, options: SnapshotOptions): Uint8Array
restoreFs(fs: SnapshotFs, bytes: Uint8Array, options: SnapshotOptions): void
class FsSnapshotError extends Error { code: FsSnapshotErrorCode } // message `<code>: <fixed text>`
interface SnapshotOptions { template: { id: string; version: string } | null; maxBytes: number }
// SnapshotFs: readdirSync/statSync/readFileBytesSync/writeFileSync/mkdirSync/rmSync
//             + restoreStatSync(path, {mtimeMs, atimeMs, ctimeMs, birthtimeMs})
// rifty vfs MemoryFsSync implements SnapshotFs (restoreStatSync is new)
GuestEntry.snapshot(options): Uint8Array   // any time no guest code runs; after guest code: guest-authored
GuestEntry.restore(bytes, options): void   // only before run starts, else ERR_FS_SNAPSHOT_NOT_FRESH
```

The guest bundle installs its `MemoryFs` at load (was: in `run`), so
`restore` before `run` survives into it; observable `run` unchanged (one run
per isolate). Oracle for I1: the same rifty tree before snapshot, read through
guest `fs` (`node:fs` Stats from vfs `statSync`), not real Node — rifty's FS
semantics are the runtime's (P4); the snapshot keeps whatever rifty keeps.

## Challenge

challenge: 2026-11-22 — reuses the goal's premise check (goal `## Challenge`)

## Acceptance

1. Scenario steps 1–2 over the built bundle in real isolated-vm 7.0.2: guest listing (built and listed in the isolate's one run) after restore equals the listing before snapshot, every path, `size`/`nlink`/`mode`/four times/`readdirSync` order/bytes, odd names (`ODD_NAMES`); `ino` renewed. `snapshot-acceptance.test.ts` → I1
2. Isolate → Node realm: restored tree equals the guest listing and re-snapshots to the same bytes; Node → isolate: a Node-built tree is seen identically by guest code. `snapshot-acceptance.test.ts` step 3 → I1, I5
3. An honest snapshot crosses ivm as an exact-length `Uint8Array` (`byteOffset 0`, `buffer.byteLength === byteLength`). `snapshot-acceptance.test.ts` → I6
4. Format pin: a tiny tree (root, file, dir, lone-surrogate name, template) snapshots to exactly the bytes of the test's own ADR §1 writer with `node:zlib` CRC. `snapshot-codec.test.ts` → ADR-0567
5. Determinism: two snapshots of one tree are equal; trees equal by content/stat but built in another order give the same bytes; snapshot leaves the listing unchanged. `snapshot-codec.test.ts` → I5
6. Restore replaces the whole target (its own files gone), four times verbatim via vfs `restoreStatSync` (`restore-stat.test.ts`: `ino` untouched; codec test). → I1
7. 100 000 siblings snapshot and restore to the same bytes (no quadratic directory pass). → I3
8. Cost published: `packages/isolate-guest/scripts/measure-snapshot.mjs` reports bytes, snapshot/restore ms in both realms and the isolate memory floor for ~10 files/~1 MB and 23 654 files/~95 MB; the numbers (and the ivm copy cost) land in the isolate-guest README §Snapshot and meet the I6 budget (≤ 2 s per direction, ≤ 2 × S + 64 MiB at template scale, M3 Pro). → I6
9. Compat names what a snapshot does not keep (`ino` renewed; no links/modes/owners in rifty's FS) and the snapshot surface rows (`docs/public/compat/isolate-host.md` §Custom embedder). → I1

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| restore × length > `maxBytes` (garbage content) | `ERR_FS_SNAPSHOT_TOO_LARGE`, checked first, target unchanged | codec `restore: length over maxBytes…` | → I3, I4 |
| snapshot × tree over `maxBytes`; exactly `maxBytes` | refused / accepted | codec `snapshot: a blob of exactly…` | → I4 |
| snapshot in the isolate × 50 MiB tree, `maxBytes` 1 MiB, `memoryLimit` 96 | `_TOO_LARGE`, not an allocation failure (control: within the limit it does fail) | acceptance `snapshot over maxBytes…` | → I4 |
| restore in the isolate × 60 MiB blob, `maxBytes` 1 MiB, `memoryLimit` 96 | `_TOO_LARGE` before reading; guest then runs | acceptance `restore over maxBytes…` | → I4 |
| restore × every truncation of a valid blob | `ERR_FS_SNAPSHOT_CORRUPT`, target unchanged | codec `every truncation` | → I3 |
| restore × every single-bit flip | `ERR_FS_SNAPSHOT_CORRUPT` (version bytes: `_VERSION`) | codec `every flipped bit` | → I3, I2 |
| restore × wrong CRC, foreign magic, empty | `_CORRUPT` | codec | → I3 |
| restore × version 2 | `ERR_FS_SNAPSHOT_VERSION` naming found and supported | codec | → I2 |
| restore × other/none/unexpected template | `ERR_FS_SNAPSHOT_TEMPLATE`; matching template restores | codec, acceptance step 4 | → I2 |
| restore × CRC-valid structural defects: no/second/file root, duplicate path, dir+file at a path, relative, `..`/`.`/empty segment, trailing `/`, NUL, missing/file parent, child before parent, unknown kind (no symlinks), NaN/∞ time, fractional/negative size, size past end (2^50, not allocated), path/template length past end, bytes after `end` | `_CORRUPT`, target unchanged | codec `hostile bytes` table | → I3 |
| restore × siblings out of order, re-entry into a closed directory, a name over 16 383 code units | `_CORRUPT` | codec `hostile bytes` table | → I3 |
| restore × 200 entries whose paths exceed 16 383 units | no Map or Set key over 16 383 units during restore (V8 hashes longer keys by length: quadratic; the path-keyed reader hit 16 387) | codec `no Map or Set is keyed by a string V8 would hash by length` | → I3 |
| snapshot × a name of 16 383 / 16 384 code units | round-trips / `_UNREPRESENTABLE` | codec `a name of 16 383 code units…` | → I3 |
| restore in the isolate × memory runs out while writing (honest 40 MB blob, `memoryLimit` 64) | `ERR_FS_SNAPSHOT_INCOMPLETE`; then `run`, `snapshot`, `restore` refuse with it | acceptance `restore that runs out of memory while writing…` | → I4 |
| snapshot × NaN / ∞ / 1e306 / past-Date-range time, NUL or overlong name (both realms) | `ERR_FS_SNAPSHOT_UNREPRESENTABLE`; the Date-range edge, −0 and sub-ms times restore | codec `the writer never emits what the reader refuses`; acceptance `a tree the format cannot carry…` | → I1, I3 |
| restore × a time past the Date range | `_CORRUPT` | codec `hostile bytes` table | → I3 |
| restore × a `Buffer` blob, another realm's `Uint8Array`, a non-`Uint8Array` | owned exact copies; accepted; `TypeError` | codec `restore input` | → ADR-0567 |
| restore × the deepest chain, a chain + leaves, 16 383-unit names within a 16 MiB budget | restore time within 4 × the flat densest blob of the same budget, interleaved best of 5 (typical 0.6–1.3 ×, 0.3–0.9 × under load 111; chain was 14.5 ×) | codec `the budget bounds time as well as memory` | → I3 |
| snapshot in the isolate × the most two-byte 16 383-unit names a 64 MiB budget admits | fits `memoryLimit` 2 × 64 + 16 | acceptance `a snapshot dense in long two-byte names…` | → I4 |
| snapshot in the isolate × a 50 MiB tree, budget over the limit (`memoryLimit` 96) | `_TOO_LARGE: out of memory…`, twice (FS intact) | acceptance `a snapshot that runs out of isolate memory…` | → I4 |
| restore in the consumer realm × the FS throws on a write | `_INCOMPLETE` | codec `a restore failing while writing, in the consumer realm` | → ADR-0567 |
| snapshot × 200 random trees (fixed seed; 20–60 entries, depth, files and dirs, odd names), one in five with one unrepresentable state | the clean ones restore byte for byte (> 140), each refusal is `_UNREPRESENTABLE` naming the injected state, none other refused | codec `random trees` | → ADR-0567 |
| restore × a file size of −0 | `_CORRUPT` (would restore as +0, not byte-exact) | codec `hostile bytes` table | → I5 |
| the v1 writer × the golden tree | writes exactly the fixture bytes | codec `golden v1 blob` | → I2 |
| both × entries beyond the budget (bytes + 384 per entry + 8 per path unit + 80 per level) | `_TOO_LARGE` before writing; the densest blob within 32 MiB restores at `memoryLimit` 80 | codec `dense blobs…`; acceptance `the densest blob within maxBytes…` | → I3, I4 |
| restore × version 0 | `_CORRUPT` (never released) | codec | → ADR-0567 |
| restore × the golden v1 fixture (`tests/fixtures/snapshot-v1.bin`) | restores to its recorded tree, in every later reader | codec `golden v1 blob` | → I2 |
| any refusal × error text | `<code>: ` + printable ASCII, no blob text (`SECRET` marker in paths and in the blob's template absent) | codec `refused()` | → I3 |
| consumer realm × snapshot of a realm the guest altered (`DataView`/`Uint8Array`/`Array.prototype.sort`/`charCodeAt`/global `Uint8Array` replaced) | `restoreFs` refuses with `FsSnapshotError` (no `SECRET`) or yields a tree that snapshots again | acceptance `a snapshot from a realm the guest altered…` | → I3, I4 |
| restore in the isolate × refused blob | named error across ivm; guest then sees the fresh tree | acceptance step 4 | → I3 |
| GuestEntry.restore × during a run (timer pending) and after it (valid blob) | `ERR_FS_SNAPSHOT_NOT_FRESH` | acceptance `restore during or after…` | → I4 |
| GuestEntry.snapshot × after guest code ran | bytes (exact buffer) | acceptance steps 1, I4 case | → I4 |
| options × invalid `maxBytes`/template | `TypeError` both directions | codec `invalid options` | → ADR-0567 |
| consumer realm × restore into one `MemoryFs` × another `MemoryFs` of the realm | the other's tree unchanged; its next inode moves only by the entries restore created | codec `a restore changes nothing outside its target` | → I3 |

## Out of scope

- Sandbox API, rest-point enforcement, host → isolate range copy in the host's own code: sandbox goal.
- A snapshot taken after guest code is guest-authored: no test can make it truthful; the decoder only keeps it consistent (ADR-0567 Consequences).

## Decisions

- ready-verdict: 2026-11-22 — Contract+RED @ 2328d67ea
- 2026-11-22 — `it.fails` marks RED rows; IMPLEMENT flips them to `it`.
- 2026-11-22 — after Contract+RED: the outside-target RED's bound tightened from `≤ first + 9` to the exact `first + 8` (target() 4 incl. its root, restore 3, probe 1) — stricter, same row.
- 2026-11-22 — Final+GREEN round 1 (blocker, I3): the decoder's path-keyed Map was quadratic on equal-length paths over 16 383 units (V8 length-only hash) → parent/order checks on the walk's stack, names capped at 16 383 code units both ways (the vfs directory Map is keyed by names); REDs added; packed-export pin `embedder.test.ts` updated to the ADR-0558 2026-11-22 surface (PR-4).
- re-cut: 2026-11-22 — external review round 3 (manager): the random-trees carrier rebuilt (mostly representable, non-trivial trees; refusals checked against the injected state); −0 size refused; the snapshot OOM text and ADR §7 give 2 × maxBytes + 16 MiB — trace: none
- re-cut: 2026-11-22 — the hash-flooding row's carrier is a scaling ratio (2000 vs 1000 entries) instead of a same-size control (Final+GREEN verify: the control margin was the constant, not the ratio) — trace: none
- 2026-11-22 — external review round 1 (manager by delegation; narrowing I1/the Outcome is the user's — map `owner: user`): B1 incomplete restore → `ERR_FS_SNAPSHOT_INCOMPLETE` + the isolate refuses afterwards; S1 writer refuses what the reader refuses (`_UNREPRESENTABLE`; the overlong-name refusal at snapshot moved from `_TOO_LARGE`); S2 owned copies; S3 entry charge 384 (measured ~670 B, ~1.1 µs per entry); version 0 → `_CORRUPT`; golden v1 fixture; redundant `need(size)` removed, the other two checks got detail asserts. Two tests changed with the decisions (overlong-name code, the version-bit row).
- 2026-11-22 — external review round 2 (manager by delegation): budget gains 8 per path code unit and 80 per level of depth (both sides; a parent-index writer was tried and reverted — the path charge already caps paths' memory, REV-7); an allocation refused at snapshot is `_TOO_LARGE: out of memory`; tests changed with it: the budget arithmetic (`budgetOf`), the densest-dirs count (> 60 000), the long-names snapshot count (390).
- re-cut: 2026-11-22 — the hash-flooding row's carrier is a key-length probe on Map/Set during restore instead of a 1000-vs-2000 timing ratio (flaky under load: 3.04 vs bound 3); the time-bound row moved to a 16 MiB budget, interleaved best of 5 (4.23 under pr:check load at 4 MiB) — trace: none
- 2026-11-22 — I6 floor measured as a sandbox run goes (restore → `run` → snapshot): 223 MiB at template scale; snapshot straight after restore can need ~3 × S (garbage blob), stated in README/ADR.
