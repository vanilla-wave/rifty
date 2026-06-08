---
area: perf
subsystem: kernel
status: active
title: Q-2026-06-06-322 — per-spawn env/argv sharing (freeze a canonical env vs ship a diff)
created: 2026-06-08
why: per-spawn full env record + argv structured-cloned every spawn regardless of ring use; the backlog item is this file
sources: [perf-audit #20, adr-plan C/Q-2026-06-06-322]
---
## Context
spawn-worker.ts:150-175: full env record + argv cloned every spawn. Reversible (internal to spawn). Matters if spawn-rate high (test runners, worker_threads fan-out). Companion to the parked pre-warm pool (ADR-0090).
## Options / Next
Decision: share/freeze ONE canonical env object on the spawn-caller side, keeping `WorkerSpawnSpec.env` as `Readonly<Record<string,string>>` and the wire payload (spawn-worker.ts:150-159) byte-identical. Boundary note: the diff / `{baseEnvId,overrides}` variant would redefine the cross-realm wire shape → flips to rule1/NEW_ADR; out of scope here. Record here; TODO(backlog: perf/env-sharing) marker at spawn-worker.ts (~line 150).
## Reversibility
REVERSIBLE — rule5 → record here + TODO(backlog: perf/env-sharing). The diff variant would be IRREVERSIBLE (cross-realm wire shape) — explicitly out of scope. No decision subagent.
