---
area: npm-client
status: draft
title: What should install do when a lock's shadow-substituted pin has no replay bytes in a cold cache?
created: 2026-11-23
why: After a compact v5 snapshot (or any cold shared cache) an install over a lock with shadow-substituted pins, or adding an unrelated package, fails `EBROKENLOCK … missing its pinned cache bytes` even with a live registry; the lock-replayed pin is never fetched and a compact Vite project has no npm reinstall route while its lock is kept — loud and accepted by ADR-0547, but the message names no remedy and the network question is undecided.
user_story: As an editor developer using a compact prepared Vite snapshot, I want `npm install` (or adding a package) to either succeed or tell me what to do, but today it fails with EBROKENLOCK naming a shadow recipe.
sources: [PR-388, docs/adr/distribution/0547-compact-prepared-dependency-snapshots.md, docs/adr/playground/0346-baked-dependency-snapshots-carry-replay-tarball-cache.md, docs/adr/npm-client/0361-lock-replay-admits-the-attested-recipe-pin-request-admission-unchanged.md, docs/backlog/playground/snapshot-carries-substituted-bytes-twice.md]
code:
  - packages/npm-client/src/installer-walk.ts
  - packages/npm-client/src/internal/shadow/substitution.ts
  - packages/workbench/src/workers/no-coi-compact-install.contract.test.ts
  - packages/workbench/src/workers/no-coi-compact-vite-install.contract.test.ts
---

## Context

Observed 2026-11-23 (PR #388 cross-review, carrier
`packages/workbench/src/workers/no-coi-compact-install.contract.test.ts`):
a lock pin whose acquisition is a shadow substitution
(`acquisition.kind === 'registry'`, `installer-walk.ts` →
`readRegistryShadowReplayCache`) reads its bytes only from the shared tarball
cache (`internal/shadow/substitution.ts`, "is missing its pinned cache bytes").
Replay snapshots carry exactly those bytes; compact v5 omits them by design.
Real LightningCSS → `lightningcss-wasm@1.32.0` after compact, registry live
(`no-coi-compact-install.contract.test.ts`): plain install over the lock →
`EBROKENLOCK`, zero requests; `npm install ms` → fetches `ms`, then the same
`EBROKENLOCK`; `npm install lightningcss` → the named direct root re-resolves
through the registry (ADR-0361 request admission) and succeeds; replay →
install succeeds from cache. So with the lock kept, a registry route exists only
when the substituted package is a direct dependency named in the request; the
lock-replayed pin refuses network (zero-registry-read replay, originally
ADR-0335, grafted into ADR-0361; ADR-0346).

Real Vite 7.3.6, `esbuild` transitive (`no-coi-compact-vite-install.contract.test.ts`):
lock install, `npm install esbuild` and `npm install ms@2.0.0` all fail
`EBROKENLOCK … esbuild.v2 is missing its pinned cache bytes` after fetching
11 / 11 / 12 ordinary tarballs into the shared cache; project tree unchanged.
Deleting `package-lock.json` makes a plain install re-resolve: it fetches the
`esbuild-wasm` packument and tarball from the registry and succeeds, without
lock exactness (pins may move). Verified: while the lock is kept, no npm route
reinstalls a compact Vite project on a cold cache.

Accepted today (ADR-0547, goal compact-dependency-snapshots decision
2026-10-23): no install ban, no network fallback, no reinstall promise. Docs
state the remedy (replay snapshot or warm cache). Not a defect of PR #388.

No match in `docs/adr/README.md` §Declined concepts or backlog titles; the
neighbouring `playground/snapshot-carries-substituted-bytes-twice` is about
replay deduplication, not the cold-cache error.

## Question

1. Error surface: should the failure name the cause and remedy ("lock pin X
   needs replay bytes absent from the cache — apply a replay snapshot or a warm
   cache") instead of the generic `EBROKENLOCK` recipe text? Agent-owned once
   the wording is the only change.
2. **owner: user** — should a lock-replayed shadow pin ever acquire its
   source from a connected registry on a cold cache, keeping the lock's exact
   pin? Today the registry is reached only by an explicit request for a
   *direct* substituted root, or by dropping the lock (re-resolution, pins may
   move); Vite's transitive `esbuild` has no lock-preserving route. This changes observable
   install scope and the replay-integrity authority (ADR-0346/0361); it is the
   user's call, not a direction this draft proposes.

Owner: npm-client. Trigger: a user scenario that installs after a compact
snapshot or on a cold cache with shadow pins (agent adding a package in a
compact-prepared editor), or a support report of this error.
