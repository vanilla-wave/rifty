---
area: playground
status: draft
title: Package authority `ensure` dispatch and `project-switch.resetPackages` have only test callers
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
- `project-switch` command with `resetPackages`: no production sender; the
  authority calls `adapter.switchProject` internally without it. Senders are
  only `package-acquisition-authority.fault.test.ts` ("does not mutate a clean
  project switch when durable destination revocation fails") and
  `tests/integration/npm-shell-command.test.ts`, both with their own adapters.
  The owner adapter's clear+reseed branch had no runner left, so it now throws
  `NotImplementedError('package-acquisition.owner.project-switch.reset-packages')`
  — after the authority's durable revoke (`package-acquisition-authority.ts`
  `project-switch` case), not before effects.

Probe: `git grep -n -E "type: 'ensure'|type: 'project-switch'|resetPackages"
-- 'packages/**' ':!*.test.ts' ':!*test-fixture*'` → only the type
declarations, the two `resetPackages` handler branches and the authority's
internal `#ensure`/`switchProject` calls.

No user-visible behavior; code shrinkage only (REV-7 capture). Owner: package
acquisition authority. Trigger: next change to the authority's command
surface, or a review that cites these routes as dead.

## Question

Delete both routes and retarget their tests to `activate-and-ensure` /
`prepare-first-materialization`, or keep `ensure` dispatch as the authority's
focused test entry? Which of their tests pin a property that live routes still
need?
