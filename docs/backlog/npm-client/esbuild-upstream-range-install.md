---
area: npm-client
status: ready
title: Explicit COI installs resolve esbuild ranges to byte-identical upstream twins
created: 2026-10-20
why: installer currently pins every admitted esbuild request to the generated 0.28.0 recipe
epic: esbuild-upstream-twin
sources: [ADR-0543, ADR-0361, ADR-0371]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/internal/shadow/admission.ts, packages/npm-client/src/internal/shadow/planner.ts, tools/shadow-registry/src/internal/catalog-source.ts]
---

## Context

Next install wall of the goal. This unit exposes explicit installer policy;
Workbench selection, runtime loading and Vite remain in the cutover unit.
No alternate PR. The new policy must not narrow requests to a verified list.

## Challenge

challenge: 2026-10-20 — clear; goal's rejected exact-version route unchanged.
Use existing resolution, tarball integrity, linker and trace publication;
only recipe selection/materialization becomes tier/version aware (ADR-0543).

## Acceptance

1. `install({runtimeTier:'coi'})` resolves the original esbuild range against
   esbuild-wasm; installs the complete unchanged upstream tree and thin facade
   with matching version, usable types and bin; emits substitution provenance
   and no generated-runtime binding. Real 0.21.5/0.25.12/0.28.2 archives. → I1
2. Offline replay reproduces the same lock/tree without metadata acquisition;
   traced template/version/file identity remains validated. → I1
3. Omitted tier and explicit no-coi retain the exact 0.28.0 policy. Incompatible
   range or a COI lock pinning 0.28.2 fails with a named no-COI error, without
   rewriting that lock or substituting another pin. → I4
4. New verified versions require only version/archive inputs, no new recipe,
   hash constants, declaration copies or dependency-admission ceiling. → I5

## Reference contract

Registry semver selection over upstream esbuild-wasm packuments; tarball
members are the byte oracle. `installer-esbuild-upstream.test.ts` uses real
MemoryVfs, RegistryClient, unpacker and installer, with HTTP as its sole
injected boundary. Recipe representation follows ADR-0543; no runtime adapter.
Existing user override precedence, integrity and lock corruption rules remain.

## Parity cases

1. Three version/range cases and complete-member comparisons; repeat offline.
   Current RED: older ranges refused; 0.28.x receives a runtime binding. → I1
2. No-COI admitted baseline, named rejection, cross-tier lock unchanged.
   Current RED: generic error lacks tier; a COI request still pins 0.28.0. → I4

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| stale-state × lock replay | recipe/version/files verified, no silent re-resolution | installer-esbuild-upstream; existing shadow replay corruption suite | → I1 |
| torn-state × install publication | existing integrity/rollback/stamp boundary remains | internal/shadow/installer.contract.test.ts | → I1 |
| policy drift × tier switch | incompatible pin fails before publication | cross-tier lock case | → I4 |

## Out of scope

Workbench host selection, generated-runtime loading, Node runtime repairs,
CLI npx/file stdout and Vite remain required in the linked cutover unit.
No migration of old catalog traces; goal explicitly accepts EBROKENLOCK.

## Decisions

- 2026-10-20 — RDY-5 split the installer wall from cutover; destination unchanged.
- 2026-10-20 — ADR-0543 selects explicit tier, requested-range template and thin facade.
