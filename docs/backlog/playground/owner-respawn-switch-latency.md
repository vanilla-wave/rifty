---
area: playground
status: draft
title: Project-switch owner-respawn latency + progress affordance
created: 2026-06-21
why: ADR-0165 makes project switch a full owner teardown+respawn (env is spawn-time-only); every switch restarts the terminal + dev server + re-wires bridges — latency is unmeasured and e2e may time out
user_story: As a user switching between two saved projects, I want the switch to feel responsive (or at least show honest progress), but ADR-0165's mechanism kills + respawns the owner worker and reboots the dev server on every switch, which can be multi-second with no feedback.
sources: [ADR-0165, ADR-0146, ADR-0148]
code: [apps/playground/src/App.tsx, packages/workbench/src/workers/real-vite-bootstrap.ts, packages/workbench/src/glue/realVite.ts]
---

## Context

ADR-0165 §3: switch = `owner.close()` → await exit → `startWorkspaceOwner({root:newRoot})` → await ready → re-wire bridges → restart dev server → clear terminal. Strictly sequential (no two-owner window). That's correct but slow: owner spawn + VFS mount + (snapshot restore or install) + dev server boot, every switch. No latency budget, no progress UI, and the m10/preset e2e suite has timeouts that a respawn-per-switch could blow.

## Options or Next

- Measure switch wall-time across instant vs from-scratch Starters; set a budget.
- Add a switch progress affordance (the design's `Switched to <name>` toast → a determinate "restarting preview…" state until dev server `running`).
- Ensure e2e waits on the real ready/running signals, not fixed sleeps; bump timeouts where justified.
- Investigate whether snapshot-warmed roots skip install on reactivation (stamp reuse per project, ADR-0165 §5) to cap the common-case cost.

## Reversibility

REVERSIBLE — perf/UX tuning over a fixed mechanism (the respawn is the ADR-0165 decision). No public API or disk-format change.
