---
area: npm-client
status: draft
title: Shadow materialized-bin commit authority
created: 2026-07-28
why: the blocked recipe-v2 predecessor proved package bins link before registry aliases, acquired-twin bins can leak, and substitution success can publish before bin or lock settlement
user_story: As a browser-IDE user invoking a substituted package CLI, I want the exact materialized package to own a collision-free launcher only after its files and lock commit, but today an acquired twin can own it and a failed install can still claim success
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-materialized-bin-commit-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/shadow-materialized-bin-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This is the first implementation successor to
`npm-client/shadow-recipe-v2-authority` / PR #212. Its lineage carries every
blocked checkpoint through
`87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`; it is a new unit, not a third
review of the predecessor.

This item is now a terminal blocked split predecessor. Its two Contract+RED
checkpoints proved that generic current/prior package-bin authority and
shadow-specific commit authority are independently reviewable units. The
existing linker remains the sole package-bin module;
`npm-client/package-bin-linker-authority` owns its generic preflight and phase
surface, then `npm-client/shadow-materialized-bin-commit-authority` owns exact
recipe/acquired-twin integration and commit-scoped reporting. Exact acquisition
projection and v2 replay stay in the serial successor
`npm-client/shadow-recipe-v2-acquisition-replay-authority`.

## Reference contract

- The completed schema-2 data authority strictly verifies each recipe's
  materialization bin map and target membership before this execution boundary.
- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command settlement is reify-history-sensitive. This unit therefore
  implements no comparator or approximate winner: ambiguity is a named loud
  ceiling.

## Acceptance

- Recipe materialization owns the exact user-visible bin map. Acquired bins
  never leak into linking or their lock entry; one shared package-bin linker
  validates and links the materialized targets. The current synthetic esbuild
  recipe is the positive executable claim; registry and synthetic claims cross
  the same acquisition-independent linker seam.
- Before project-tree mutation, collect ordinary and materialized claims by
  command and `node_modules` scope after excluding acquired twins. A duplicate
  current claim, recorded prior collision, or owner transition requiring npm
  reify history loud-throws
  `NotImplementedError('npm-client.bin-collision-reify')`. No static winner is
  written; the public compat row stays ❌.
- After preflight, package files settle first, registry aliases second, one
  package-bin pass third, internals shims fourth, and lock publication fifth.
  Existing per-install substitution lines are staged and flush only after the
  successful lock commit.
- Missing targets, abort, `ENOSPC`, and `EACCES` during reachable alias or bin
  work stay loud and publish no substitution line, result, or lock. Retry
  reconciles exact materialized bytes and launcher without a second writer.
- Fresh and replayed esbuild materialize the same files and `.bin/esbuild`;
  invoking the unsupported CLI names `NotImplementedError('esbuild.cli')`.
- Existing Workbench package operations retain the sole owner FIFO through the
  complete installer promise; raw concurrent public `install()` remains
  outside the supported product boundary and gains no second scheduler.

## Parity cases

1. Fresh and replayed esbuild materialize identical `bin/esbuild` bytes and
   `.bin/esbuild`; the lock entry names only that materialized claim.
2. A registry acquisition advertising the trigger command contributes no disk
   launcher or lock bin; an empty registry materialization bin map remains
   empty.
3. Current root/nested duplicates and prior-owner transitions throw the named
   collision ceiling before package files, reports, or lock writes.
4. Alias/bin abort and quota/permission faults emit no report or lock; a retry
   lands the exact launcher and reports once after commit.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | no comparator substitutes for npm's operation-sensitive reify lifecycle; ambiguous current/prior claims reject before effects | packed npm probe plus collision preflight table |
| corrupt-input | invalid command/target or missing materialized target rejects before launcher/report/lock | shared linker target faults |
| torn-state | abort during reachable alias or bin work publishes no report/result/lock; retry reconciles exact bytes | synthetic esbuild plus registry alias fault table |
| quota-perm-fail | alias/bin `ENOSPC` or `EACCES` publishes no report/result/lock; retry reconciles | root/nested alias and real esbuild bin faults |
| concurrent-same-key | supported Workbench callers remain physically excluded by the existing owner FIFO through installer settlement | inherited owner-FIFO suite; no npm-client scheduler |
| sibling-drift | ordinary and materialized claims use the existing linker; acquired twins are excluded before it | public linker plus real install-core cases and finite source gate |

## Out of scope

- Exact registry projection, embedded-bundle extraction/lock, v2 trace/replay,
  Workbench lock assertions, and Chromium v2 acceptance;
  `npm-client/shadow-recipe-v2-acquisition-replay-authority` owns them.
- Implementing npm 11 same-command ownership, ADD/CHANGE/no-op/remove/rebuild,
  or direct-Link behavior. These stay loud compat ❌ and are tracked outside
  this goal by `npm-client/npm-11-bin-reify-authority`.
- Broad dependency-projection execution, peer placement, Sass, raw public
  concurrent `npm-client.install()`, or a public/custom recipe interface.

## Decisions

- `terminal-checkpoint:
  9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97` — second Contract+RED BLOCKED.
- `split-successors: [npm-client/package-bin-linker-authority,
  npm-client/shadow-materialized-bin-commit-authority]`.
- Contract+RED @ `9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97` blocked:
  generic current/prior package-bin settlement plus its phased linker surface
  must land independently of recipe claims, acquired-twin suppression, alias /
  shim / lock order, and commit-scoped reporting.
- Contract+RED @ `4c5b583620eebb962b1ea11f355cb5f64c4aa4b8` blocked: add
  recorded-prior-collision, acquired-twin collision exclusion, internals-shim
  failure, and lock-write failure REDs plus the append-only Items/Budget
  declaration; one lawful re-cut remains.
- `split-predecessor:
  87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`; checkpoint lineage:
  `8f3251e89020772f15ff5a13022e7f7310f703d2`,
  `d5ffb3d2de8a27b26a13f541d2e5d16260d4b8d8`,
  `5c450fb9a5cab66a45b24eb8b19a1729c622e5a9`,
  `b7725a3e88278f4f24efb1d8c8d90e80de08de43`,
  `092d931a533ea45fa060367bd9373f78a7f2c684`, and
  `87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`.
- ADR-0335 supersedes ADR-0328. Exact recipe claims remain here; npm reify
  history owns collision settlement and is never approximated.
- The existing linker is the deep package-bin module. Package-private phase
  entrypoints compose under public `link()` and installer ordering; no second
  bin writer, comparator helper, or coordination owner ships.
- The existing per-install reporter may stage lines but remains the sole
  provenance-report owner; lock publication is the commit boundary.
