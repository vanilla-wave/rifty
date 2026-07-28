---
area: npm-client
status: draft
title: Package-bin linker authority
created: 2026-07-28
why: the terminal materialized-bin RED proved the shared linker can mutate package files before discovering a same-scope command collision and has no generic way to reject ambiguous prior ownership
user_story: As a browser-IDE user installing packages with CLIs, I want one package-bin linker to reject ownership it cannot settle like npm before changing the project tree, but today manifest order can silently choose a launcher
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md, docs/backlog/npm-client/reference/shadow-materialized-bin-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This is the first split successor to terminal predecessor
`npm-client/shadow-materialized-bin-authority` at
`9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`. It owns only package-generic bin
claim authority. Shadow recipes, acquired twins, aliases, shims, lock
publication, and substitution reporting remain absent from this unit.

The existing linker stays the sole package-file and package-bin module. The
small package-private phased surface required by the installer composes under
the existing public `link()`; no second writer, comparator, plan object,
scheduler, lock owner, or public API ships.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command ownership is reify-history-sensitive. It does not justify a
  static comparator.
- ADR-0335 therefore assigns npm reify the complete collision lifecycle.
  Until that outside-goal authority lands, current/prior ambiguity is exactly
  `NotImplementedError('npm-client.bin-collision-reify')` + compat ❌.

## Acceptance

- Normalize every supported string/object package bin into `(node_modules
  scope, command, visible package owner, target)` once. Preflight returns that
  shaped current-claim list to the bin pass. Equal command text in different
  scopes remains independent; two current owners in one scope reject before
  any VFS mutation, independent of input order.
- Given authoritative prior package-bin facts, a recorded prior collision or a
  prior-to-current owner transition/removal that needs npm reify history
  rejects with `NotImplementedError('npm-client.bin-collision-reify')`. An
  unchanged sole owner remains admissible even when its target changes. No
  lexical, manifest-order, or last-writer winner is inferred.
- One package-private phased linker surface lets the installer settle all
  package files before invoking exactly one package-bin pass. Public `link()`
  composes preflight, package-file settlement, then that same bin pass and
  retains its current public shape.
- The sole bin pass consumes preflight's normalized claims without reshaping,
  verifies each target, checks abort between reachable operations, and writes
  the exact launcher. Every raw-package linker ingress rejects invalid install
  paths before VFS mutation; the detached bin phase accepts preflight claims
  only. Escaping or missing targets and
  `ENOSPC` / `EACCES` stay loud; exact retry uses the same writer.
- The public compat matrix records same-command package-bin settlement as ❌
  with the exact named ceiling. Existing non-colliding package linking stays
  green.

## Parity cases

1. Opposite current package orders in one root or nested scope reject before
   package files or launchers; independent root/nested scopes both link.
2. A prior collision rejects even when the desired tree has one claimant; a
   different or removed prior sole owner also rejects before writes.
3. One unchanged owner links byte-identically through public `link()` and the
   package-private phased surface.
4. Missing target, abort, `ENOSPC`, and `EACCES` stay loud at the shared bin
   pass; retry lands the exact launcher once.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | current/prior ambiguity rejects before VFS mutation; no static npm winner is invented | packed npm probe plus opposite-order/prior-state table |
| corrupt-input | invalid install path and escaping/missing target reject without a launcher | direct shared-linker target table |
| torn-state | abort stops later bin work; retry reconciles through the same writer | root/nested phased-linker ledger |
| quota-perm-fail | bin `ENOSPC` / `EACCES` remains loud and retryable | direct shared-linker write table |
| sibling-drift | public `link()` and installer-facing phases call one normalization/preflight/bin implementation | public/phased equivalence plus finite source gate |

## Out of scope

- Recipe materialization, acquired-twin suppression, registry aliases,
  internals shims, package-lock construction, substitution reports, and their
  end-to-end order; `npm-client/shadow-materialized-bin-commit-authority` owns
  them.
- Implementing npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link collision
  settlement. `npm-client/npm-11-bin-reify-authority` owns that outside-goal
  work; this unit keeps the named loud ceiling.
- A new public linker API, second bin writer, comparator helper, coordinator,
  scheduler, lock, or package-specific branch.

## Decisions

- Contract+RED @
  `83ea4bf28e880eaf6c581de69731548860c318a5` blocked: prove shaped-claim
  identity and one shared bin pass across every linker entrypoint, execute
  stable-owner target changes through the returned current claims, cover
  absolute/traversal install paths plus the installer safety sibling before
  mutation, and retain only this selected JIT Items/Budget mapping; one lawful
  re-cut remains.
- `split-predecessor:
  9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`; predecessor checkpoints:
  `4c5b583620eebb962b1ea11f355cb5f64c4aa4b8` and
  `9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`.
- ADR-0335 and the npm oracle settle the behavior fork: ambiguous claims throw;
  this unit ships no approximation of npm's reify lifecycle.
- The existing linker is the deep module. Its package-private phased surface
  is the minimum seam needed by the serial shadow commit successor.
