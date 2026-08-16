---
area: npm-client
status: ready
title: Replay refuses locks with entries no traversal edge reaches
created: 2026-08-16
why: class-kill chokepoint for the frozen-assumption family behind #254/#261 — any future lock edge type the walk does not read must fail loudly at install, never silently thin the tree
user_story: As a host seeding a lock rifty cannot fully replay, I want the install to fail naming the entries it would drop, but today the drop is silent and surfaces builds or page-loads later
epic: faithful-npm-lock-replay
blocked_by: [npm-client/lockfile-replay-optional-dependencies, npm-client/lockfile-replay-peer-entries]
sources: ["https://github.com/vanilla-wave/rifty/issues/261"]
code:
  - packages/npm-client/src/installer.ts
---

## Context

#254 and #261 are two instances of one class: the replay walk reads a subset of
the edges an npm-authored lock encodes, and whatever it misses drops silently.
The traversal items close the two known instances; this gate closes the CLASS:
after a lockfile-origin walk, every `lockfile.packages` key must be accounted
for — reached (pinned/scheduled), or recorded-skip (cpu-gated optional from the
optional-replay item, failed-optional warn-and-skip) — else the install fails
loudly before any success claim.

Mechanics for the implementing agent:

- Runs on the replay path only (`chooseSource` picked the lockfile source),
  after `walkAndPin` returns, before bin linking / lockfile rewrite / success.
- Accounting sets already exist or are cheap: `pinned`/`scheduled` install
  paths; the skip records the optional-replay item added; exclude the root `""`
  entry. Compare against `lockfile.packages` keys, normalized through the same
  `lockfilePathTranslations` the walk applies.
- Failure: `EBROKENLOCK` with `reason: 'unreached-entries'`, message listing
  count + up to ~20 paths (full list on the error object), advising delete
  lockfile + re-install. Follow the message pattern of the existing
  `EBROKENLOCK` throws (`installer.ts:2687-2692`).
- No partial state: the throw happens before lockfile rewrite and before any
  success/stamp publication; materialized files under `node_modules` may exist
  (same as any mid-install abort today) — no new rollback machinery.
- This is ONE validation at the existing lock trust boundary — not a new
  coordination mechanism. Per fault-classes §Class-kill, a future third edge
  type (workspaces, `link:`, bundled projections) lands as a traversal item
  plus a recorded-skip kind here; a silent bypass of this gate is the review
  blocker.

## User scenario

Hand-edit the #261 lock: add a valid extraneous entry (name+version+resolved+
integrity of any real package) that nothing references. `npm ci` would
materialize it verbatim; rifty install today silently omits it and succeeds.
Expected after this item: install fails with
`EBROKENLOCK: … unreached-entries … node_modules/<name> …` before claiming
success; deleting the lockfile and re-installing succeeds via live resolve.

## Acceptance

- The #254 and #261 fixture locks (post traversal items) replay with zero
  unreached entries — the gate is silent on every committed green fixture and
  on every rifty-authored lock in the repo's suites.
- An injected orphan entry fails the install loudly, names the path, publishes
  no lockfile rewrite and no success/readiness signal.
- cpu-skipped optionals and npm-dropped failed optionals do NOT trip the gate
  (recorded skips).
- A grep-style proof (asserting the error string exists in source) cannot close
  this; the proof drives the real install core.

## Parity cases

1. Green npm-authored lock (deps + optionals + peers): gate passes, zero cost
   visible.
2. Orphan extraneous entry: loud `EBROKENLOCK unreached-entries` naming it —
   RECORDED DIVERGENCE from `npm ci` (which materializes orphans verbatim);
   compat ❌, see Out of scope.
3. cpu-skipped optional binding: not reported unreached.
4. Entry reachable only through a failed-optional subtree (warn-and-skip):
   not reported unreached.
5. rifty-authored lock across existing suites: gate never fires.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption | walk coverage is validated against the lock itself every replay — future unread edge types cannot drop silently | orphan-entry fault test |
| provenance-lie | no success/lockfile-rewrite/readiness publication when entries went unreached | publication-order assertion in the fault test |
| lossy-aggregate | comparison is over exact normalized install-path sets, not counts | set-diff assertion; injected same-count swap fails |
| observable-order | gate fires after the walk completes, before bin linking and lock rewrite | write-ledger assertion |

## Out of scope

- Materializing parentless orphan entries (npm ci does; rifty refuses loudly) —
  compat ❌ documented in the message + compat matrix; revisit only with a
  verified real-world lock that legitimately carries orphans.
- Workspaces / `link:` / bundled edge traversal — future items; until then such
  locks fail HERE loudly instead of thinning silently.
- Any repair/pruning of the lock — the only advice is delete + re-install.

## Decisions

- ready-verdict: 2026-08-17 — Contract+RED @ 1ce0fd6cc97a8543c880db3fb77eacabd74e5866
- Loud throw chosen over warning: a warning line is exactly the drowned-out
  channel #261 documents (15 benign peer warnings hiding the fatal one); the
  mission bans silent thinning, and delete-lockfile is a always-available
  escape. Divergence from `npm ci` on orphan entries is recorded, not hidden.
- Gate placement post-walk (not ingress pre-walk): only the walk knows
  legitimate skips; an ingress schema check cannot distinguish them.
- Blocked by both traversal items — landing first would fail every
  npm-authored lock.
