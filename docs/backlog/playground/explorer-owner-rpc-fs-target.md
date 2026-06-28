---
area: playground
status: draft
title: OwnerRpcFs — a page-side writable FsOpsTarget that routes mutations to the owner
created: 2026-06-27
why: In-tree CRUD needs a WRITABLE target, but binding fs-ops to the existing throwing SnapshotFs is the exact happy-path lie Review #4 deleted; the writable target must be DISTINCT and emit owner write frames (owner = single writer).
user_story: As the explorer CRUD layer, I want a writable FsOpsTarget whose create/rename/delete reach the owner and reflect back, but today the only FsOpsTarget is the read-only SnapshotFs (throws on write) and there is no owner-routed writable view.
epic: scm-file-manager
blocked_by: [playground/explorer-owner-write-frames-rename-copy]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/explorer-owner-write-frames-rename-copy.md, docs/backlog/playground/owner-routed-explorer-crud.md, ADR-0148, ADR-0150, ADR-0165]
code: [apps/playground/src/glue/fs-ops.ts, apps/playground/src/glue/snapshot-fs.ts, apps/playground/src/glue/vfs-write-port.ts, apps/playground/src/glue/realVite.ts]
---

## Context

`SnapshotFs` is the READ view: read-only, `writeFileSync`/`mkdirSync`/`rmSync` all
`readOnlyThrow` by design (`snapshot-fs.ts`). `glue/fs-ops` primitives
(`createFile`/`createDir`/`deletePath`/`renamePath`/`copyTree`) operate on any
`FsOpsTarget`. The owner reflect-back loop is already production (`onVfsWrite →
publishSnapshot → SnapshotFs.update → poll`) for editor saves.

## Scope

- **In:** a NEW `OwnerRpcFs implements FsOpsTarget` whose mutating methods emit
  `VfsWriteFrame`s (write/mkdir/rm + the new rename/copy) to
  `workspaceOwner().snapshotPort` and resolve on owner ack/republish. Bind
  `glue/fs-ops` to it. `SnapshotFs` UNCHANGED (still the read view, still throws).
- **Out:** the frame variants (`explorer-owner-write-frames-rename-copy`); the UI
  affordances (`owner-routed-explorer-crud`).

## Guardrails

- **`OwnerRpcFs` is DISTINCT from `SnapshotFs`** — never make the snapshot
  writable; never a page-local file store. The only writer remains the owner
  (ADR-0148/0150). This is the precise lie Review #4 removed — do not reintroduce.
- Reflect-back via the existing publish→update→poll loop (no optimistic page
  mutation that the owner hasn't acked).
- Rebinds on owner respawn (ADR-0165); an emit during the respawn window fails
  loudly (owner-exited guard).

## Acceptance

- E2E: a programmatic `OwnerRpcFs` create/rename/delete reflects in the read-only
  `SnapshotFs` view within one publish; NO page-local store is mutated (owner-SSoT
  intact); rebinds cleanly on owner respawn.

## Reversibility

REVERSIBLE — additive page-side target over the existing mailbox; SnapshotFs and
the owner write path unchanged. CHANGELOG line.
