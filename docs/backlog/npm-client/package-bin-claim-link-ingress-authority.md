---
area: npm-client
status: draft
title: Package-bin claim linker-ingress authority
created: 2026-07-28
why: the terminal claim-preflight checkpoint proved pure normalization and mutation-free public/cancellable/prepared integration are separate review units
user_story: As a browser-IDE user installing package CLIs, I want every linker path to reject ambiguous or escaping claims before changing the tree and keep support claims honest
epic: honest-shadow-substitutions
sources: [ADR-0335, ADR-0343, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This is the serial second split successor to terminal
`npm-client/package-bin-claim-preflight-authority` at
`cbeb4bfe04f270898aa003c04ef8e6edd3daf280`. It starts only after
`npm-client/package-bin-source-claim-authority`,
`npm-client/package-bin-claim-aggregation-authority`, and
`npm-client/package-bin-claim-settlement-authority` land, then composes those
pure seams before mutating linker work.

The existing linker remains the sole module. This unit adds no public API,
module, comparator, coordinator, scheduler, lock, or package-specific branch.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential and
  golden reproduce fresh/rebuild/incremental/removal ownership; no local-link
  or self-authored comparator substitutes for that oracle.
- ADR-0335 requires current or authoritative-prior ambiguity to throw exactly
  `NotImplementedError('npm-client.bin-collision-reify')` before project-tree
  mutation and remain compat ❌.
- Public and cancellable linker paths carry current prepared packages only.
  The package-private prepared path may also receive optional narrow prior
  facts for the later installer integration.
- The source-claim, aggregation, and claim-settlement predecessors own pure
  claim semantics. This unit owns only their truthful composition at existing
  linker ingresses.
- ADR-0343 and PR #234 own companion eligibility plus raw package, result,
  manifest, and lock metadata. This unit consumes only the existing
  linker-facing prepared projection; it does not broaden that boundary.

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
- The structured public compat row remains ❌ and says in present tense that
  collision-free scopes link; ambiguous current claims or a supplied
  authoritative-prior collision, owner transition, or removal throw exactly
  `NotImplementedError('npm-client.bin-collision-reify')` before project-tree
  mutation; npm's operation-sensitive ADD/CHANGE/no-op/remove/rebuild ownership
  lifecycle remains unsupported. Its executable assertion is unconditional.
- Independent root/nested scopes and existing non-colliding public,
  cancellable, and prepared linking remain green.

## Parity cases

1. Opposite current orders with distinct targets reject in both root and nested
   scopes with zero mutating VFS calls through root-public, cancellable, and
   prepared paths; equal commands in independent scopes remain green.
2. Escaping targets reject with zero mutating VFS calls through all three
   paths.
3. Narrow optional prior compiles and rejects ambiguity before mutation; raw
   package and shaped-claim prior arguments remain negative type witnesses.
4. The structured compat ❌ row and non-colliding entrypoint floor stay exact.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | oracle-proven current/prior ambiguity precedes every mutating VFS call; no static winner | packed npm probe plus public/cancellable/prepared operation ledgers |
| corrupt-input | optional prepared prior admits only narrow sources and escaping targets reject before mutation through all three paths | positive/negative real-entrypoint type witnesses plus target ledgers |
| provenance-lie | compat remains ❌ with the exact named ceiling | unconditional structured-row assertion |
| sibling-drift | all three linker paths invoke the same preflight and retain non-colliding behavior | entrypoint zero-mutation and green-floor table |

## Out of scope

- Source/claim types, normalization, read counts, and escaping-target semantics;
  `npm-client/package-bin-source-claim-authority` owns them.
- Source-list order, duplicates, and later-source errors;
  `npm-client/package-bin-claim-aggregation-authority` owns them.
- Collision/transition/removal decisions and scope separation;
  `npm-client/package-bin-claim-settlement-authority` owns them.
- All-files-before-bins ordering, target existence, launcher writing, abort,
  `ENOSPC`, `EACCES`, and retry;
  `npm-client/package-bin-phased-linker-authority` owns them.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock, and
  reporting; `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `pre-demotion-ready-verdict: 2026-07-30 — Contract+RED @
  33ecc7ff5e9abb5169effd54467dd1ebe4f3dfae`; the Acceptance and Parity cases
  above are verbatim from that attempted ready contract.
- `split-predecessor:
  cbeb4bfe04f270898aa003c04ef8e6edd3daf280`; predecessor checkpoints:
  `6fdc19c5b98b9773fa5406126e6ac35c4329b9af` and
  `cbeb4bfe04f270898aa003c04ef8e6edd3daf280`.
- This draft was linked from the terminal predecessors and serial pure
  successors. It received no epic Items/Budget selection before claim
  settlement landed.
- The prepared optional-prior type proof closes the second predecessor blocker
  only when both raw packages and shaped output claims remain rejected.
- File/bin phase ordering and writer faults stay entirely in the serial phased
  successor.
- PR #233 pickup `75eb32052b294f341388630cf193f35970cf1da6`,
  production `9a30c01549937bd98f081081fe0ec163f1b59d27`, and closure
  `d50a80ffa5e888588af84fd5da3c22ce8c4cb60c` passed local Final+GREEN, but
  remote run `30562763189` exposed the unsettled companion-claim fork.
- Per `decision-workflow.md` §Backlog readiness 5, PR #233's post-pickup item
  stayed draft and was blocked by
  `npm-client/package-bin-companion-claim-admission-authority`. Its next
  Contract+RED must diff against the preserved clauses above; weakening them
  requires manual refinement.
- PR #234 landed companion-claim admission at
  `e330630a63e1bfee29d4212bf18b703efb821610`; epic Item 15 and Budget row
  `20–80` select this fresh re-cut. Acceptance and Parity remain unchanged.
- `contract-red-recut:
  1f992198b54423cd5bedf40dcef0b5b0b1caa5ab`; byte-identical 138-line
  carrier, runtime 10 RED / 1 GREEN, package typecheck exactly `TS2322` +
  `TS2554`, inherited companion floor 26/26 GREEN, canonical browser Vite
  floor 1/1 GREEN, no production source.
