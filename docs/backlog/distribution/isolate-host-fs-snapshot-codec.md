---
area: distribution
status: draft
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
| restore × version 0 or 2 | `ERR_FS_SNAPSHOT_VERSION` naming found and supported | codec | → I2 |
| restore × other/none/unexpected template | `ERR_FS_SNAPSHOT_TEMPLATE`; matching template restores | codec, acceptance step 4 | → I2 |
| restore × CRC-valid structural defects: no/second/file root, duplicate path, dir+file at a path, relative, `..`/`.`/empty segment, trailing `/`, NUL, missing/file parent, child before parent, unknown kind (no symlinks), NaN/∞ time, fractional/negative size, size past end (2^50, not allocated), path/template length past end, bytes after `end` | `_CORRUPT`, target unchanged | codec `hostile bytes` table | → I3 |
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

- 2026-11-22 — `it.fails` marks RED rows; IMPLEMENT flips them to `it`.
