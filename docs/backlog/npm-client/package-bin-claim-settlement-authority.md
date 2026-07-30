---
area: npm-client
status: draft
title: Package-bin claim settlement authority
created: 2026-07-28
why: the terminal normalization checkpoint proved normalized claim settlement needs its own exact per-scope current/prior boundary
user_story: As a browser-IDE user installing package CLIs, I want ambiguous command history rejected per node_modules scope, but today the linker can choose a tree-order winner
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This is the serial second split successor to terminal
`npm-client/package-bin-claim-normalization-authority` at
`acf363bc6f34b7b070e787fad6619d99c3839723`. It starts after
`npm-client/package-bin-source-claim-authority` and
`npm-client/package-bin-claim-aggregation-authority` land, then composes that
one exact aggregation seam for current and prior sources.

The existing linker remains the sole package-bin module. This unit adds one
pure preflight, no second source parser, public API, VFS owner, comparator,
scheduler, lock, or package-specific branch.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command ownership is reify-history-sensitive, not a static comparator.
- ADR-0335 requires current or authoritative-prior ambiguity to throw exactly
  `NotImplementedError('npm-client.bin-collision-reify')`.
- Both source lists use the aggregation predecessor. Settlement identity is the
  exact pair `(nodeModulesDir, command)`, never command alone or a joined string
  key.

## Acceptance

- The real preflight positively admits prepared/narrow current and prior
  sources and negatively rejects raw `ResolvedPackage` and shaped
  `PackageBinClaim` in both argument positions.
- Aggregate current and optional-prior source lists through the one predecessor
  boundary; return only current claims without reordering or rewriting them.
- Opposite-order same-scope current duplicates and recorded prior collisions
  throw the exact named ceiling.
- A prior claim missing from current or changing owner throws the ceiling. A
  stable sole owner may change target and returns only the current target.
- Equal command text with distinct matching owners in root and nested scopes
  remains independent for both current and prior inputs.
- No source normalization, VFS, linker entrypoint, compat, or public export
  enters this unit.

## Parity cases

1. Prepared/narrow positives compile and raw/claim negatives remain rejected
   for both current and prior arguments.
2. Both current orders in root and nested scopes reject with the exact ceiling.
3. Prior collision, owner transition, and removal reject.
4. Stable owner target change returns the exact current claim.
5. Distinct matching root/nested owners with equal commands settle
   independently.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | ambiguous current/prior history throws; no static winner | packed npm probe plus current/prior matrix |
| lossy-aggregate | scope and command remain separate exact identity fields | equal-command distinct-owner root/nested case |

## Out of scope

- Package source types, string/object normalization, bin reads, and escaping
  targets; `npm-client/package-bin-source-claim-authority` owns them.
- Readonly list admission, source order, duplicates, and later-source errors;
  `npm-client/package-bin-claim-aggregation-authority` owns them.
- Source composition through public/cancellable/prepared linker paths,
  optional-prior type admission, zero-mutation VFS proof, and compat;
  `npm-client/package-bin-claim-link-ingress-authority` owns them.
- File/bin phase order, target existence, launcher writing, abort, retry, and
  VFS faults; `npm-client/package-bin-phased-linker-authority` owns them.
- Complete npm ADD/CHANGE/no-op/remove/rebuild and direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside the goal.

## Decisions

- `split-predecessor:
  acf363bc6f34b7b070e787fad6619d99c3839723`; predecessor checkpoints:
  `880813bf62a85050be44c48694e6560164b5f158` and
  `acf363bc6f34b7b070e787fad6619d99c3839723`.
- This draft receives no epic Items/Budget selection before source
  normalization lands.
- One composed aggregation seam removes parser/order ownership from this unit.
  A nested `Map<nodeModulesDir, Map<command, claim>>` is sufficient; no
  delimiter, comparator, sort, scheduler, or state owner is permitted.
- Distinct root/nested owners claiming the same command are the executable
  guard against a global command index.
