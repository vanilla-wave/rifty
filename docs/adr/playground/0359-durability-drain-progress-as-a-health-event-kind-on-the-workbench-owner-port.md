# ADR 0359: Durability-drain progress as a health-event kind on the workbench owner port

Status: Accepted
Date: 2026-08

> TL;DR: the durability flush — 96% of heavy-tree project open (#256:
> 40.4 s of a 41.9 s open, fully mute) — gets an observable surface: a new
> `kind: 'durability-progress'` member of `WorkbenchOwnerHealthEvent` with
> REAL counts `{persisted, total}` and a terminal `persisted === total`
> event. Owner-port only; counts come from the drain owner's own ledger of
> completed persist ops — never synthetic/timed progress.

## Context

`WorkbenchOwnerHealthEvent` (workbench-owner-port.ts) carries only
`fatal-invariant` and `persistence`; no progress mechanism exists anywhere in
packages/workbench (verified 2026-08-15). Issue #256's maintainer chased a
"hang" that was this mute phase. Even after the drain speedups (slice 1
mkdir-dedup, slice 2 ADR-0358 parallel drain) the phase is seconds-long on
big trees, and timeouts still cannot distinguish slow from stuck. Epic
`project-open-drain-latency` I1; forks user-resolved via rifty-refine
2026-08-15 (epic Decisions).

## Decision

- **Shape** (user-resolved fork): counts `{persisted, total}` up to the
  active drain's watermark, plus a terminal completion event where
  `persisted === total`. Event ARRIVAL doubles as the heartbeat — a wedged
  OPFS op is distinguishable because counts stop arriving/advancing while
  the drain reports unfinished. Honesty rule (Fidelity): only REAL
  completed-op counts from the drain owner (`OpfsFsSync`'s settled persist
  ops) — no synthetic, timed, or eased progress, ever.
- **Surface** (user-resolved fork): a new
  `Readonly<{ kind: 'durability-progress'; persisted: number; total: number }>`
  member of the EXISTING `WorkbenchOwnerHealthEvent` union on the existing
  health stream — no new subscription machinery. The compile-time break for
  embedders' exhaustive switches is ACCEPTED as a loud migration (better a
  compile error than a silently unhandled kind).
- **Reach** (user-resolved fork): owner-port only. The visible `npm install`
  terminal output stays byte-parity-clean — real npm prints nothing during
  an fs flush (`shell/byte-exact-command-output` owns that contract).
- **Plumbing**: counts originate in the worker realm (the drain owner) and
  ride the EXISTING owner→page durability channel (the same protocol path
  that feeds `onDurabilityState` → `publishHealth`) — no new coordination
  mechanism, no reverse imports; the vfs seam is a progress observer on the
  flush path (an events-out callback, not a scheduler change).
  > Corrected (2026-08-16, #256 first-open unit): the "existing owner→page
  > durability channel" clause is superseded — that channel is per-project
  > token-gated (`workbench:project-vfs`), so the FIRST-OPEN materialization
  > drain (I1's central case) could never deliver on it: the emit slot binds
  > only at project-runtime creation, after the promote proof-flush
  > completes. Progress now rides an owner-LEVEL control message
  > `workbench:durability-progress` on the same owner→page ipc (health
  > listeners are owner-level and precede any open); the per-project vfs
  > frame hop is removed. Shape, surface, reach, honesty, and coalescing
  > clauses stand unchanged.

## Consequences

- Hosts can render honest N-of-M progress and stall detection during
  project open; a 40 s flush is no longer indistinguishable from a hang.
- Embedders with exhaustive switches over `WorkbenchOwnerHealthEvent.kind`
  get a compile error until they handle (or default-case) the new kind —
  accepted loud migration.
- Progress framing adds owner→page messages during a drain (bounded by
  count changes; coalescing at the emitter keeps it O(progress), not
  O(ops)).
- The epic's I1 invariant becomes provable end-to-end: monotone
  non-decreasing `persisted`, terminal `persisted === total`, wedge
  distinguishable — carried by the slice's browser acceptance.
