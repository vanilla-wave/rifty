---
area: npm-client
status: draft
title: Package-bin claim preflight authority
created: 2026-07-28
why: the terminal combined linker checkpoint could not prove narrow current/prior claim admission and the npm-history ceiling before the first mutating VFS operation
user_story: As a browser-IDE user installing packages with CLIs, I want ambiguous command ownership rejected before the project tree changes, but today package files can land before the linker discovers the collision
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This is the first split successor to terminal
`npm-client/package-bin-claim-linker-authority` at
`30416e72eea35cd992ef87f62b951d6c70eb45fb`. It consumes the landed prepared
install-path carrier and stops at detached package-bin claims. Package-file and
launcher VFS work belongs to the serial
`npm-client/package-bin-phased-linker-authority`.

The existing linker remains the sole package-bin module. This unit adds no
module, public API, comparator, scheduler, lock, or package-specific branch.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command ownership is reify-history-sensitive, not a static comparator.
- ADR-0335 requires current or authoritative-prior ambiguity to throw exactly
  `NotImplementedError('npm-client.bin-collision-reify')` before project-tree
  mutation and remain compat ❌.
- Current packages already carry exact prepared `(package, nodeModulesDir)`
  facts. Authoritative prior contributes only `(package.name/bin,
  nodeModulesDir)` and never fabricates package files or install paths.
- Public and cancellable linker paths carry current claims only. The
  package-private prepared path accepts OPTIONAL narrow prior facts for the
  later real-installer successor; no public API changes.

## Acceptance

- One package-private bin-source type admits both prepared current packages and
  narrow authoritative-prior facts. Positive type witnesses compile for both;
  negative witnesses reject raw `ResolvedPackage` and shaped claims at the
  source ingress. The prepared path's OPTIONAL prior parameter also compiles
  only for narrow sources.
- Normalize each supported string/object bin exactly once on success. Counted
  rejecting branches never reread a reached source. Current and prior access
  proves no raw `installPath` reread and an exact detached
  `(nodeModulesDir, command, owner, target)` current claim.
- Equal command text in different root/nested scopes remains independent.
  Opposite-order same-scope current duplicates, recorded prior collisions,
  owner transitions, and removals throw the named ceiling. A stable sole owner
  remains admissible when its target changes and returns only the current
  target.
- Current/prior ambiguity and escaping targets reject before any mutating VFS
  call. Current duplicates and escaping targets run through public,
  cancellable, and prepared paths; a supplied prior transition runs through the
  prepared path. Every proof records the operation ledger, not only final tree
  state, so a write followed by cleanup cannot pass.
- Throw-on-second-read witnesses cover every current duplicate, prior
  collision, transition, removal, and escaping-target branch, not only
  successful normalization.
- The structured public compat row records same-command package-bin settlement
  as ❌ and names exactly `npm-client.bin-collision-reify`; its executable
  assertion is unconditional.
- Existing non-colliding public and cancellable linking remains green.

## Parity cases

1. Opposite current orders in root and nested scopes reject with zero mutating
   VFS calls through public, cancellable, and prepared paths; independent
   scopes return both exact claims.
2. Prior collision, transition, and removal reject; stable string/object owners
   return only their current normalized targets. Prepared prior transition
   rejects before mutation.
3. Prepared-current and narrow-prior positive type witnesses compile while raw
   package and claim negative witnesses remain rejected.
4. Escaping targets reject before mutation through all three linker paths; the
   exact structured compat ❌ row stays loud.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | current/prior ambiguity rejects before the first mutating VFS call; no static npm winner | packed npm probe plus public/cancellable/prepared opposite-order and prepared-prior ledgers |
| corrupt-input | only prepared/narrow sources enter; escaping target rejects before mutation | positive/negative type witnesses plus three-entrypoint target ledger |
| sibling-drift | current and prior use one normalization boundary exactly once on success and rejection | all-branch string/object read-count table |
| provenance-lie | compat remains ❌ with the exact named ceiling | unconditional structured-row assertion |

## Out of scope

- Package-file settlement, all-files-before-bins ordering, launcher target
  existence, abort, `ENOSPC`, `EACCES`, and retry;
  `npm-client/package-bin-phased-linker-authority` owns them.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock,
  reports, and their order;
  `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `split-predecessor:
  30416e72eea35cd992ef87f62b951d6c70eb45fb`; predecessor checkpoints:
  `e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed` and
  `30416e72eea35cd992ef87f62b951d6c70eb45fb`.
- This is the only current JIT Items/Budget selection. The phased successor
  remains a linked draft until this unit lands.
- The second predecessor review allocated narrow type proof, normalization,
  zero-mutation ambiguity/target admission, and compat honesty here. It
  allocated every mutating VFS behavior to the serial phased successor.
- First successor Contract+RED @
  `6fdc19c5b98b9773fa5406126e6ac35c4329b9af` blocked: restore the
  append-only predecessor Budget row; run current duplicate and escaping
  ledgers across public/cancellable/prepared paths; integrate optional prior at
  the prepared boundary; count every rejecting current/prior source read. The
  in-place re-cut changes no observable behavior or split boundary.
- ADR-0335 and the npm oracle settle the behavior fork: ambiguity throws; no
  comparator or plausible winner ships.
