---
area: playground
status: parked
title: Owner-routed in-tree CRUD for the FileExplorer (create/rename/delete via owner RPC)
created: 2026-06-17
why: the explorer is a read-only viewer (owner = SSoT; the page's snapshotFs throws on write). Its disabled create/rename/delete machinery was removed (review #4) because it was wired to the throwing snapshot — a happy-path lie. A real file manager wants in-tree CRUD; this is the honest feature that routes those mutations to the owner store
user_story: As a dev I want to right-click a folder in the explorer to create/rename/delete files, with the mutation applied to the owner store (the single source of truth) and reflected back, not a page-local edit that diverges
sources: [ADR-0148, ADR-0150, ADR-0075]
code: [apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/fs-ops.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/glue/pty-protocol.ts]
---

## Context

Re-derived at HEAD (review #4). `FileExplorer` is now a pure viewer over the read-only
`snapshotFs`. Today create/rename/delete reach the owner only via the editor (save →
`workspaceOwner.writeFile`) or the terminal (`touch`/`mkdir`/`mv`/`rm`); there is no in-tree
affordance. The pure mutation primitives still exist and are unit-tested
(`glue/fs-ops`: `createFile`/`createDir`/`deletePath`/`renamePath`/`copyTree`) — they operate
on an `FsOpsTarget`, so they can target an owner-RPC fs instead of the local snapshot.

## Options or Next

- Add page→owner RPC frames for `mkdir`/`rename`/`rm` (mirror the existing `rifty:vfs-write`
  / `pty:*` channel) and an owner handler that applies them to its `syncMirror`.
- Re-introduce the explorer's create/rename/delete affordances (header buttons + per-row
  actions + inline name input) driving an `FsOpsTarget` backed by that RPC, NOT `snapshotFs`.
- Reuse `glue/fs-ops` primitives unchanged; surface owner-side errors back to the page.

## Reversibility

REVERSIBLE — additive page→owner mutation frames + UI; no change to the owner-SSoT invariant
(owner remains the single writer). Builds on ADR-0148/0150.
