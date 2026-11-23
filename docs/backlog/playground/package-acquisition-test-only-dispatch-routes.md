---
area: playground
status: draft
title: Package authority `ensure` and `project-switch` dispatch routes have only test callers
created: 2026-11-17
why: Retiring the stamp-miss snapshot restore left two authority dispatch routes that no production code sends
sources: [packages/workbench/CHANGELOG.md, docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [packages/workbench/src/workers/package-acquisition-types.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/glue/project-deps.test-fixture.ts]
---

## Context

Observed 2026-11-17 after the stamp-miss restore removal (ADR-0135 correction
2026-11-17; last production senders were owner `transition` and
`ensureProjectDependencies`, now a test harness):

- `dispatch({ type: 'ensure' })` (`EnsurePackagesCommand`): no production
  sender. The private `#ensure` stays live through `activate-and-ensure` and
  `prepare-first-materialization`. Senders: `glue/project-deps.test-fixture.ts`
  (harness used by `project-deps.test.ts`, `dep-snapshot.test.ts`,
  `package-acquisition-authority.test.ts`) and direct dispatches in
  `package-acquisition-authority{,.fault}.test.ts`,
  `package-acquisition-invalid-claim.test.ts`,
  `tests/integration/npm-shell-eddy-glue.test.ts`. The install-backed harness
  tests drive `snapshotSource` with `fallback: 'install'`, a combination
  production no longer sends (first materialization is `snapshot-only`; `activate-and-ensure`
  has no `snapshotSource`).
- The harness adapter (`createTestProjectPackageAcquisitionAuthority`) is not the
  production owner adapter (`owner-package-state.ts`). Its `planSnapshotRestore`
  restores the untiered payload (no `runtimeTier: 'coi'` projection), applies
  cache and payload together with no persisted-cache flush gate between them,
  and runs neither template `node_modules` seeding nor
  `finalizePackageInstallFiles`; its `install` adapter is the test's own
  `install` callback. About 30 `project-deps.test.ts` tests run the
  real authority, stamp and VFS through it, so they prove authority semantics,
  not the production adapter. Pickup must retire or retarget them.
- `dispatch({ type: 'project-switch' })` (`ProjectSwitchCommand`): no
  production sender since its only one, the retired owner `transition`, was
  removed (PR #398 also removed its `resetPackages` flag). The authority still
  calls `adapter.switchProject` internally from `activate-and-ensure` and
  `prepare-first-materialization`. Senders: `package-acquisition-authority.test.ts`
  and `tests/integration/npm-shell-command.test.ts`.

Probe: `git grep -n -E "type: '(ensure|project-switch)'" -- packages apps tests
tools ':!*.test.ts' ':!*test-fixture*'` → only the type declarations and the
authority's internal `#ensure` / `adapter.switchProject` calls.

No user-visible behavior; code shrinkage only (REV-7 capture). Owner: package
acquisition authority. Trigger: next change to the authority's command
surface, or a review that cites these routes as dead.

## Question

Delete the `ensure` and `project-switch` dispatch routes and retarget their
tests to `activate-and-ensure` / `prepare-first-materialization` through the
production adapter, or keep them as the authority's focused test entries? Which
of their tests pin a property that live routes still need?
