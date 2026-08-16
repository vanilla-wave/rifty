---
kind: epic
status: draft
title: Faithful npm-authored lockfile replay
created: 2026-08-16
value: A host seeding a package-lock.json written by real npm gets the same node_modules tree npm would build (minus loud cpu-gated natives) — never a silently thinner one discovered at first build or first page load
user_story: As an SDK embedder seeding an npm-authored lock into a rifty install, I want every lock entry to materialize or fail loudly, but today the replay walk silently drops optionalDependencies (wasm bindings — #254) and peer-only entries (#261), and the failure surfaces builds or page-loads later with a message blaming npm
tier: works
# goal_baseline: <ready-epic SHA; add alone, in a commit before the branch's first source commit>
---

## Outcome

The lockfile replay walk (`walkAndPin` + `createLockfileSource`,
`packages/npm-client/src/installer.ts`) stops assuming rifty-lock write-time
invariants that npm-authored locks do not have. Fault class:
`frozen-assumption` — "optionals folded at write, peers pre-warned" holds only
for locks rifty itself wrote. npm ≥7 keeps platform-conditional siblings under
entry `optionalDependencies` and records auto-installed peers as root entries
reachable ONLY via `peerDependencies`. After this epic:

1. optional entries replay through the existing optional-boundary machinery,
   cpu-gated by the same `assertNativeSupported` predicate (#254);
2. peer entries already present in the lock replay too — no resolution
   decision, the version is in the lock (#261);
3. a lock entry no traversal edge reaches fails the install loudly, naming the
   entries — the class-kill chokepoint for every future edge type (bundled,
   `link:`, workspaces) so nothing silently drops again.

No new coordination mechanism (no correlation/FIFO/epoch/ledger/lock): items 1–2
extend the existing source-agnostic walk + `scheduled` dedup + optional
warn-and-skip machinery; item 3 is one post-walk validation at the existing lock
trust boundary. Live-resolve behavior is untouched — live peer
resolution/placement stays owned by `npm-client/npm-11-peer-placement-authority`.

Origin: shipping `@riftydev/workbench@0.3.0` into Yandex Tracker's plugin
sandbox — GitHub issues #254, #261 (repro commands + observed outputs in both).

## User scenario

1. `npm install --package-lock-only --ignore-scripts` on a real host machine for
   a manifest with `vite@8.0.16` (devDep) and `@weavix/tracker-plugin-sdk@0.0.33`
   (dep) — npm 11 writes a v3 lock carrying `rolldown`'s 15 platform bindings as
   entry `optionalDependencies` and the SDK's three peers as root entries.
2. Seed manifest + lock into a rifty project; run
   `install({ vfs, cwd, registry })`.
3. Restored tree contains `node_modules/@rolldown/binding-wasm32-wasi` (+ its
   `@emnapi/*` deps) and all `@weavix/*` + `valibot` entries; native-only
   bindings are absent (cpu gate, warned).
4. `vite build` completes; the built page imports `@weavix/tracker-api-plugin`
   and loads.

## Invariants

<!-- Drafted at fit time from #254/#261 evidence; user signoff pending
     (`invariants-signoff:` in §Decisions). Each checked false on main
     2026-08-16: #254 repro → tree has rolldown + @rolldown/pluginutils only,
     build dies "Cannot find native binding"; #261 repro → 1 of 6 lock packages
     materializes, page load dies on bare specifier; unreached entries today
     drop silently (installer.ts:2775 hardcodes `optionalDependencies: {}`,
     walk never reads `pin.peerDependencies`). npm version pin for the oracle
     artifacts lands with the pickup probe (see items' Reference contract). -->

- I1. Replaying an npm-authored lock whose entries carry `optionalDependencies`
  materializes every cpu-admissible optional entry (wasm32/unrestricted) and
  skips cpu-excluded ones with a visible warning; the #254 vite repro then
  `vite build`s successfully.
- I2. Replaying an npm-authored lock with peer-only root entries materializes
  every entry reachable via dependencies ∪ admissible optionals ∪ peers; the
  #261 SDK repro materializes 6/6 lock packages and the peer-importing entry
  module loads.
- I3. A seeded lock containing an entry that no traversal edge reaches fails
  the install loudly at install time, naming the unreached entries — never a
  silent drop surfaced at build or page load.

## Items

1. `npm-client/lockfile-replay-optional-dependencies` — **optional-replay** —
   entry `optionalDependencies` + `cpu`/`os` surfaced by the reader, returned by
   the lockfile source, cpu-gated at resolve; existing optional-boundary
   warn-and-skip handles failures.
2. `npm-client/lockfile-replay-peer-entries` — **peer-replay** — walk traverses
   `pin.peerDependencies` on lockfile-origin pins when the lock has the entry;
   absent peer = skip (live authority elsewhere).
3. `npm-client/lockfile-replay-unreached-entry-gate` — **unreached-gate** —
   post-walk: lock entries ∖ (reached ∪ recorded-skips) → loud
   `EBROKENLOCK`-family error. Blocked by items 1–2.

## Budget

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
- new coordination mechanisms: 0

| slice | band |
|---|---|
| optional-replay | 30–120 |
| peer-replay | 40–150 |
| unreached-gate | 20–80 |
