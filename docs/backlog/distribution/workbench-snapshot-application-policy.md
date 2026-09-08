---
area: distribution
status: ready
title: Apply snapshots through explicit saved-state and file-conflict policies
created: 2026-09-07
why: Changing snapshotId currently reseeds an edited Scratch, while hosts need saved state by default and an explicit uniform file-conflict policy for application.
user_story: As the plugin-sandbox embedder, I want saved projects to win after initial deployment and choose overwrite or error when explicitly applying a snapshot, but current catalog identity changes can silently replace edited files.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/distribution/reference/workbench-snapshot-application-policy-evidence.md, ADR-0396, ADR-0279, ADR-0261]
code: [packages/workbench/src/workbench/internal/playground-project-definition.ts, packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/glue/dep-snapshot.ts]
---

## Context

Catalog identity includes snapshotId. `createScratch` reseeds an edited
Scratch when that id changes; named `openProject` throws mismatch. User
selected default initial-deployment-only and explicit apply with generic
overwrite/error. ADR-0396 names the operation-level `snapshotApplication`
carrier. Evidence: `reference/workbench-snapshot-application-policy-evidence.md`.

## User scenario

The embedder opens a snapshot-backed Scratch, edits `user.txt`, and later
reopens with a newly baked snapshotId. Default/`initial-deployment-only`
keeps the edit and does not fetch the unused asset. An explicit apply with
`conflict: 'error'` reports structural conflicts and writes nothing; with
`overwrite` it replaces conflicting payload files, adds missing ones, and
keeps extras. `package.json` / lock / `node_modules` are ordinary paths.

## Acceptance

1. Default and `{ mode: 'initial-deployment-only' }` keep an existing Scratch
   or named project's saved files when only unused snapshot provenance
   (snapshotId / unused templateId) changes, including dirty Scratch without
   `preserveDirtySameStarter`; the unused asset is not fetched; catalog
   adoption stays on the last applied snapshot. `workbench-snapshot-application.contract.test.ts`
   initial-only Scratch, named-open, and no-fetch cases. → I8
2. `{ mode: 'apply', conflict?: 'error' | 'overwrite' }` evaluates snapshot
   payload on every requested apply, including unchanged snapshotId.
   Identical bytes and directory/directory coexistence are not conflicts;
   different bytes or file-vs-directory/ancestor clashes are. Error (default)
   throws `SnapshotApplicationConflictError` with `paths` before any payload
   mutation, including additions. Overwrite replaces conflicts, adds missing
   payload files, and keeps extras. Package filenames are ordinary collision
   fixtures. Same file. → I8
3. After a successful apply, catalog adoption matches the applied snapshot
   and install claims are retired/rederived through the existing stamp
   authority; apply does not run an automatic install to manufacture trust.
   Missing install trust never counts as "project absent". Same file plus
   claim case. → I8 → ADR-0396

## Fault matrix

- Structural conflict × apply-error: conflicting paths are reported and the
  pre-apply tree is byte-identical, including extras and would-be additions.
  `workbench-snapshot-application.contract.test.ts` error-before-write case. → I8
- Crash/reopen × apply-overwrite: a torn payload write is not published as
  completed; the preserved copy remains. `workbench-snapshot-application.fault.test.ts`. → I8
- Corrupt/incompatible snapshot × apply: existing snapshot identity/restore
  failures reject before destination mutation. Existing first-materialization
  identity/restore-plan cases. → ADR-0396

## Out of scope

Snapshot-only admission, storage namespace, orphan recovery, preview prefix,
and operation budgets remain named siblings. `reset` stays an explicit
whole-tree replace. Install-kind `createScratch` reseed/`preserveDirtySameStarter`
behavior is unchanged. Builder-owned registry auth stays excluded.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ ebffc3a6f88bab8ae7a32fa76114c0c852d55e37
- 2026-09-08 — Final+GREEN PASS @ 89c106c1c079ad6f66df5ffbdd188409d6a065ef; critic STRETCH on package-json-mismatch as an apply pre-mutation gate.
- 2026-09-08 — ADR-0396: operation-level `snapshotApplication`; last-applied
  catalog identity; existing catalog/restore/stamp owners execute effects.
- 2026-09-07 — user: initial-deployment-only default; saved state wins afterward; explicit apply mode exists (I8).
- 2026-09-07 — user: conflicts choose overwrite/error, no dependency-specific behavior; applies independently of prior snapshotId (I8).
- 2026-09-07 — default error follows the user's preserve/stop choice; paths not targeted by application remain saved data, not deletion candidates.
- 2026-09-07 — inherit production tier for new persistence transitions.

## Challenge

challenge: 2026-09-08 — clear
