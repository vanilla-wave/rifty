---
kind: epic
status: draft
title: Isolate guest FS snapshot — versioned blob, codec in isolate and consumer realm
created: 2026-11-22
value: A Node service can turn a rifty guest's files into opaque bytes and back into a fresh guest, so the next turn (or the next run) continues on the same files.
user_story: As a Node service running model code in rifty isolates, I want the guest's files as a byte blob I store and hand back, but today the guest FS dies with its isolate and rifty has no export/import for it.
tier: robust
---

## Outcome

rifty turns the guest's in-memory FS into one opaque, versioned,
template-bound byte string and back, with one pure-JS codec that runs inside
the bare isolate and in the consumer's own Node realm. Restored, the files look
to guest code exactly as before: same paths, bytes and `fs.stat` except `ino`. Bytes the
consumer hands back — once written by an isolate that ran hostile code — are
validated in one linear pass before anything is written; any defect is a named
error, never a partial tree. The live sandbox (goal of the sibling thread)
builds its state on this seam: a run = fresh isolate → restore → `node <path>`
→ snapshot (manager, 2026-11-22). Format decision: ADR-0567.

## User scenario

Requirements `2026-11-17-rifty-isolate-requirements.md` §Снимок ФС, manager
hand-off 2026-11-22; embedder on `GuestEntry` (ADR-0558), real isolated-vm,
no sandbox API (that lives in the sandbox goal).

1. In a fresh isolate, guest code writes a tree: text and binary files, an
   empty file, nested and empty directories, names with spaces, newline,
   non-ASCII and a lone surrogate, `utimesSync` times; it prints `fs.statSync`,
   `readdirSync` and file bytes for every path. The run ends (drain, exit); the
   embedder calls `snapshot({template, maxBytes})` and gets bytes.
2. The isolate is disposed. A new isolate is created; the embedder calls
   `restore(bytes, {template, maxBytes})` before guest code. Guest code prints
   the same listing: identical to step 1.
3. The consumer's realm restores the same bytes into a rifty `MemoryFs` and
   sees the same tree; a tree it builds there and snapshots restores in an
   isolate the same way.
4. Bytes that are truncated, carry a flipped byte or a wrong checksum, another
   format version or another template, a duplicate or non-canonical path, an
   entry under a file, an unknown entry kind, or exceed `maxBytes` are refused
   with a named error in either realm; the target FS is unchanged. A tree over
   `maxBytes` is refused at snapshot.

## Invariants

<!-- Evidence, main 50c9d8bf1: `GuestEntry` = {run, fire, rejection}
     (packages/isolate-guest/src/contract.ts:34-41); no snapshot/restore code in
     isolate-guest or isolate-host (`grep -rn snapshot packages/isolate-*/src`:
     none); guest FS dies with its isolate (ADR-0557 §4, fresh MemoryFs per run,
     entry.ts setUp). FIT probes: docs/backlog/distribution/reference/isolate-host-fs-snapshot-fit-probes.md. -->

1. I1. Round trip: after restore, guest code sees for every path the same
   kind, bytes, `readdirSync` order and `fs.statSync` (`size`, `nlink`,
   `mode`, `mtimeMs`, `atimeMs`, `ctimeMs`, `birthtimeMs`) as before snapshot,
   for any name rifty's FS holds; between the isolate and the consumer's realm
   in both directions. `ino` is renewed, as after a copy (ADR-0567 §1); what
   a snapshot does not keep (`ino`; links, modes, owners — absent from rifty's
   FS) is named in `docs/public/compat/isolate-host.md`.
2. I2. One opaque blob carries a format version and the template
   `{id, version}` or none; a reader refuses a version it does not know and a
   template other than the caller's, each with its named error; later rifty
   reads every format version released before it (ADR-0567).
3. I3. Hostile bytes: every defect in scenario step 4 is refused with a named
   error whose text carries no blob bytes; the target FS is exactly as before;
   decoding takes time and memory linear in the blob's length, with `maxBytes`
   checked before any allocation — in the isolate and in the consumer's realm;
   a restore changes nothing outside its target FS (no other `MemoryFs` of the
   consumer's realm, no realm-wide state a blob value could set).
4. I4. Limits: in an unaltered realm a snapshot over `maxBytes` is refused
   before its bytes are allocated, and restore refuses a blob over `maxBytes`
   before reading it; restore runs only before guest code in that isolate (not
   during a run either), else a named error; snapshot works after guest code
   has run (the run ended, isolate alive) — its result is then guest-authored
   bytes, bounded by the isolate memory limit and accepted only via restore
   (ADR-0567 §8).
5. I5. The same tree gives the same bytes; snapshot changes nothing in the tree.
6. I6. Cost, measured on landed code and published (isolate-guest README) for
   a small workspace (~10 files, ~1 MB) and the requirements' template scale
   (23 654 files, ~95 MB), both realms: bytes, snapshot and restore time, peak
   isolate memory. Budget on the dev machine (M3 Pro) at template scale: each
   direction ≤ 2 s (the requirements' one-pass unpack: 0.33–0.39 s vs 18 s
   with validation), peak isolate memory ≤ 2 × S + 64 MiB. Both run
   synchronously inside the embedder's call, so that call's deadline bounds
   them (the sandbox's deadline is the sandbox goal's). An honest snapshot
   crosses the ivm boundary as an exact-length buffer; the copy's cost is
   published with the rest.

## Challenge

challenge: 2026-11-22 — 2 problems (fresh critic), both resolved before ready:
1. A restored `ino` moved the realm-wide inode counter of every MemoryFs in the consumer's realm (`vfs/src/stat-metadata.ts:8`): a hostile blob could break other tenants' snapshots → `ino` is renewed on restore (ADR-0567 §1), I1 restated.
2. Snapshot-side promises (exact buffer, `maxBytes` before allocation) cannot hold after guest code replaced intrinsics → stated for an unaltered realm; after guest code the result is guest-authored, bounded by the isolate limit, accepted only via restore (I4, ADR-0567 §8); fault row added.
Advisory taken: tar's UTF-8 names cannot hold lone surrogates (ADR rejection); I6 now carries a budget; faster CRC at IMPLEMENT.

## Decisions

- tier: robust — the bytes are guest-authored and come back from storage: every reachable defect × {snapshot, restore} × {isolate, consumer realm} has a named outcome and a fault test; no crash-atomic storage promise (the consumer owns storage).
- 2026-11-22 — manager: one goal = one PR; this goal lands first and standalone; embedding in the sandbox API, the rest-point rule and the sandbox-level e2e belong to the sandbox goal's PR.
- 2026-11-22 — manager: the codec runs in two realms (isolate and the consumer's Node realm); the decoder trusts no property only an honest encoder guarantees.
- 2026-11-22 — agent: format = rifty binary v1 with CRC-32, ADR-0567.
- rejected route: JSON+base64 (`WorkspaceArchiveV1`) — violates I6 memory budget (831 MiB isolate heap after export at template scale vs 204; +33 % bytes; probes P1).
- rejected route: tar (ADR-0386) — violates I1: pax/ustar names are UTF-8, a lone-surrogate name cannot round-trip; also +41 % bytes for millisecond times.
- rejected route: keeping `ino` — violates I3 (a hostile `ino` moves the realm-wide counter of every FS in the consumer's realm).
- rejected route: SHA-256 checksum — violates I6 time budget (4.4 s vs 0.6 s per direction at template scale); integrity against the guest is impossible either way.
- rejected route: restore into a used isolate (merge or overwrite) — module cache, fds and cwd keep the old tree; violates I1.
