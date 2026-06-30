# ADR 0185: Owner-backed SCM and file-manager bridges

Status: Active
Date: 2026-06

> TL;DR: the playground page projects git state and file-manager mutations through
> owner-keyed bridges; the owner remains the only writer and the only realm that
> reads `.git` and full working-tree bytes.

## Context

The SCM/file-manager epic needs graphical git status, staged/worktree diffs,
stage/commit actions, Explorer CRUD/copy/move/upload/download, and dirty gutters.
The page snapshot is deliberately read-only, excludes `.git`, and may cap file
content. Reading git metadata or writing files from the page would violate
ADR-0148's single-store-owner model.

ADR-0179 records the shared status classifier. It does not record the cross-realm
owner/page mechanisms that make the UI honest.

## Decision

Add owner-keyed playground bridges for this surface:

- `rifty:git` request/reply RPC over `OwnerBridgeKey` for git reads and actions.
  The owner constructs `@riftydev/git`; the page never reads `.git`.
- Owner-pushed git status feed keyed by the snapshot port. It debounces existing
  owner mutation triggers, skips unchanged maps, and serves late subscribers.
- Full-byte owner file read bridge for single-file downloads and SCM working
  blobs. SCM Open Changes reads working bytes from the owner, not the capped
  snapshot fast path.
- Acked VFS write frames for Explorer mutations and editor/program save flushes.
  UI actions that depend on owner bytes await apply ACKs before git reads/actions.

Explorer and SCM components consume these bridges through page-local adapters
(`OwnerRpcFs`, git/status/read ports). `SnapshotFs` stays read-only.

## Consequences

- The graphical file-manager and SCM surfaces stay aligned with the terminal and
  dev server because all reads/actions converge on the owner store.
- Project switches/owner respawns re-key bridges by `OwnerBridgeKey`; stale-owner
  actions fail loudly instead of falling back to page-local state.
- The page gains durable bridge contracts but no new production dependency.
- File-manager rename/delete must coordinate open editor models with owner ACKs;
  stale old-path writes are forbidden.
