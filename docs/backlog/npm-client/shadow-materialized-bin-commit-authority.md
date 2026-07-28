---
area: npm-client
status: draft
title: Shadow materialized-bin commit authority
created: 2026-07-28
why: the terminal materialized-bin RED proved acquired registry bins can leak and substitution success publishes before aliases, launchers, shims, or the lock have settled
user_story: As a browser-IDE user invoking a substituted package CLI, I want the exact materialized package to own its launcher only after one coherent install commit, but today a failed install can still report success
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-bin-linker-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/shadow-materialized-bin-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/shadow-shims.ts
  - packages/npm-client/src/linker.ts
---

## Context

This is the second split successor to terminal predecessor
`npm-client/shadow-materialized-bin-authority` at
`9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`. It starts after
`npm-client/package-bin-linker-authority` lands and consumes that sole
package-bin authority.

This unit owns exact recipe claims, acquired-twin suppression, installer phase
order, and commit-scoped substitution reporting. Exact registry acquisition,
embedded-bundle evidence, protocol-v2 trace, and offline replay remain in the
serial successor `npm-client/shadow-recipe-v2-acquisition-replay-authority`.

## Reference contract

- The completed schema-2 data authority strictly verifies each recipe's
  materialization bin map and target membership before this execution boundary.
- ADR-0335 assigns those exact claims to materialization and the shared linker,
  while ambiguous current/prior ownership stays the predecessor linker's named
  loud ceiling.

## Acceptance

- Recipe materialization contributes its exact user-visible bin map to the
  shared package-bin authority. Registry and synthetic recipes cross the same
  acquisition-independent seam; the current synthetic esbuild recipe
  materializes `bin/esbuild` and owns `.bin/esbuild`.
- Acquired registry-twin bins are removed before collision preflight, package
  linking, install results, and acquisition lock facts. Suppression follows
  applied recipe data, never a package-name branch; a sibling ordinary package
  with the same acquired command remains collision-free and owns its launcher.
- Invoke the shared current/prior preflight before project-tree mutation. Then
  settle all package files, registry aliases, exactly one shared package-bin
  pass, internals shims, and the package lock in that order.
- Stage every per-install redirect, materialization, and internals-patch line.
  Flush once, in existing order, only after the successful lock write. A failed
  attempt publishes no substitution line or result; exact retry reports each
  committed fact once.
- Missing materialized targets, abort, `ENOSPC`, and `EACCES` during reachable
  alias, bin, shim, or lock work stay loud and publish no report, result, or
  lock. Abort stops later reachable writes; retry reconciles exact
  materialized bytes and launcher through the one linker.
- Fresh and existing replay behavior materialize identical esbuild files and
  `.bin/esbuild`, with only the exact materialized lock bin. Invoking the
  unsupported CLI remains `NotImplementedError('esbuild.cli')`.
- Existing Workbench package operations retain the sole owner FIFO through the
  complete installer promise. This unit adds no npm-client scheduler.

## Parity cases

1. Fresh and replayed esbuild materialize identical `bin/esbuild` bytes and
   `.bin/esbuild`; lock publication precedes the one materialization report.
2. A registry acquisition advertising the trigger or a sibling command
   contributes no disk launcher, result bin, or acquisition lock bin.
3. Current/prior ambiguity rejects through the shared linker before package
   files, aliases, reports, or lock writes.
4. Root/nested alias abort stops after the parked write; alias, real recipe-bin,
   internals-shim, and lock `ENOSPC` / `EACCES` faults publish nothing.
5. Exact retry reconciles aliases and launcher and emits the ordered redirect,
   materialization, and internals lines once after commit.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | shared preflight precedes every project-tree effect; package files → aliases → one bin pass → shims → lock → reports | root/nested operation ledger |
| corrupt-input / provenance-lie | acquired bins are suppressed and missing materialized targets reject before launcher/report/lock | acquired-twin sibling plus real recipe target table |
| torn-state | alias/bin abort stops later writes and publishes no report/result/lock; retry reconciles exact bytes | synthetic and registry root/nested ledgers |
| quota-perm-fail | alias/bin/shim/lock `ENOSPC` or `EACCES` publishes no report/result/lock; retry reconciles | complete reachable write table |
| concurrent-same-key | supported Workbench callers remain physically excluded by the existing owner FIFO through installer settlement | inherited owner-FIFO suite; no npm-client scheduler |
| sibling-drift | registry and synthetic recipes feed the same linker and commit order; acquired twins leave before it | real install-core cases plus finite generic-source gate |

## Out of scope

- Exact registry projection, embedded-bundle extraction/lock, protocol-v2
  trace/replay, Workbench lock assertions, and Chromium v2 acceptance;
  `npm-client/shadow-recipe-v2-acquisition-replay-authority` owns them.
- Implementing npm same-command reify settlement; it remains
  `NotImplementedError('npm-client.bin-collision-reify')` + compat ❌ under
  `npm-client/npm-11-bin-reify-authority`.
- Broad dependency projection, peer traversal/placement, Sass, raw concurrent
  public `install()`, a public/custom recipe interface, a second reporter, or a
  second coordination owner.

## Decisions

- `split-predecessor:
  9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`; predecessor checkpoints:
  `4c5b583620eebb962b1ea11f355cb5f64c4aa4b8` and
  `9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`.
- Exact recipe and acquired-twin policy remain installer integration over the
  existing catalog and linker; this unit adds no codec, catalog, resolver,
  cache, lock, FIFO, or package-specific authority.
- The existing per-install reporter may stage lines but remains the sole
  provenance-report owner. Successful lock publication is its commit boundary.
