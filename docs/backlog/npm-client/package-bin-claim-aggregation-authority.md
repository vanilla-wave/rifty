---
area: npm-client
status: draft
title: Package-bin claim aggregation authority
created: 2026-07-28
why: the terminal source-list checkpoint proved ordered composition of exact per-source claims needs its own boundary before settlement
user_story: As a browser-IDE user installing package CLIs, I want all package claims preserved in input order before collision checks, but today linker traversal can silently choose ownership
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This is the serial second split successor to terminal
`npm-client/package-bin-source-normalization-authority` at
`2ef0ecf61adb35fade0977cd0d0355be2a975ea5`. It starts after
`npm-client/package-bin-source-claim-authority` lands and composes only that
single-source function.

The existing linker remains the sole package-bin module. This unit adds no
parser, settlement, VFS owner, public API, comparator, scheduler, lock, or
package-specific branch.

## Reference contract

- The predecessor returns exact claims in command order after one bin read.
- Aggregation preserves source order and duplicates. It never infers ownership.
- ADR-0335 assigns all ambiguity decisions to later current/prior settlement.

## Acceptance

- One exact readonly mixed source list admits prepared and nested scoped-string
  narrow sources while rejecting raw `ResolvedPackage` and shaped
  `PackageBinClaim`.
- An empty readonly source list returns the exact empty claim list.
- Compose the predecessor once per reached source. Preserve a deliberately
  non-monotonic three-source sequence and each source's command order exactly.
- Same-scope duplicate commands remain separate ordered claims.
- A later invalid source preserves the exact error and never rereads any
  earlier or failing source; following sources remain unread.
- No current/prior settlement, named ceiling, VFS, compat, linker entrypoint, or
  public export enters this unit.

## Parity cases

1. Mixed readonly prepared/narrow input compiles; raw/claim inputs reject.
2. Three non-monotonic sources return exact ordered claims.
3. Duplicate scope/command facts remain separate in source order.
4. Valid prefixes followed by string/object escaping targets read each reached
   source once, leave following sources unread, and return the exact error.
5. The empty readonly source list returns `[]`.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| observable-order | source/command order and later-error priority remain exact | non-monotonic three-source sequence plus unread suffix |
| lossy-aggregate | duplicate scope/command facts remain distinct | same-scope duplicate sequence |
| sibling-drift | every reached source keeps exact landed normalization behavior and one bin read | real landed types, prepared/scoped-narrow mixed list, and later-error read counters |
| corrupt-input | later escaping source retains exact predecessor error | valid-prefix string/object target table |

## Out of scope

- Source/claim shapes, bin parsing, command order within a source, and target
  validation; `npm-client/package-bin-source-claim-authority` owns them.
- Current/prior settlement; `npm-client/package-bin-claim-settlement-authority`
  owns it.
- Linker entrypoints, VFS mutation, optional-prior composition, and compat;
  `npm-client/package-bin-claim-link-ingress-authority` owns them.

## Decisions

- `split-predecessor:
  2ef0ecf61adb35fade0977cd0d0355be2a975ea5`; predecessor checkpoints:
  `3c4adade0ae34b076e536147f5d551e82b737055` and
  `2ef0ecf61adb35fade0977cd0d0355be2a975ea5`.
- Source claim normalization has landed; this Contract+RED re-cut adds the sole
  epic Items/Budget selection before production pickup.
- Flat ordered composition is sufficient. No sort, comparator, key, map,
  scheduler, or state owner is permitted.
- Keep the predecessor checkpoint's package-private
  `normalizePackageBinSources` name; direct predecessor composition is
  implementation-review evidence, not a reason to add an injectable spy seam.
