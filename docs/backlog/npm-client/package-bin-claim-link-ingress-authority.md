---
area: npm-client
status: draft
title: Package-bin claim linker-ingress authority
created: 2026-07-28
why: the terminal claim-preflight checkpoint proved pure normalization and mutation-free public/cancellable/prepared integration are separate review units
user_story: As a browser-IDE user installing package CLIs, I want every linker path to reject ambiguous or escaping claims before changing the tree and keep support claims honest
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-bin-claim-normalization-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This is the serial second split successor to terminal
`npm-client/package-bin-claim-preflight-authority` at
`cbeb4bfe04f270898aa003c04ef8e6edd3daf280`. It starts only after
`npm-client/package-bin-claim-normalization-authority` lands and integrates
that one pure preflight before mutating linker work.

The existing linker remains the sole module. This unit adds no public API,
module, comparator, coordinator, scheduler, lock, or package-specific branch.

## Reference contract

- ADR-0335 requires current or authoritative-prior ambiguity to throw exactly
  `NotImplementedError('npm-client.bin-collision-reify')` before project-tree
  mutation and remain compat ❌.
- Public and cancellable linker paths carry current prepared packages only.
  The package-private prepared path may also receive optional narrow prior
  facts for the later installer integration.
- The normalization predecessor owns claim semantics. This unit owns only its
  truthful placement at existing linker ingresses.

## Acceptance

- Public `link()`, cancellable `linkInstallTree()`, and the already-prepared
  path invoke the real claim preflight before any mutating VFS operation.
  Current duplicates and escaping targets reject through all three paths; an
  optional prior collision/transition/removal rejects through the prepared
  path.
- Operation ledgers record every mutating VFS call, not only final tree state.
  Rejection permits no `mkdir`, write, removal, or cleanup that could hide an
  earlier mutation.
- The prepared optional-prior parameter positively admits the narrow prior
  source and negatively rejects both raw `ResolvedPackage` and shaped
  `PackageBinClaim`. Its type proof compiles against the real prepared
  entrypoint.
- The structured public compat row remains ❌ and names exactly
  `npm-client.bin-collision-reify`; its executable assertion is unconditional.
- Independent root/nested scopes and existing non-colliding public,
  cancellable, and prepared linking remain green.

## Parity cases

1. Opposite current orders reject with zero mutating VFS calls through public,
   cancellable, and prepared paths; independent scopes remain green.
2. Escaping targets reject with zero mutating VFS calls through all three
   paths.
3. Narrow optional prior compiles and rejects ambiguity before mutation; raw
   package and shaped-claim prior arguments remain negative type witnesses.
4. The structured compat ❌ row and non-colliding entrypoint floor stay exact.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| observable-order | current/prior ambiguity and escaping targets precede every mutating VFS call | public/cancellable/prepared operation ledgers |
| corrupt-input | optional prepared prior admits only narrow sources, not raw packages or shaped claims | positive/negative real-entrypoint type witnesses |
| provenance-lie | compat remains ❌ with the exact named ceiling | unconditional structured-row assertion |
| sibling-drift | all three linker paths invoke the same preflight and retain non-colliding behavior | entrypoint zero-mutation and green-floor table |

## Out of scope

- Source/claim types, normalization, read counts, collision/transition/removal
  decisions, scope separation, and escaping-target semantics;
  `npm-client/package-bin-claim-normalization-authority` owns them.
- All-files-before-bins ordering, target existence, launcher writing, abort,
  `ENOSPC`, `EACCES`, and retry;
  `npm-client/package-bin-phased-linker-authority` owns them.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock, and
  reporting; `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `split-predecessor:
  cbeb4bfe04f270898aa003c04ef8e6edd3daf280`; predecessor checkpoints:
  `6fdc19c5b98b9773fa5406126e6ac35c4329b9af` and
  `cbeb4bfe04f270898aa003c04ef8e6edd3daf280`.
- This draft is linked from the terminal predecessor and normalization
  contract. It receives no epic Items/Budget selection before normalization
  lands.
- The prepared optional-prior type proof closes the second predecessor blocker
  only when both raw packages and shaped output claims remain rejected.
- File/bin phase ordering and writer faults stay entirely in the serial phased
  successor.
