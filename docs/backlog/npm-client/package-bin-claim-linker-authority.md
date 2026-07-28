---
area: npm-client
status: draft
title: Package-bin claim and phased-linker authority
created: 2026-07-28
why: the terminal package-bin linker RED proved path admission and command ownership are separate units, while current linking still mutates files before discovering ambiguous command claims
user_story: As a browser-IDE user installing packages with CLIs, I want one linker to reject command ownership it cannot settle like npm before changing the tree, then write each exact launcher after all package files settle
epic: honest-shadow-substitutions
blocked_by: [npm-client/resolved-package-install-path-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This is the second split successor to terminal
`npm-client/package-bin-linker-authority` at
`8e1456665a3d7a77425b5afa8f0c802ac59162b5`. It starts after
`npm-client/resolved-package-install-path-authority` lands and accepts only
that predecessor's prepared packages. Shadow recipe claims, acquired twins,
aliases, internals shims, lock publication, and reporting remain absent.

The existing linker remains the sole package-file and package-bin module. This
unit extracts its minimum package-private phases; it adds no module, public
API, comparator, scheduler, lock, or package-specific branch.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command ownership is reify-history-sensitive, not a static comparator.
- ADR-0335 assigns that lifecycle to npm reify. Current or authoritative-prior
  ambiguity remains exactly
  `NotImplementedError('npm-client.bin-collision-reify')` + compat ❌.
- The install-path predecessor supplies exact
  `(package, relativePath, nodeModulesDir)` entries. No phase here accepts raw
  `ResolvedPackage.installPath`.

## Acceptance

- Normalize every supported string/object bin once from prepared packages into
  `(nodeModulesDir, command, visible owner, target)` claims. Equal command text
  in different scopes remains independent; two current owners in one scope
  reject before VFS mutation in either input order.
- A recorded prior collision, owner transition, or removal requiring npm reify
  history rejects with the named ceiling. An unchanged sole owner remains
  admissible when its target changes; the returned claim always names the
  current target.
- One composer runs install-path preparation, bin preflight, all package-file
  settlement, then exactly one detached bin pass. Public `link()` and
  `linkInstallTree()` use it; file/bin phases consume prepared packages or
  shaped claims and never reread raw path/bin data.
- The bin pass validates each target, checks abort between reachable
  operations, and writes the exact launcher. Escaping/missing targets and
  `ENOSPC` / `EACCES` remain loud; exact retry uses the same writer.
- New preflight/file phase ingress repeats the predecessor's safe-relative
  wrong-suffix integration proof through the prepared boundary. It cannot
  weaken or duplicate raw path validation.
- The public compat matrix records same-command package-bin settlement as ❌
  with the exact named ceiling. Existing non-colliding linking stays green.

## Parity cases

1. Opposite current orders in root and nested scopes reject before files or
   launchers; independent scopes both link.
2. Prior collision, transition, and removal reject; stable owners link only
   current string/object targets.
3. Public and installer entrypoints use one prepare/preflight/files/bins
   topology and one normalization/bin writer.
4. Missing target, root/nested abort, `ENOSPC`, and `EACCES` stay loud and
   retry lands the exact launcher.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | current/prior ambiguity rejects before VFS mutation; no static npm winner | packed npm probe plus order/prior table |
| corrupt-input | prepared path boundary and escaping/missing target reject without launcher | predecessor integration plus target table |
| torn-state | abort stops later bin work; retry reconciles through one writer | root/nested phase ledger |
| quota-perm-fail | bin `ENOSPC` / `EACCES` stays loud and retryable | launcher write table |
| sibling-drift | public/install entrypoints call one composer; phases accept only prepared packages/claims | finite topology and poisoned-raw sentinels |

## Out of scope

- Raw install-path grammar; the predecessor owns it.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock,
  reports, and their order;
  `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `split-predecessor:
  8e1456665a3d7a77425b5afa8f0c802ac59162b5`; predecessor checkpoints:
  `83ea4bf28e880eaf6c581de69731548860c318a5` and
  `8e1456665a3d7a77425b5afa8f0c802ac59162b5`.
- The install-path successor must land first. This unit restores only the
  terminal checkpoint's claim/phase REDs atop its prepared carrier.
- ADR-0335 and the npm oracle settle the fork: ambiguity throws; no comparator
  or plausible winner ships.
