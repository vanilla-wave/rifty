---
area: playground
status: draft
title: Explorer drag-drop move, OS-upload import, Copy Path, Compare
created: 2026-06-27
why: Bulk gesture-driven file management (drag-to-move, drag-from-desktop upload) and compare are standard file-manager affordances absent today; they ride the owner write frames + the HEAD-blob provider.
user_story: As a dev, I want to drag files to move them, drop OS files to import, copy a path, and compare two files, but today the explorer is a read-only viewer and the only move/import is terminal mv / a save.
epic: scm-file-manager
blocked_by: [playground/explorer-owner-write-frames-rename-copy, playground/owner-routed-explorer-crud, playground/scm-diff-original-content]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/explorer-owner-write-frames-rename-copy.md, docs/backlog/playground/owner-routed-explorer-crud.md, docs/backlog/playground/scm-diff-original-content.md, ADR-0148, docs/public/compat/git.md]
code: [apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/fs-ops.ts, apps/playground/src/glue/vfs-write-port.ts, apps/playground/src/glue/vfs-snapshot-port.ts]
---

## Context

Builds on `OwnerRpcFs` + the atomic rename/copy frames. `importArchive`/`exportArchive`
already prove whole-tree page→owner mutation; `looksBinary` exists for binary
sniffing; the snapshot inlines content only <128KB (`SNAPSHOT_MAX_CONTENT_BYTES`).

## Scope

- **In:** DnD within-tree → atomic `rename`/`move` frame; OS drag-upload →
  per-file `write` frames with parent `mkdir`, chunked against the 128KB inline
  cap, binary via `looksBinary`; Copy Path / Copy Relative Path (page-side string
  + clipboard); Compare-Selected (two working blobs → Monaco DiffEditor) and
  Compare-with-HEAD (owner `show('HEAD:'+path)` blob, NOT structured-LCS diff text);
  multi-select batching into coalesced frames.
- **Out:** the frame variants, `OwnerRpcFs`, CRUD affordances, the HEAD-blob
  provider (their own items).

## Guardrails

- Move uses the ATOMIC rename frame (no copyTree+rm across two frames).
- Compare-with-HEAD is blob-vs-blob via Monaco only — never rifty's LCS hunk text
  presented as a patch (Fidelity).
- Upload honors the 128KB inline cap (chunk/route via owner) and `looksBinary`;
  no silent truncation.
- Owner-SSoT: all writes via `OwnerRpcFs` frames; SnapshotFs stays read-only.

## Acceptance

- E2E: DnD move is atomic (no half-state); OS-upload imports text + binary;
  Compare uses real blobs not LCS text; a large multi-select batches into
  coalesced frames; perf on a large upload acceptable.

## Reversibility

REVERSIBLE — additive UI + frame usage over shipped primitives. CHANGELOG line.
