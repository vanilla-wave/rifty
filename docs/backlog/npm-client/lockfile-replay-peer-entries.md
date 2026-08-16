---
area: npm-client
status: ready
title: Lockfile replay traverses peerDependencies when the lock pins the entry
created: 2026-08-16
why: npm ≥7 auto-installs peers and records them as root lock entries reachable only via peerDependencies; the replay walk never reads that map, so entries present in the lock silently never reach the tree (issue #261)
user_story: As an SDK embedder seeding an npm-authored lock for @weavix/tracker-plugin-sdk, I want all six lock packages materialized, but today one of six installs, `vite build` still succeeds (bare specifier left external), and the plugin dies at first page load on "Failed to resolve module specifier"
epic: faithful-npm-lock-replay
blocked_by: []
sources: ["https://github.com/vanilla-wave/rifty/issues/261"]
code:
  - packages/npm-client/src/installer.ts
---

## Context

`walkAndPin.visit` recurses over `pin.dependencies` (`installer.ts:2296`) and
`pin.optionalDependencies` (`:2305`) only. `pin.peerDependencies` rides on
every lockfile-origin pin (`installer.ts:2773`, persisted per D-F) but feeds
nothing except the presence-only `warnUnsatisfiedPeers` pass
(`installer.ts:3054`). npm records auto-installed peers as ordinary root
entries that NO `dependencies` map lists — a reachability walk cannot see
them. `frozen-assumption`: only rifty-authored locks (whose trees rifty
resolved itself) are fully reachable.

Mechanics for the implementing agent — replay-only, no resolution decisions:

- Extend `ResolutionSource` with an optional
  `hasLockEntry(name: string, ctx: ResolveContext): boolean`; lockfile source
  implements via the existing `pinnedEntryForParent` walk-up (same lookup
  `resolve` uses at `installer.ts:2685`); live source omits it. This keeps
  `EBROKENLOCK missing-entry` semantics of `resolve` untouched and gives the
  walk a side-effect-free presence probe. (Carrier choice — an equivalent
  seam is acceptable if it neither weakens EBROKENLOCK nor touches the live
  path.)
- In `visit`, after the optional loop (`:2305-2315`) and before companions
  (`:2320`): when `pin.origin === 'lockfile'`, for each
  `[peerName, peerRange]` of `pin.peerDependencies ?? {}` — if
  `source.hasLockEntry?.(peerName, childContext)` → `await visit(peerName,
  peerRange, childContext, optional)` (inherit the `optional` descriptor like
  required children do: peers of an optional subtree are optional-demand);
  else skip silently — an absent peer entry means npm decided it isn't
  installed, and live peer RESOLUTION is owned by
  `npm-client/npm-11-peer-placement-authority`, not here.
- Cycles (react ↔ react-dom peer react) terminate via the existing `scheduled`
  install-path dedup (`installer.ts:2216-2228`) — no visited-set needed; do
  not add one.
- Do NOT range-check `peerRange` against the pinned version on replay — npm
  already resolved; `warnUnsatisfiedPeers` keeps reporting genuine mismatches.
- Placement is untouched: lockfile pins carry `installPath` from the entry key;
  peer-reached entries land exactly where npm recorded them.
- `peerDependenciesMeta.optional` is irrelevant here by construction: presence
  in the lock decides; the meta map is never read.
- Record nothing new for skips: an absent peer entry is not an "unreached lock
  entry" (there is no entry) — the gate item needs no data from this path.
- rifty-authored locks: every entry is already dependency-reachable, so
  `hasLockEntry` hits are all `scheduled`-deduped no-ops; pin with a
  regression test (tree + lockfile bytes unchanged).

## User scenario

Issue #261 repro (observed 2026-08-16; npm version pin lands with the pickup
probe): `package.json` with
`dependencies: { "@weavix/tracker-plugin-sdk": "0.0.33" }`;
`npm install --package-lock-only --ignore-scripts` writes a 6-package lock
(`@weavix/sdk-core`, `@weavix/tracker-api-plugin`, `@weavix/tracker-api-types`,
`@weavix/tracker-core`, `@weavix/tracker-plugin-sdk`, `valibot`) — the SDK
declares three of them as `peerDependencies` and imports them from
`dist/index.mjs`. Seed into `install({ vfs, cwd, registry })`: today 1 of 6
installs, three `peer dependency … required but not installed` warnings print,
and the page dies at load on `Failed to resolve module specifier
"@weavix/tracker-api-plugin"`. Expected: 6/6 materialize, those warnings
disappear, the SDK module loads.

## Acceptance

- Replaying an npm-authored lock materializes every entry reachable via
  dependencies ∪ admissible optionals ∪ lock-pinned peers; the #261 fixture
  yields 6/6 with `import` of the SDK entrypoint succeeding in the runtime.
- `warnUnsatisfiedPeers` no longer fires for peers the lock pins (they are
  installed); still fires for peers absent from the lock.
- Live-resolve installs (no lockfile): zero behavior change — proven by the
  existing live suites plus one explicit no-lockfile peer-warn case.
- rifty-authored lock replay: tree + lockfile bytes unchanged vs main.
- A fake (post-install presence assertion without the real install core and
  registry/tarball/VFS boundaries) cannot close this.

## Reference contract

- Oracle: npm 11.17.0 on Node 24.16.0 — pinned by the committed loopback-
  registry probe `docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe.md`;
  #261 outputs above remain the real-package motivation.
- Mechanism: npm arborist — peers are physical lock entries; replay installs
  them like any entry.

## Parity cases

1. Direct dep with lock-pinned peers (#261 shape): all entries materialize at
   their recorded paths; peer warnings gone.
2. Peer chain (peer's own peers pinned in lock): transitive closure
   materializes.
3. Peer cycle (a ⇄ b via peerDependencies, both pinned): terminates, both
   installed once.
4. Peer absent from lock (vite → sass/less/terser shape): skipped silently by
   the walk; `warnUnsatisfiedPeers` line preserved verbatim.
5. Peer entry also required elsewhere: installed once, no demand downgrade
   (required wins over optional-inherited).
6. Peer reached under an optional boundary whose acquisition fails: whole
   optional subtree skipped, peer not orphan-pinned.
7. rifty-authored lock: bytes unchanged vs main.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption | replay compared against committed npm oracle tree/lock, not rifty's writer | differential fixture from the pickup probe |
| corrupt-input | malformed entry `peerDependencies` (non-object) → loud `EBROKENLOCK malformed-entry` | lock mutation table |
| torn-state | peer acquisition failure on a required-demand path aborts loudly, claims rolled back, no partial success/lock write | acquisition fault test |
| provenance-lie | install success implies every lock-pinned peer materialized; no success + missing-peer combination for pinned peers | acceptance differential |
| sibling-drift | one presence lookup (`pinnedEntryForParent`) serves resolve and hasLockEntry — no second walk-up copy | code-level assertion in review + shared helper |

## Out of scope

- Live-path peer RESOLUTION, placement, `ERESOLVE` conflicts, `peer: true`
  lock provenance — `npm-client/npm-11-peer-placement-authority` owns them;
  this item must not touch live resolution.
- `peerDependenciesMeta`, `--legacy-peer-deps`, workspaces/`link:` peers — the
  authority item's Out of scope list and its `NotImplementedError` codes stand.
- Installing peers absent from the lock (that IS resolution) — skip + existing
  warning.
- Post-walk unreached-entry validation — `lockfile-replay-unreached-entry-gate`.

## Decisions

- ready-verdict: 2026-08-17 — Contract+RED @ 1ce0fd6cc97a8543c880db3fb77eacabd74e5866
- Presence-in-lock is the sole trigger: replay makes no version/placement
  decisions, so this item cannot conflict with the future live peer authority —
  when that lands, its locks replay through this same path.
- Peer edges inherit the current `optional` descriptor (never introduce
  required demand from inside an optional subtree).
- No new coordination mechanism; termination via existing `scheduled` dedup.
- Cross-link recorded in `npm-11-peer-placement-authority` §Context (one line,
  same PR).
- Evidence gap, blocks `ready`: #261 outputs lack a pinned npm/Node version —
  pickup commits the loopback probe artifact first (§Backlog readiness 4).
