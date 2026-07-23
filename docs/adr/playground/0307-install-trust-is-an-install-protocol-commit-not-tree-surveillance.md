# ADR 0307: Install trust is an install-protocol commit, not tree surveillance

Status: Accepted
Date: 2026-07

> TL;DR: an install claim is invalidated only by installer-protocol events
> (demote → mutate → flush → promote with read-back) and by package.json /
> lockfile comparison at open; extraneous writes into `node_modules` never
> invalidate trust — matching real npm, which performs no tree-byte
> surveillance at any point.

## Context

Supersedes ADR-0261 ONLY for its uncoordinated-mutation invalidation clause
("no path whitelist or trust publication over a tree changed after promotion",
enforced today by classifying every `node_modules` write as tree damage —
`package-mutation-executor.ts` maps any path under the tree to revoke). Every
other ADR-0261 clause stands unchanged: root-bound v3 claims, non-transferable
reserved claim ingress, one serialized authority per root, durable promotion
through the full persistence ledger, background command durability, learned-pin
SWR.

The current oracle is over-broad. RED on main: `docs/backlog/playground/
vite-temp-install-claim-churn.md` — Vite's bundle config loader writes
`node_modules/.vite-temp/vite.config.*.timestamp-*.mjs`, the whole-tree claim
revokes, a fresh Scratch goes UNSAVED, and A→B→A reopen re-acquires a perfectly
usable tree. Downstream, that single classification decision spawned an entire
containment cascade on the #160 quarry branch: config-cache redirect, client
overlay FS, an 11-method wire protocol, exact ESM lexical binding,
version-pinned patch policy (quarry ADR-0301/0302) — machinery guarding against
a fault real Node does not consider a fault.

Probe against real npm 11.17.0 / Node v24.16.0 (2026-07-23, fresh project,
`ms@2.1.3`):

- extraneous writes (`node_modules/.vite-temp/*.mjs`, extra file inside an
  installed package) → `npm install` reports "up to date", removes nothing,
  invalidates nothing;
- tampered installed-package bytes → `node` runs the tampered bytes;
  `npm install` with an unchanged manifest/lockfile does not detect or repair
  them;
- deleted package directory → restored by the next `npm install` from the
  lockfile; extraneous files still untouched.

So npm's real trust boundary is: manifest/lockfile comparison + tree
reconciliation at INSTALL time, its own write protocol while installing, and
nothing at run time — Node executes whatever is on disk. Whole-tree identity
between installs is surveillance real Node does not perform; rifty performing
it is an infidelity, not extra safety.

## Decision

- A trusted claim is affected by exactly two kinds of events:
  1. **Installer-protocol events** — every acquisition mutation that can leave
     the tree still starts with `demote` and ends with ledger-proven `promote`
     (ADR-0261 commit protocol, unchanged). Nested-cwd installs still demote
     the ancestor claim before mutating under its tree: an installer event, not
     surveillance. Quota/flush failure still refuses promotion.
  2. **Request-identity drift at open** — exact `package.json` text (already in
     the v3 claim) and the stored lockfile hash compare at claim check; a
     mismatch is a miss that runs real arrival.
- Writes into `node_modules` by anything that is not the installer protocol —
  guest fs, tools writing temp/cache files, terminal commands, package code at
  run time — neither demote, revoke, nor dirty the claim. The reserved claim
  path (`node_modules/.rifty-install-stamp.json`) keeps its full ADR-0261
  ingress protection; it is authority metadata, not tree bytes.
- Consequences match Node exactly: a user who deletes an installed package
  keeps trust, and the next `require` fails the same way it fails on Node; the
  next explicit install reconciles. Trust means "this tree was produced by a
  proven install for this request", never "these bytes are still pristine" —
  a claim ADR-0261 already disclaimed ("not a `node_modules` content hash").
- Storage-boundary honesty is untouched: OPFS durability proof at promotion,
  torn multi-step state, cross-tab writers, and the origin-wide Workbench Web
  Lock remain exactly as decided.

## Series gates (probe PASSED)

- The Vite temp-cache cluster (quarry redirect / overlay FS / 11-method wire /
  exact ESM binding / patch policy, quarry ADR-0301 + ADR-0302) is not adopted;
  those quarry ADRs are dead and the conditional temp-cache slice of the
  delivery series is dropped. Vite writes temp modules to the real VFS exactly
  as on Node.
- Whole-tree epoch/identity machinery loses its reason to exist outside the
  installer protocol; the package-tree authority (ADR-0309) consolidates FIFO +
  commit protocol only, with no tree-epoch surveillance.
- Nested-cwd installs lose their global-epoch failure mode (the #160 confirmed
  blocker class): ancestry effects are scoped to the installer event.

## Consequences

- (+) Running `vite` (or any tool that writes into `node_modules`) no longer
  demotes install trust or dirties a fresh Scratch; A→B→A reopen reuses the
  tree offline.
- (+) Deletes the containment cascade instead of hardening it; fewer state
  owners, fewer coordination mechanisms.
- (−) Uncoordinated corruption of tree bytes is no longer detected between
  installs — exactly as on Node; the durability ledger still catches storage
  faults at promotion time.
- Follow-up: the claim gains a lockfile hash for the at-open compare (v4-shaped
  field); the oracle slice owns that change with RED/GREEN on the claim-churn
  scenario.
