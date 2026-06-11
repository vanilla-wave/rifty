---
area: kernel
status: active
title: Host-operator resource policy + documented threat model
created: 2026-06-11
why: spawning is unbounded and COI is the only boundary, so a runaway guest (spawn loop / test fan-out) can exhaust the realm and hang the tab; a self-hostable runtime that runs other people's code needs cooperative limits + an honest threat model
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0011, ADR-0045]
code: [packages/kernel/src/spawn-worker.ts, packages/kernel/src/process-manager.ts]
---

## Context

COI is the only isolation boundary today and `spawn-worker.ts` allocates PIDs + Workers with no cap
or queue. The open self-hostable positioning implies hosting other people's code, so a host operator
needs: a cap on concurrent live Workers, spawn throttling/queueing, per-process wall-clock/memory
accounting, an infinite-loop kill-switch (`Worker.terminate`), and an egress/fetch policy.
`ProcessManager` already holds the data — it just isn't surfaced or enforced. Critically this is
cooperative resource control, NOT hostile-code/VM-grade isolation (a browser tab can't match
Firecracker/gVisor); marketing tab-isolation as VM-grade would be a credibility defect.

## Options or Next

- First: write the threat-model doc (cooperative control, not containment; what COI does/doesn't
  protect) — cheap, high-trust, decoupled from and before the enforcement code.
- Then: spawn cap + queue/throttle; per-process wall-clock/memory accounting; loop kill-switch;
  egress policy — surfaced as host-operator config.
- Gate: clarify cooperative-only vs future hostile-code intent; measure real spawn spikes (test
  runners) first.

## Reversibility

IRREVERSIBLE when taken up — kernel public behaviour (rule 1); its own ADR. The threat-model doc is
reversible. Recorded here.
