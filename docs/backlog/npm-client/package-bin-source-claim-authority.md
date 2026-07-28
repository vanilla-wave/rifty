---
area: npm-client
status: draft
title: Package-bin source claim authority
created: 2026-07-28
why: the terminal source-list checkpoint proved one package source can become exact claims independently from ordered aggregation
user_story: As a browser-IDE user installing package CLIs, I want each supported package bin shape read once into exact claims, but today bin parsing is coupled to launcher mutation
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This is the first split successor to terminal
`npm-client/package-bin-source-normalization-authority` at
`2ef0ecf61adb35fade0977cd0d0355be2a975ea5`. It owns one strict
package-private source type, one detached claim type, and one single-source
normalizer in the existing linker module.

One source per call physically excludes source-list ordering, duplicate
settlement, history, and VFS. The serial
`npm-client/package-bin-claim-aggregation-authority` owns list composition.

## Reference contract

- ADR-0335 assigns exact `(nodeModulesDir, command, owner, target)` facts to the
  shared package-bin path before collision settlement.
- Existing prepared packages already carry exact `(package, nodeModulesDir)`
  facts. Narrow facts need only `package.name/bin` plus `nodeModulesDir`.
- This unit preserves only the linker's currently supported string/object bin
  shapes. npm's broader normalization remains an explicit outside-goal item.

## Acceptance

- One package-private source type positively admits a prepared package and a
  narrow fact. Negative type witnesses reject raw `ResolvedPackage` and shaped
  `PackageBinClaim`; the real single-source function also rejects a source list
  and any second source argument.
- A prepared root object with three deliberately non-monotonic commands returns
  every exact detached claim in insertion order. A narrow nested scoped-package
  string uses the package basename as command and preserves exact scope, owner,
  and normalized target.
- Every successful or rejecting call reads `package.bin` exactly once.
  Traversal and absolute string/object targets reject with the exact existing
  message; object rejection reaches a later invalid command after a valid one.
- The seam stays absent from `src/index.ts`. No source-list aggregation,
  current/prior settlement, VFS, compat, or linker entrypoint enters this unit.

## Parity cases

1. Prepared/narrow positives compile; raw package, shaped claim, source-list,
   and second-source negatives remain rejected.
2. A three-command non-monotonic object returns exact insertion-ordered claims
   after one read.
3. A nested scoped string returns its exact default command and target after
   one read.
4. String/object traversal and absolute targets reject with exact messages
   after one read; the object invalid is not the first command.
5. The package root does not expose the normalizer.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | only strict sources enter; escaping string/object targets reject exactly | positive/negative types plus later-invalid target table |
| sibling-drift | prepared/narrow and string/object shapes share one exact once-read boundary | multi-command/scoped-string claims plus counters |
| observable-order | object command order and exact fields survive normalization | three-command non-monotonic claim sequence |

## Out of scope

- Source-list composition, cross-source order, duplicates, and later-source
  errors; `npm-client/package-bin-claim-aggregation-authority` owns them.
- Current/prior collision, transition, removal, stable owner, and the named
  ceiling; `npm-client/package-bin-claim-settlement-authority` owns them.
- Public/cancellable/prepared linker invocation, optional-prior composition,
  zero-mutation VFS proof, and compat;
  `npm-client/package-bin-claim-link-ingress-authority` owns them.
- npm array/scoped/key/target normalization and malformed metadata outcomes;
  `npm-client/npm-package-bin-normalization-authority` owns that outside the
  goal.

## Decisions

- `split-predecessor:
  2ef0ecf61adb35fade0977cd0d0355be2a975ea5`; predecessor checkpoints:
  `3c4adade0ae34b076e536147f5d551e82b737055` and
  `2ef0ecf61adb35fade0977cd0d0355be2a975ea5`.
- This is the only current JIT Items/Budget selection. Historical rows remain
  append-only; aggregation stays a linked draft until this unit lands.
- One-source input is the smallest honest carrier and cannot sort sources,
  deduplicate claims, index scopes, or choose a winner.
- Three non-monotonic commands reject both ascending and descending comparator
  false-greens without prescribing a comparator of its own.
- `contract-red-first:
  b0c2e20613ec002db35a4dc5b220024f5117131a`; Standards blocked the
  `lossy-aggregate` misclassification and Spec blocked missing array/second-arg
  negative witnesses. This in-place re-cut is the second and final Contract+RED
  checkpoint for this unit.
