---
area: npm-client
status: draft
title: Package-bin source normalization authority
created: 2026-07-28
why: the terminal combined normalization checkpoint proved one strict package source can become exact detached claims without owning cross-source settlement
user_story: As a browser-IDE user installing package CLIs, I want every supported package bin shape normalized once into exact scoped claims, but today the linker has no reusable package-private claim boundary
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-bin-source-claim-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This was the first split successor to terminal
`npm-client/package-bin-claim-normalization-authority` at
`acf363bc6f34b7b070e787fad6619d99c3839723`. Its second Contract+RED
checkpoint proved per-source claim creation and ordered list aggregation are
independently reviewable. This item is now a terminal blocked split predecessor
and receives no third checkpoint.

`npm-client/package-bin-source-claim-authority` now owns one strict source.
Then `npm-client/package-bin-claim-aggregation-authority` owns only ordered list
composition. Current/prior settlement remains in the serial
`npm-client/package-bin-claim-settlement-authority`.

## Reference contract

- ADR-0335 assigns exact `(nodeModulesDir, command, owner, target)` facts to the
  shared package-bin path before collision settlement.
- Existing prepared packages already carry exact `(package, nodeModulesDir)`
  facts. Narrow facts need only `package.name/bin` plus `nodeModulesDir`; they
  never invent files, install paths, or output claims.
- This unit preserves only the linker's currently supported string/object bin
  shapes. npm's broader normalization remains an explicit outside-goal item.

## Acceptance

- One package-private source type positively admits prepared packages and
  narrow facts. Negative type witnesses reject raw `ResolvedPackage` and
  shaped `PackageBinClaim`; the real source-list normalizer has no broader
  input union.
- A prepared root object with multiple commands plus a narrow nested
  scoped-package string returns every exact detached claim in source/command
  order. The scoped string uses the package basename as command and preserves
  its exact scope, owner, and normalized target.
- Same-scope duplicate commands remain two ordered claims. This unit never
  deduplicates, rejects, or chooses a claimant.
- Every successful or rejecting call reads `package.bin` exactly once.
  Traversal and absolute string/object targets reject with the existing exact
  invalid-target error before returning a claim.
- The seam stays absent from `src/index.ts`. No VFS, current/prior language,
  settlement, compat, or linker entrypoint enters this unit.

## Parity cases

1. Prepared and narrow positive witnesses compile; raw package and shaped claim
   negative witnesses remain rejected.
2. One prepared/narrow list with a root multi-command object and nested
   scoped-string returns exact normalized claims after one bin read per source.
3. Same-scope duplicate commands remain two ordered detached claims.
4. String/object traversal and absolute targets reject with the exact error
   after one bin read.
5. The package root does not expose the normalizer.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | only strict sources enter; escaping string/object targets reject exactly | positive/negative type witnesses plus target table |
| sibling-drift | prepared/narrow and string/object shapes use one boundary and one bin read | exact ordered claims plus read counters |
| lossy-aggregate | duplicate scope/command facts remain distinct before settlement | ordered duplicate-claim witness |

## Out of scope

- Multiple-source duplicate detection, current/prior state, per-scope
  settlement, transition/removal/stable-owner decisions, and the named ceiling;
  `npm-client/package-bin-claim-settlement-authority` owns them.
- Public, cancellable, or prepared linker invocation, optional prior
  composition, zero-mutation VFS proof, and compat;
  `npm-client/package-bin-claim-link-ingress-authority` owns them.
- File/bin phase order, launcher target existence and writing, abort, retry,
  `ENOSPC`, and `EACCES`;
  `npm-client/package-bin-phased-linker-authority` owns them.
- npm array/scoped/key/target normalization and malformed metadata outcomes;
  `npm-client/npm-package-bin-normalization-authority` owns that outside the
  goal.

## Decisions

- `split-predecessor:
  acf363bc6f34b7b070e787fad6619d99c3839723`; predecessor checkpoints:
  `880813bf62a85050be44c48694e6560164b5f158` and
  `acf363bc6f34b7b070e787fad6619d99c3839723`.
- This is the only current JIT Items/Budget selection. Historical rows remain
  append-only; claim settlement stays a linked draft until this unit lands.
- A source-list function is the smallest reusable carrier for both current and
  prior lists. Returning duplicates unchanged keeps settlement physically
  outside its contract; no index or comparator enters.
- The predecessor's broadened-prior blocker is split between this exact source
  boundary and the later real optional-prior linker ingress. The global-index
  blocker belongs wholly to claim settlement.
- `contract-red-first:
  3c4adade0ae34b076e536147f5d551e82b737055`; Standards passed, Spec blocked
  exact mixed-readonly type admission, anti-sorted order, exact error identity,
  and late-invalid reached-source reads.
- `terminal-checkpoint:
  2ef0ecf61adb35fade0977cd0d0355be2a975ea5` — second Contract+RED BLOCKED;
  this unit receives no third checkpoint.
- `checkpoint-lineage: [3c4adade0ae34b076e536147f5d551e82b737055,
  2ef0ecf61adb35fade0977cd0d0355be2a975ea5]`.
- `split-successors: [npm-client/package-bin-source-claim-authority,
  npm-client/package-bin-claim-aggregation-authority]`.
- Contract+RED @ `2ef0ecf61adb35fade0977cd0d0355be2a975ea5`
  blocked exactly: both two-element order witnesses still admitted one
  descending tuple comparator.
- The first successor owns only one source and uses a three-command
  non-monotonic object witness. The second successor composes source claims and
  separately owns three-source ordering, duplicates, and later-source errors.
