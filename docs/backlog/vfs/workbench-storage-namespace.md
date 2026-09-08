---
area: vfs
status: ready
title: Confine Workbench storage to a host-selected OPFS namespace
created: 2026-09-07
why: Workbench currently preloads the whole origin OPFS, including unrelated host files.
user_story: As the Tracker plugin-sandbox embedder, I want to confine workbench storage to a host-selected opfs namespace, but today workbench currently preloads the whole origin OPFS, including unrelated host files.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/vfs/reference/workbench-storage-namespace-evidence.md, ADR-0401, ADR-0072]
code: [packages/vfs/src/sync-mirror.ts, packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts, packages/workbench/src/workbench/internal/workbench-options.ts, packages/workbench/src/workers/workbench-owner-storage.ts]
---

## Context

`installOpfsFs` binds both surfaces to the origin root and preloads every
file. Evidence: `reference/workbench-storage-namespace-evidence.md`.

## User scenario

The embedder opens Workbench with `storage: { persistence: 'required',
namespace: 'plugin-sandbox' }`. A host file already at the origin root is
not visible through the paired VFS and is not overwritten by Workbench
writes. The new namespace's VFS root starts empty. After writing a project
file, a later open of `plugin-other` does not see that file; reopening
`plugin-sandbox` does. Opening without `namespace` still uses the origin
root. An invalid namespace spelling fails before any OPFS directory
create. A failed open of a second namespace leaves the first namespace's
bytes unchanged.

## Acceptance

1. Omitted `storage.namespace` keeps today's origin-root admission and owner initialize `{ persistence }` only. `workbench-storage-namespace.contract.test.ts` omitted case; existing `open-workbench.contract.test.ts` persistence-only start input stays. → I4 → ADR-0401
2. `storage.namespace: 'plugin-sandbox'` (and nested `tenant/plugin`) is valid Workbench admission and is present on the clone-safe initialize frame and `owner.start` input. Same workbench file plus `open-workbench.contract.test.ts` namespace threading case. → I4 → ADR-0401
3. Invalid namespace spelling (`''`, `..`, `.`, `/abs`, `a/../b`, `a//b`) throws `TypeError` / `storage.namespace` before owner start and before any `getDirectoryHandle`. Workbench admission cases and `opfs-storage-namespace.fault.test.ts` invalid case. → I4 → ADR-0401
4. A selected namespace is the VFS `/`: an origin host-file sentinel is not listed or readable; namespaced writes land under that directory at origin, not as origin-root siblings. `opfs-storage-namespace.contract.test.ts` plus `tests/browser-unit/opfs-storage-namespace.spec.ts` (real OPFS, paired `installOpfsFs`). → I4
5. First selection of a unused namespace is empty; two sequential namespaces are isolated; reopening the first preserves its files. Same vfs contract file plus the browser-unit spec. → I4 → scenario
6. `installWorkbenchOwnerStorageAuthority` with a namespace opens OPFS through that namespace (proof path still `/.rifty/workbench/v1/storage-proof` on the bound root). `workers/workbench-storage-namespace.contract.test.ts`. → I4 → ADR-0401

## Fault matrix

- corrupt-input × invalid namespace: `TypeError` naming `storage.namespace` before `getDirectoryHandle` / owner start; origin children unchanged. `opfs-storage-namespace.fault.test.ts` invalid case. → I4 → ADR-0401
- torn-state × failed setup/reopen of a second namespace: first namespace bytes unchanged. Same fault file blocked-segment case; browser-unit blocked reopen. → I4 → ADR-0401
- quota-perm-fail × namespaced OPFS open: loud throw (required) or existing preferred fallback; the other namespace's bytes unchanged. Same fault file quota case. → I4
- sibling-drift × paired install: async and sync surfaces share one resolved handle (host sentinel absent on both). Browser-unit `installOpfsFs` case. → I4 → ADR-0401

## Out of scope

Automatic migration of origin or former-namespace files. Multiple concurrent
Workbench owners. Hostile-code sandboxing. Changing the existing origin
lease. Playground `initBackend()` origin default. Orphan Scratch recovery
(I6), preview prefix (I5), operation budgets (I7). Memory/`ephemeral`
isolation (already a fresh tree). Browser eviction guarantees.

## Decisions

- ready-verdict: 2026-09-09 — Contract+RED @ a1543038aa6722902ca85899dd7a38c3bf7b2c7b
- 2026-09-09 — ADR-0401: optional clone-safe `storage.namespace` string; omitted = origin; one parse+resolve; both surfaces share the handle; empty on first create; no migration.
- 2026-09-07 — finding draft; observable scope is settled by goal I4; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-09 — clear
