---
area: playground
status: ready
title: Atomic rename/copy frames on the owner write mailbox (extend write|mkdir|rm)
created: 2026-06-27
why: In-tree rename + drag-drop move need an ATOMIC owner mutation; today rename = copyTree+rm across two non-atomic frames (a crash mid-move leaves a half-copy, no undo) and there is no copy frame at all.
user_story: As a dev moving/renaming a file in the tree, I want the owner to apply it atomically, but today VfsWriteFrame is write|mkdir|rm only and the page-side renamePath is copyTree-then-rm (two operations).
epic: scm-file-manager
blocked_by: []
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/explorer-owner-rpc-fs-target.md, docs/backlog/vfs/native-renamesync.md, ADR-0148, ADR-0165]
code: [apps/playground/src/glue/vfs-write-port.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/glue/fs-ops.ts]
---

## Context

`VfsWriteFrame` is `write|mkdir|rm` only (`vfs-write-port.ts:51`) and
`applyVfsWriteFrame` (`:72`) branches just those three. Page-side `renamePath` is
`copyTree`+`rmSync` (`fs-ops.ts`, `TODO(backlog: vfs/native-renamesync)`). Driving
a rename from the tree today would be two non-atomic frames — the half-move hazard.
`FsSync` has no native `renameSync` (`vfs/native-renamesync`, parked), but the
owner can do `copyTree`+`rm` inside ONE frame handler = atomic at the apply site.

## Scope

- **In:** add `rename` and `copy` variants to `VfsWriteFrame` +
  `applyVfsWriteFrame`; the rename handler does copyTree+rm in a single apply
  (atomic at the apply site). Owner-handle pass-through methods (or a generic
  `sendVfsWrite`) with the existing owner-exited guard.
- **Out:** the page-side writable target (`explorer-owner-rpc-fs-target`); UI/DnD
  (`explorer-dnd-upload-compare`); a lower-layer `FsSync.renameSync`
  (`vfs/native-renamesync` — only if a perf gate fires).

## Guardrails

- **Atomic at the apply site** — a crash/respawn between copy and rm must not be
  possible at the frame boundary (one handler, all-or-nothing).
- **No silent overwrite** — `fs-ops` already throws on collision; keep that, map
  overwrite to a loud throw (no clobber).
- Owner-exited guard on every new frame (mirror `writeFile` "owner has exited").

## Acceptance

- Unit: a `rename` frame is atomic at the owner (no observable half-state);
  collisions throw; the owner-exited path fails loudly. `pnpm check:arch` +
  `pnpm pr:check` pass.

## Parity cases

- A `rename` frame leaves NO observable half-state at the apply site (one handler,
  copyTree+rm all-or-nothing); a crash/respawn cannot interleave between copy and
  rm at the frame boundary.
- A `copy` frame of a directory reproduces every descendant with identical bytes
  (recursive `cp -r` content), never a shallow/empty dir.
- A frame sent after owner exit REJECTS loudly (mirror `writeFile`), never silently
  drops.

## Out of scope

- A lower-layer native `FsSync.renameSync` → NOT added (stays
  `vfs/native-renamesync`, only if a perf gate fires); rename is copyTree+rm at the
  apply site.
- Silent overwrite on collision → never; a collision is a loud throw. DELIBERATELY
  diverges from Node `fs.rename` overwrite semantics — this is the owner write
  mailbox + file-manager safety, NOT the `fs` API programs call (which is
  unaffected); compat-note, not a `NotImplementedError`.
- Cross-device / cross-realm move semantics → N/A (single owner VFS).

## Decisions

- Add `rename` + `copy` variants to `VfsWriteFrame` + `applyVfsWriteFrame`; the
  rename handler does copyTree+rm in ONE apply (atomic-at-apply-site).
- Collision → loud throw (no clobber), keeping the `fs-ops` collision throw.
- Additive over the existing mailbox, no lower-layer VFS API change → REVERSIBLE,
  CHANGELOG line, no ADR.

## Reversibility

REVERSIBLE — additive frame variants over the existing mailbox; no lower-layer
VFS API change (that stays in `vfs/native-renamesync`). CHANGELOG line.
