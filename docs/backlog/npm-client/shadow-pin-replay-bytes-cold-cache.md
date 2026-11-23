---
area: npm-client
status: draft
title: What should install do when a lock's shadow-substituted pin has no replay bytes in a cold cache?
created: 2026-11-23
why: After a frozen v5 snapshot on a cold shared cache, install over a lock with a shadow-substituted pin fails `EBROKENLOCK` (outcomes: ADR-0547 §Consequences) — loud, accepted, and the message names cause and exits; a lock-preserving network route is undecided.
user_story: As an editor developer using a frozen prepared Vite snapshot, I want `npm install` (or adding a package) to either succeed or tell me what to do; today it fails with EBROKENLOCK naming the substitute and the two exits.
sources: [PR-388, docs/adr/distribution/0547-frozen-prepared-dependency-snapshots.md, docs/adr/playground/0346-baked-dependency-snapshots-carry-replay-tarball-cache.md, docs/adr/npm-client/0361-lock-replay-admits-the-attested-recipe-pin-request-admission-unchanged.md, docs/backlog/playground/snapshot-carries-substituted-bytes-twice.md]
code:
  - packages/npm-client/src/installer-walk.ts
  - packages/npm-client/src/internal/shadow/substitution.ts
  - packages/workbench/src/workers/no-coi-frozen-install.contract.test.ts
  - packages/workbench/src/workers/no-coi-frozen-vite-install.contract.test.ts
---

## Context

Observed 2026-11-23 (PR #388 cross-review, carrier
`packages/workbench/src/workers/no-coi-frozen-install.contract.test.ts`):
a lock pin whose acquisition is a shadow substitution
(`acquisition.kind === 'registry'`, `installer-walk.ts` →
`readRegistryShadowReplayCache`) reads its bytes only from the shared tarball
cache (`internal/shadow/substitution.ts`, `missingShadowReplayBytes`).
Replay snapshots carry exactly those bytes; frozen v5 omits them by design.
Outcomes after frozen on a cold cache (Vite 7.3.6 and a LightningCSS
mechanism case, including the direct-request and lockless registry routes) are
owned by ADR-0547 §Consequences and its carriers
`no-coi-frozen-vite-install.contract.test.ts` /
`no-coi-frozen-install.contract.test.ts`. The lock-replayed pin refuses network
by the zero-registry-read replay rule (originally ADR-0335, grafted into
ADR-0361; ADR-0346).

Accepted today (ADR-0547, goal compact-dependency-snapshots decision
2026-10-23): no install ban, no network fallback, no reinstall promise. Docs
state the remedy (replay snapshot or warm cache). Not a defect of PR #388.
The error text (former question 1) names cause and exits since 2026-11-23
(ADR-0547 §Decisions).

No match in `docs/adr/README.md` §Declined concepts or backlog titles; the
neighbouring `playground/snapshot-carries-substituted-bytes-twice` is about
replay deduplication, not the cold-cache error.

Observed 2026-11-23: the refusal comes after the ordinary lock tarballs are
fetched (11 for Vite 7.3.6, `no-coi-frozen-vite-install.contract.test.ts`);
the lock alone already names every substituted pin, so a cache check could
refuse before any download. Not decided; behavior unchanged.

## Question

2. **owner: user** — should a lock-replayed shadow pin ever acquire its
   source from a connected registry on a cold cache, keeping the lock's exact
   pin? Today's registry routes (none preserve the lock for Vite 7): ADR-0547
   §Consequences. This changes observable
   install scope and the replay-integrity authority (ADR-0346/0361); it is the
   user's call, not a direction this draft proposes.

Owner: npm-client. Trigger: a user scenario that installs after a frozen
snapshot or on a cold cache with shadow pins (agent adding a package in a
frozen-prepared editor), or a support report of this error.
