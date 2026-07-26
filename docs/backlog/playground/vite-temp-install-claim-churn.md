---
area: playground
status: draft
title: Vite install trust survives extraneous writes and project Save
created: 2026-07-16
why: Vite's extraneous node_modules writes no longer revoke trust, but Scratch→named Save still strips the root-bound claim and reacquires an otherwise exact installed tree
user_story: As a playground user, I want an untouched Vite project to stay visibly clean and switching back to remain fast and offline-capable, without weakening dependency-tree trust below real npm's bar.
epic: honest-shadow-substitutions
sources:
  - M11
  - ADR-0261
  - ADR-0307
  - ADR-0329
  - Vite-v7.3.6
  - docs/backlog/playground/reference/npm-11-extraneous-node-modules-probe.md
  - docs/backlog/playground/reference/vite-save-acquisition-probe.md
code:
  - packages/workbench/src/glue/install-stamp-authority.ts
  - packages/workbench/src/glue/package-mutation-executor.ts
  - packages/workbench/src/workers/package-acquisition-authority.ts
  - packages/workbench/src/workers/playground-project-authority.ts
  - tests/e2e/vite-temp-trust-churn.spec.ts
---

## Context

Re-refined under ADR-0307 (supersedes this item's previous disposable-cache
contract; that carrier — owner-private cache, admission capability, chunked
protocol — is dead, not deferred). The oracle: trust is affected only by
installer-protocol events (demote → mutate → flush → promote) and by
package.json/lockfile comparison at open; extraneous writes into
`node_modules` never invalidate — exactly real npm (probe evidence in
ADR-0307). Vite stays byte-unmodified and writes its temp config modules to
the real VFS as on Node.

## Recut evidence

The production Save path copies Scratch to the named-project root with
`copyClaims: false`, then `openProject()` runs acquisition against that new
root. Chromium proof found a second snapshot acquisition during Save before
the already-green B→A return. This violates the unchanged Acceptance below and
epic invariant 5 even though `.vite-temp` itself no longer revokes trust.

ADR-0261 requires Save to exclude claim bytes and lets only the destination
authority mint trust. ADR-0329 resolves the carrier without weakening either
rule: the existing package FIFO holds the destructive conversion, and the sole
install-stamp authority proves the copied target before minting a new
target-root/slug v4 claim. The pre-demotion `## Acceptance` and
`## Parity cases` remain below; this recut only adds the Save branch that their
browser outcome already required.

## Reference contract

- Parity 1–5: Node v24.16.0 / npm 11.17.0,
  `reference/npm-11-extraneous-node-modules-probe.md`; it records the exact
  commands, versions, hashes, and output for extraneous bytes, tampered bytes,
  and missing-package reconciliation.
- Vite consumer: the checked-in `vite` dependency snapshot pins Vite 7.3.6;
  Chromium executes that installed CLI and proves `.vite-temp` reachability.
- Parity 6 is Rifty's own project-lifecycle policy, not an npm behavior claim.
  Its reachable user action is Save Scratch as a named project; the
  reproducible `reference/vite-save-acquisition-probe.md` pins current-main
  acquisition/tree loss, and the Save-inclusive Chromium RED plus owner
  restart/fault suites are its acceptance proof.

## User scenario

On a fresh Chromium profile, a user opens the Vite Starter, waits for install
and LIVE preview, and makes no edit. Scratch remains clean. A previously warmed
named project B is available. They disable registry/snapshot acquisition, save
A as a named project, switch to B, and switch back. Both opens reuse their
exact installed dependency trees; A reaches LIVE without a second acquisition.

## Acceptance

- Landed `oracle-slice` RED/GREEN: before PR #166, a `vite` run's
  `node_modules/.vite-temp` write demoted/revoked trust; its guard was
  revert-checked, and remains required green coverage.
- Save-inclusive RED on current main: after trusted Vite Scratch A reaches
  LIVE, snapshot/registry routes are disabled and Save attempts a second
  snapshot acquisition for the new named root. The test also writes a unique
  ordinary `node_modules` marker before Save so a fresh replacement cannot
  masquerade as exact-tree reuse.
- Running installed Vite — config load writes and removes
  `node_modules/.vite-temp/vite.config.*.mjs` — neither demotes nor revokes
  the install claim and does not mark Scratch dirty. No cache, no Vite
  patching, no path whitelist: classification is by writer protocol
  (installer vs everything else), not by filename.
- Any non-installer write under `node_modules` (guest fs, terminal, package
  code at run time, including deleting an installed package directory) leaves
  trust intact; subsequent `require` of removed bytes fails exactly as on
  Node, and the next explicit install reconciles.
- Trust checks at open additionally compare the stored lockfile hash
  (v4-shaped claim field per ADR-0307); a package.json or lockfile mismatch is
  a miss that runs real arrival.
- Unchanged installer protocol: acquisition mutations still demote first and
  promote only through the full-ledger durability proof; quota/flush failure
  refuses promotion; nested `cd sub && npm install` still demotes the ancestor
  claim before mutating under its tree; the reserved claim path
  (`node_modules/.rifty-install-stamp.json`) keeps ADR-0261 EPERM-class
  ingress protection.
- Real-browser proof: fresh Vite open reaches LIVE with `scratch.dirty ===
  false`; A→B→A with acquisition network disabled performs zero
  install/snapshot/registry work and reaches LIVE.
- Save copies no reserved claim bytes. Under the existing package FIFO,
  ADR-0329 validates the trusted source root/slug/artifact/package/lock,
  durably copies the target, and mints a new target-root/slug v4 claim before
  the catalog pointer commits. A trusted-source proof failure rolls Save back;
  an already-untrusted source remains claim-free.
- The reachable untrusted-source Save branch performs no rebind: existing
  catalog crash/quota recovery yields either the original Scratch or the
  committed claim-free named target. Opening that target takes ordinary
  acquisition and fails loudly when its acquisition network is unavailable.
- Delete-on-done when every branch above is proven. Merged PR #166 owns the
  churn/trust/lockfile branches. Its retained condition occurred:
  Playground Save re-acquires `node_modules`; `save-trust-rebind` owns the
  Save-inclusive A→B→A browser branch without weakening the earlier proof.

## Parity cases

Oracle: real npm 11.x / Node v24.16.0 (ADR-0307 probe protocol).

1. Extraneous file under `node_modules` (`.vite-temp/*.mjs`, stray file inside
   an installed package) → reopen skips install, mirroring npm's "up to date"
   with an unchanged manifest/lockfile.
2. Installed package directory deleted → trust retained; `require` fails with
   the same error class as Node; next explicit `npm install` restores from the
   lockfile.
3. Tampered installed-package bytes → runtime executes them (Node runs what is
   on disk); no reinstall is triggered by reopen.
4. `package.json` dependency edit → demote/reinstall path (existing behavior
   preserved).
5. Lockfile bytes changed since the claim → miss at open, real arrival runs.
6. Authority-mediated Scratch→named Save copies ordinary dependency bytes but
   no claim, then publishes a new root-bound claim only after destination
   durability proof; raw/general copies remain untrusted.

## Fault matrix

Boundary: Storage (OPFS) per `fault-classes.md` §Boundary failure models; the
predicate change adds no new writer or mechanism. ADR-0261 rows stand; delta
rows:

| Fault | Required outcome |
|---|---|
| `provenance-lie` × extraneous write while pending | Non-installer writes cannot promote or refresh a claim; only the serialized authority mints trust. |
| `provenance-lie` × lockfile edited after promotion | At-open hash compare misses; no trusted reuse over a drifted request. |
| `torn-state` × crash between mutate and promote | Pending claim never satisfies reuse; reopen reinstalls (unchanged ADR-0261 row, re-asserted against the new predicate). |
| `quota-perm-fail` × flush during promote | No promotion; miss on reopen (unchanged, re-asserted). |
| `torn-state` × Save copy/rebind/pointer | Before pointer commit recovery retains trusted Scratch and removes target/claim; after commit it retains trusted target and removes Scratch. |
| `quota-perm-fail` × Save rebind | Target demote, proof, promotion, or pointer refusal rejects Save without changing source/catalog; retry may succeed. |
| `torn-state` / `quota-perm-fail` × untrusted-source Save | No target claim is attempted; existing catalog recovery selects the complete pre-pointer Scratch or post-pointer claim-free target, and later open runs ordinary acquisition. |
| `concurrent-same-key` × Save/install/child admission | Existing package FIFO orders the complete Save wholly before or after the other operation; no new serializer. |
| `lossy-aggregate` / `provenance-lie` × root re-key | Source root/slug/epoch never transfer; target claim is newly minted only from exact source and copied-target evidence. |
| `sibling-drift` × nested reserved claims | Copy excludes every claim; only the top target project root receives a new v4 claim. |

## Out of scope

- Content-hash verification of tree bytes between installs — permanently out,
  matching Node (ADR-0307); not a deferred feature.
- Scratch-dirty semantics for ordinary project files outside `node_modules` —
  unchanged; editing a project file still marks Scratch dirty.
- The disposable Vite config cache and its capability machinery — dead per
  ADR-0307, never built on main.
- Snapshot/archive claim-transfer rules — unchanged ADR-0261 surface.
- Raw project copies, exports, imports, snapshots, and cross-store transfers
  remain claim-free and require ordinary destination acquisition.

## Decisions

- ADR-0307 owns the predicate re-scope and the probe evidence; ADR-0261
  remains active for everything else.
- Lockfile hash lands as a v4-shaped claim field in the same slice (schema
  fork resolved there, no separate migration item; v3 claims miss once).
- Scratch-dirty declassification for non-installer `node_modules` writes rides
  the same predicate change (same classification site), not a separate item.
- ADR-0329 owns only destructive Scratch→named Save. One dedicated
  `project-save` operation rides the existing package FIFO and invokes a
  Save-specific method on the existing install-stamp authority; it adds no
  lock, FIFO, cache, epoch, ready-set clone, or state owner.
- The catalog pointer remains the transaction commit point. Target trust is a
  pre-commit proof; generic transfer semantics and archive/snapshot behavior do
  not change.
- `save-trust-rebind` is the successor unit split from the incomplete
  Save-inclusive branch retained by merged PR #166 (`oracle-slice`); its source
  PR names that predecessor and carries its own two checkpoints.
