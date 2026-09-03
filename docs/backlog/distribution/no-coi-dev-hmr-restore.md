---
area: distribution
status: draft
title: no-COI dev+HMR — generic resident tool lifecycle + restart/death/unflushed marker
created: 2026-08-28
epic: no-coi-sandbox-tier
blocked_by: [distribution/no-coi-sandbox-build-loop, distribution/no-coi-host-posture-preservation]
why: HMR proof showed a resident shared-memory-free dev tool can run no-COI, but the public sandbox has no package-generic resident-tool lifecycle, restart/death surface or unflushed-write boot marker; a wedge stays alive-but-blocked and preview recovery requires explicit iframe reload
user_story: As an agent platform, I want a resident installed dev tool with HMR preview plus an invokable restart when my timeout says the realm wedged, but today the sandbox exposes only build-to-completion and dispose, no death event or pending-write marker
sources: [docs/backlog/distribution/reference/no-coi-hmr-spike-record.md]
code: [packages/rifty/src/sandbox.ts, packages/service-worker/src/route-preview.ts, packages/net/src/cross-realm/preview-port.ts]
---

## Context

Spike record (durable numbers: sources): the Vite 7 proof fixture boots in
~0.5s listen + ~4.3s optimizeDeps; HMR steady;
wedge blocks agent+fs+dev together, worker ALIVE-but-blocked — no death event can cover it;
terminate → dev ready 6.6s; preview WS does NOT auto-reconnect — iframe reload required.
Scope: package-generic sandbox resident-tool composition; an agent-invokable RESTART
primitive (terminate + reboot + iframe reload — covers wedge, whose DETECTION stays
agent-owned via timeout, heartbeat declined); a worker-died event for actual deaths; both
proven in the no-COI lane. Vite 7 supplies only I4 proof bytes/HMR behavior; no SDK,
runtime, control-plane, package or distribution authority may depend on its identity,
version, path, callback, type or lifecycle.
Explicit reload policy is user-decided (epic Decisions — auto-reconnect declined). Open
question feeding this pickup is closed by goal I10: marker only. Explicit `blocked_by`
links keep this child behind all five re-cut build prerequisites; full I8 remains open
until their proof plus this child's I4/I6/I10 proof certify together.

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
- Vite 7 is an I4/HMR proof fixture only. Resident-tool public and infrastructure
  authority is package-generic and cannot branch on Vite identity, version, path,
  callback, type or lifecycle.
- Dependencies: all five build prerequisites must certify before this child may
  PICKUP; no transitive shortcut removes an explicit edge.
- Out of scope by user decision: heartbeat, journal, automatic retry/reconnect,
  exactly-once recovery, hidden retry, queue, crash-proof durability and any
  other robust-class mechanism.
