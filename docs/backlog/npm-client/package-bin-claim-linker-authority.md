---
area: npm-client
status: draft
title: Package-bin claim and phased-linker authority
created: 2026-07-28
why: the terminal package-bin linker RED proved path admission and command ownership are separate units, while current linking still mutates files before discovering ambiguous command claims
user_story: As a browser-IDE user installing packages with CLIs, I want one linker to reject command ownership it cannot settle like npm before changing the tree, then write each exact launcher after all package files settle
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-bin-phased-linker-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - docs/public/compat/package-tooling.md
---

## Context

This was the second split successor to terminal
`npm-client/package-bin-linker-authority` at
`8e1456665a3d7a77425b5afa8f0c802ac59162b5`. Its second Contract+RED
checkpoint separated claim preflight from detached file/bin settlement. This
item is now a terminal blocked split predecessor.

It started after
`npm-client/resolved-package-linker-path-authority` and the re-refined
`npm-client/resolved-package-installer-prepared-path-consumption` had landed and
accepted only their shared prepared packages. Shadow recipe claims, acquired
twins, aliases, internals shims, lock publication, and reporting remain absent.

`npm-client/package-bin-claim-preflight-authority` now owns normalization,
narrow current/prior ingress, the pre-mutation ambiguity ceiling, escaping
target admission, and exact compat ❌. Then
`npm-client/package-bin-phased-linker-authority` owns detached file/bin
settlement and its VFS fault surface. Both retain the existing linker as the
sole module; neither adds a public API, mechanism, or package-specific branch.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command ownership is reify-history-sensitive, not a static comparator.
- ADR-0335 assigns that lifecycle to npm reify. Current or authoritative-prior
  ambiguity remains exactly
  `NotImplementedError('npm-client.bin-collision-reify')` + compat ❌.
- The install-path successors supply exact current
  `(package, relativePath, nodeModulesDir)` entries. Bin preflight narrows
  current and authoritative-prior input to package-private
  `(package.name/bin, nodeModulesDir)` sources, so prior lock evidence need not
  invent package files. No phase here accepts raw `ResolvedPackage.installPath`.

## Acceptance

- Normalize every supported string/object bin once from prepared bin sources
  into `(nodeModulesDir, command, visible owner, target)` claims. Equal command
  text in different scopes remains independent; two current owners in one
  scope reject before VFS mutation in either input order.
- A recorded prior collision, owner transition, or removal requiring npm reify
  history rejects with the named ceiling. An unchanged sole owner remains
  admissible when its target changes; the returned claim always names the
  current target.
- Raw `link()` and `linkInstallTree()` each prepare install paths once before
  entering the shared prepared linking path; real `install()` reuses its
  already-prepared carrier. That path runs bin preflight, all package-file
  settlement, then exactly one detached bin pass. File/bin phases consume
  prepared file packages, narrow bin sources, or shaped claims and never
  reread raw path/bin data.
- The bin pass validates each target, checks abort between reachable
  operations, and writes the exact launcher. Escaping/missing targets and
  `ENOSPC` / `EACCES` remain loud; exact retry uses the same writer.
- The inherited public/installer suite retains the predecessor's safe-relative
  wrong-suffix proof before the prepared boundary. New phases accept no raw
  packages and cannot weaken or duplicate path validation.
- The public compat matrix records same-command package-bin settlement as ❌
  with the exact named ceiling. Existing non-colliding linking stays green.

## Parity cases

1. Opposite current orders in root and nested scopes reject before files or
   launchers; independent scopes both link.
2. Prior collision, transition, and removal reject; stable owners link only
   current string/object targets.
3. Raw public entrypoints prepare once; public and already-prepared installer
   paths then share the same bin-preflight/files/bins behavior and
   normalization/bin writer.
4. Missing target, root/nested abort, `ENOSPC`, and `EACCES` stay loud and
   retry lands the exact launcher.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | current/prior ambiguity rejects before VFS mutation; no static npm winner | packed npm probe plus order/prior table |
| corrupt-input | prepared path boundary and escaping/missing target reject without launcher | predecessor integration plus target table |
| torn-state | abort stops later bin work; retry reconciles through one writer | root/nested phase ledger |
| quota-perm-fail | bin `ENOSPC` / `EACCES` stays loud and retryable | launcher write table |
| sibling-drift | raw/public/prepared/direct-phase ledgers diverge or a phase accepts/rereads raw packages | equivalent operation ledgers plus type/read-count sentinels |
| provenance-lie | same-command settlement is claimed supported or names another ceiling | structured public compat row |

## Out of scope

- Raw install-path grammar and installer ingress; the two predecessors own
  them.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock,
  reports, and their order;
  `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `terminal-checkpoint:
  30416e72eea35cd992ef87f62b951d6c70eb45fb` — second Contract+RED BLOCKED.
- `checkpoint-lineage: [e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed,
  30416e72eea35cd992ef87f62b951d6c70eb45fb]`.
- `split-successors: [npm-client/package-bin-claim-preflight-authority,
  npm-client/package-bin-phased-linker-authority]`.
- Contract+RED @ `e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed`
  blocked exactly: forbidden source inspection, incomplete
  abort/narrow/prior/compat.
- Contract+RED @ `30416e72eea35cd992ef87f62b951d6c70eb45fb`
  blocked exactly: prepared ordering false-green, missing positive narrow type
  proof, unguarded compat row, final-state-only zero-mutation proof.
- The first successor owns only claim shaping and the zero-mutation ceiling.
  The serial second successor owns file/bin ordering and VFS faults. Each gets a
  fresh Contract+RED → Final+GREEN lineage; this terminal carrier is not
  re-reviewed.
- `split-predecessor:
  8e1456665a3d7a77425b5afa8f0c802ac59162b5`; predecessor checkpoints:
  `83ea4bf28e880eaf6c581de69731548860c318a5` and
  `8e1456665a3d7a77425b5afa8f0c802ac59162b5`.
- Both serial install-path successors must land first. This unit restores only
  the terminal checkpoint's claim/phase REDs atop their shared prepared
  carrier.
- PR #215 settled the internal topology: raw linker entrypoints prepare once,
  while real install already owns and reuses that carrier. The shared prepared
  path therefore begins at bin preflight; no second raw-path pass is added.
  Exact helper names/call graph are not contract.
- Authoritative prior carries only package name/bin plus scope. A narrow
  package-private bin source prevents fake `files` while letting current
  prepared packages enter the same normalizer structurally.
- ADR-0335 and the npm oracle settle the fork: ambiguity throws; no comparator
  or plausible winner ships.
