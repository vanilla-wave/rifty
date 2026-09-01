---
area: distribution
status: draft
title: no-COI dev+HMR — resident vite dev in the sandbox worker + restart primitive + death event
created: 2026-08-28
epic: no-coi-sandbox-tier
why: HMR spike proved resident Vite 7 dev is steady no-COI (100/100 cycles, p50 244ms, storm 50/50, heap plateau) but the composition exists only in a throwaway harness, a wedge leaves the worker alive-but-blocked (no death event fires — recovery was external worker.terminate()), preview WS does not reconnect after reboot, and the sandbox surface exposes only dispose()
user_story: As an agent platform, I want dev+HMR preview plus an invokable restart primitive when my timeout says the realm wedged, but today there is no sandbox-surface dev composition, no restart/kill API (only dispose()), no death event, and only a manual iframe reload restores preview after a reboot
sources: [docs/backlog/distribution/reference/no-coi-hmr-spike-record.md]
code: [packages/rifty/src/sandbox.ts, packages/service-worker/src/route-preview.ts, packages/net/src/cross-realm/preview-port.ts]
---

## Context

Spike record (durable numbers: sources): boot ~0.5s listen + ~4.3s optimizeDeps; HMR steady;
wedge blocks agent+fs+dev together, worker ALIVE-but-blocked — no death event can cover it;
terminate → dev ready 6.6s; preview WS does NOT auto-reconnect — iframe reload required.
Scope: sandbox-surface dev composition; an agent-invokable RESTART primitive (terminate +
reboot + iframe reload — covers wedge, whose DETECTION stays agent-owned via timeout,
heartbeat declined); a worker-died event for actual deaths; both proven in the no-COI lane.
Explicit reload policy is user-decided (epic Decisions — auto-reconnect declined). Open
question feeding this pickup is closed by goal I10: marker only. Blocked by
`distribution/no-coi-sandbox-build-loop`.

User scope, 2026-09-01: goal tier is `works`. Required abnormal behavior is
only a named actual-worker-death event, an explicit restore primitive and a
next-boot marker for unflushed writes. Heartbeat, journal, automatic reconnect,
exactly-once recovery, hidden retry, queue, crash-proof durability and other
robust machinery are explicitly outside this child and may not be raised as
checkpoint requirements.

## Challenge

challenge: 2026-08-28 — 2 problems
- Wedge recovery is claimed but undelivered by the proposed primitives: the user_story promises 'documented recovery when a plugin wedges the realm', yet the spike (FINDINGS-HMR.md §4) shows a wedged worker stays alive-but-blocked and was only recovered via external worker.terminate() — a worker-died event never fires for the flagship wedge scenario (epic scenario 6 'worker-died event fires' contradicts the spike), and with heartbeat/epoch detection user-declined the item names no terminate/kill API on the sandbox surface (sandbox.ts exposes only dispose()) nor who detects the wedge, leaving the causal chain from proposed work to claimed value broken for its headline failure case.
- All load-bearing evidence (p50 244ms 100/100, storm 50/50, heap plateau, 6.6s reboot, WS no-reconnect) is cited only from throwaway branch t3code/prototype-hmr-agent-scenarios commit 61aeec95f FINDINGS-HMR.md, while the item's sole listed source docs/backlog/runtime-js/reference/no-coi-degradation-probes.md contains zero HMR data and itself states 'Branch artifacts rot ... the observed table is inlined here as the durable record' — the epic goal.md even mislabels that file as the durable record for the dev+HMR spike, so the item's premise rests on evidence the repo's own convention says will rot before pickup.

<!-- Post-challenge edits: P1 → item and epic I6/scenario re-scoped to an agent-invokable
     RESTART primitive (wedge detection stays agent-owned via timeout; death event covers
     real deaths only). P2 → durable record inlined at
     distribution/reference/no-coi-hmr-spike-record.md and sourced here + in goal.md. -->

## Decisions

- Goal tier verbatim: `tier: works`.
- Out of scope by user decision: heartbeat, journal, automatic retry/reconnect,
  exactly-once recovery, hidden retry, queue, crash-proof durability and any
  other robust-class mechanism.
