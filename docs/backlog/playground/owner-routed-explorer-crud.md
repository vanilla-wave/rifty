---
area: playground
status: ready
title: Owner-routed in-tree CRUD for the FileExplorer (create/rename/delete via owner RPC)
created: 2026-06-17
why: the explorer is a read-only viewer (owner = SSoT; the page's snapshotFs throws on write). Its disabled create/rename/delete machinery was removed (review #4) because it was wired to the throwing snapshot — a happy-path lie. A real file manager wants in-tree CRUD; this is the honest feature that routes those mutations to the owner store
user_story: As a dev I want to right-click a folder in the explorer to create/rename/delete files, with the mutation applied to the owner store (the single source of truth) and reflected back, not a page-local edit that diverges
epic: scm-file-manager
blocked_by: [playground/explorer-owner-rpc-fs-target, playground/explorer-owner-write-frames-rename-copy]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/explorer-owner-rpc-fs-target.md, docs/backlog/playground/explorer-owner-write-frames-rename-copy.md, ADR-0148, ADR-0150, ADR-0075]
code: [apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/fs-ops.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/glue/pty-protocol.ts]
---

## Context

> Under epic `scm-file-manager`. The page→owner RPC frames are split out to
> `explorer-owner-write-frames-rename-copy` (atomic rename/copy on the write
> mailbox) and the writable target to `explorer-owner-rpc-fs-target` (`OwnerRpcFs`).
> This item is just the explorer AFFORDANCES driving that target; build it AFTER
> its `blocked_by` items.

Re-derived at HEAD (review #4). `FileExplorer` is now a pure viewer over the read-only
`snapshotFs`. Today create/rename/delete reach the owner only via the editor (save →
`workspaceOwner.writeFile`) or the terminal (`touch`/`mkdir`/`mv`/`rm`); there is no in-tree
affordance. The pure mutation primitives still exist and are unit-tested
(`glue/fs-ops`: `createFile`/`createDir`/`deletePath`/`renamePath`/`copyTree`) — they operate
on an `FsOpsTarget`, so they can target an owner-RPC fs instead of the local snapshot.

## Options or Next

- Re-introduce the explorer's create/rename/delete affordances (header buttons + per-row
  actions + inline name input) driving `OwnerRpcFs` (`explorer-owner-rpc-fs-target`), NOT
  `snapshotFs`.
- Reuse `glue/fs-ops` primitives unchanged; surface owner-side errors back to the page.
- The mkdir/rename/rm/copy owner frames + handler live in the sibling items, not here.

## Acceptance

- E2E: right-click a folder → New File / New Folder creates it owner-side
  (reflected in `SnapshotFs` within one publish); F2 renames; Delete (with confirm)
  removes; EVERY mutation routes through `OwnerRpcFs` (no `SnapshotFs` write, no
  page-local store); owner-side errors surface back to the page.

## Parity cases

- New File creates an empty (0-byte) file — equal to `fs.writeFileSync(path, '')`
  over the owner VFS.
- New Folder creates an empty dir — equal to `fs.mkdirSync(path)`; a missing parent
  is a loud throw (not silent `mkdir -p`) unless the affordance is explicitly
  recursive.
- Delete of a non-empty directory removes it recursively (`rm -rf` content); delete
  of a missing path is a loud throw, never a silent success.
- Rename collision → loud throw (no clobber), via the atomic rename frame.

## Out of scope

- create/rename/delete wired to the throwing `SnapshotFs` → forbidden (the Review
  #4 lie).
- The owner frames + `OwnerRpcFs` themselves (sibling items).
- Clipboard copy/paste (`explorer-clipboard-copy-paste`); drag-move / OS-upload
  (`explorer-dnd-upload-compare`).

## Decisions

- Affordances only (header buttons + per-row actions + inline name input) driving
  `OwnerRpcFs`; reuse `glue/fs-ops` primitives unchanged.
- Delete confirms (destructive within the repo); owner errors surfaced to the page.
- Builds on ADR-0148/0150; REVERSIBLE, CHANGELOG line, no ADR.

## Reversibility

REVERSIBLE — additive page→owner mutation frames + UI; no change to the owner-SSoT invariant
(owner remains the single writer). Builds on ADR-0148/0150.
