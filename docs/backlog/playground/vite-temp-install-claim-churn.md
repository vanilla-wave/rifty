---
area: playground
status: draft
title: Install trust survives extraneous node_modules writes (re-scoped oracle)
created: 2026-07-16
why: live Vite repeatedly writes node_modules/.vite-temp after npm install; today any such write revokes the whole-tree claim, marks a fresh Scratch UNSAVED, and forces the next reopen to reacquire an otherwise usable tree — surveillance real npm does not perform (ADR-0307 probe)
user_story: As a playground user, I want an untouched Vite project to stay visibly clean and switching back to remain fast and offline-capable, without weakening dependency-tree trust below real npm's bar.
epic: honest-shadow-substitutions
sources: [M11, ADR-0261, ADR-0307, Vite-v8.0.16]
code: [apps/playground/src/glue/install-stamp.ts, apps/playground/src/glue/install-stamp-authority.ts, apps/playground/src/glue/package-mutation-executor.ts]
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

## Readiness blocker

The production Save path copies Scratch to the named-project root with
`copyClaims: false`, then `openProject()` runs acquisition against that new
root. Chromium proof found a second snapshot acquisition during Save before
the already-green B→A return. This violates the unchanged Acceptance below and
epic invariant 5 even though `.vite-temp` itself no longer revokes trust.

ADR-0261 currently requires Save to exclude claims and lets only ordinary
destination acquisition mint trust. The frozen outcome instead requires Save
to preserve the exact installed bytes with zero acquisition. Before this item
can return to `ready`, a superseding ADR must resolve how Save can establish
destination trust without acquisition, pin crash and rollback order, and add a
Save-inclusive Chromium RED. The pre-demotion `## Acceptance` and
`## Parity cases` are retained verbatim below.

## User scenario

On a fresh Chromium profile, a user opens the Vite Starter, waits for install
and LIVE preview, and makes no edit. Scratch remains clean. They switch to a
second Starter, disable registry/snapshot network, and switch back. The Vite
project reuses its exact installed dependency tree and reaches LIVE without a
second acquisition.

## Acceptance

- RED first on current main: the churn scenario (a `vite` run's
  `node_modules/.vite-temp` write demotes/revokes trust) fails before the fix;
  the guard is revert-checked (reverting the predicate change makes it fail
  again).
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
- Delete-on-done when every branch above is proven. The oracle-slice PR owns
  the churn/trust/lockfile branches; the A→B→A offline browser proof may need
  its own slice (Playground save/switch re-materializes `node_modules` today —
  if that empirically blocks UI-level reuse, the branch returns to refine
  rather than being narrated away).

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

## Fault matrix

Boundary: Storage (OPFS) per `fault-classes.md` §Boundary failure models; the
predicate change adds no new writer or mechanism. ADR-0261 rows stand; delta
rows:

| Fault | Required outcome |
|---|---|
| `provenance-lie` × extraneous write while pending | Non-installer writes cannot promote or refresh a claim; only the serialized authority mints trust. |
| `stale-state` × lockfile edited after promotion | At-open hash compare misses; no trusted reuse over a drifted request. |
| `torn-state` × crash between mutate and promote | Pending claim never satisfies reuse; reopen reinstalls (unchanged ADR-0261 row, re-asserted against the new predicate). |
| `quota-perm-fail` × flush during promote | No promotion; miss on reopen (unchanged, re-asserted). |

## Out of scope

- Content-hash verification of tree bytes between installs — permanently out,
  matching Node (ADR-0307); not a deferred feature.
- Scratch-dirty semantics for ordinary project files outside `node_modules` —
  unchanged; editing a project file still marks Scratch dirty.
- The disposable Vite config cache and its capability machinery — dead per
  ADR-0307, never built on main.
- Snapshot/archive claim-transfer rules — unchanged ADR-0261 surface.

## Decisions

- ADR-0307 owns the predicate re-scope and the probe evidence; ADR-0261
  remains active for everything else.
- Lockfile hash lands as a v4-shaped claim field in the same slice (schema
  fork resolved there, no separate migration item; v3 claims miss once).
- Scratch-dirty declassification for non-installer `node_modules` writes rides
  the same predicate change (same classification site), not a separate item.
