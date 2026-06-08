---
area: perf
subsystem: kernel
status: parked
title: ADR-0090 — kernel worker pre-warm pool (amortize spawn latency; gated on a measured spawn spike)
created: 2026-06-08
why: pre-warm pool is the biggest spawn-latency lever but build is gated on a measured spawn spike (inflection gate, CLAUDE.md) — design now, build later
sources: [perf-audit pre-warm/§5, adr-plan A/ADR-0090, ADR-0011]
---
## Context
New runtime mechanism layered on spawnKernelWorker: pool state, SAB/port pre-allocation, idle-evict teardown, isSabIpcSupported capability-gating, claim/init handshake. rule4 (>100 LOC / >2 files). Auditor corrected verdict's proposed "ADR-0083" → 0090.
## Options / Next
1-2 never-executed warm workers; identity bound only at claim/init time (preserves ADR-0011 "own realm per process"). Record the conditional/measured-need gate (measured-need gate — CLAUDE.md "inflections are not stops"): design recorded now, build conditioned on a measured spawn spike, separate PR. Per-spawn env diff is the independent companion lever.
## Reversibility
IRREVERSIBLE — rule4 (>100 LOC / >2 files). Does not supersede ADR-0011. GATE: build conditioned on measured spawn spike (inflection gate, CLAUDE.md). No decision subagent. PARKED until the gate fires.
