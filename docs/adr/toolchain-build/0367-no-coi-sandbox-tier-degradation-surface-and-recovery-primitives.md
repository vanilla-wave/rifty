# ADR 0367: No-COI sandbox tier degradation surface and recovery primitives

Status: Accepted
Date: 2026-08-29

> TL;DR: the no-COI sandbox tier gets a semantic Sandbox capability report (new additive surface — `checkCapabilities` platform probe unchanged), a restart primitive + worker-died event, and `os.cpus()`/`availableParallelism()` = 1; all degradations warn-once + report, never silent.

## Context

Epic `no-coi-sandbox-tier` (goal frozen 2026-08-28, user decisions
2026-08-25/28): full Vite 7 agent loop on a page served with NO COOP/COEP.
Chromium there defines no `SharedArrayBuffer` binding; children run same-realm
(one event loop). Four choices frozen in the goal are IRREVERSIBLE (public API
/ deliberate Node-observable divergence) and need an ADR carrier — a goal doc
cannot settle them (bare-sab-guard Contract+RED checkpoint 4). Evidence:
`docs/backlog/runtime-js/reference/no-coi-degradation-probes.md` (spike table +
§2026-08-29 real-realm probe), `docs/backlog/distribution/reference/
no-coi-hmr-spike-record.md` (wedge is alive-but-blocked — no death event covers
it; full sandbox re-create ~18s).

## Decision

1. **Semantic capability report — NEW additive Sandbox surface.** On no-COI
   boot (`createSandbox({requireCrossOriginIsolation:false})`) the sandbox
   exposes a report enumerating surfaces as working / degraded(warn) /
   throwing. The existing public `checkCapabilities()`/`CapabilityCheck`
   (platform probe: what the BROWSER provides) is NOT changed, replaced, or
   overloaded — the report answers a different question (what THIS sandbox
   composition delivers here). Exact TS identifiers/shape settle at the
   implementing slice's Contract+RED; this ADR pins: additive, semantic
   three-band, per-surface, platform probe untouched.
2. **Recovery primitives — NEW additive Sandbox surface.** A restart primitive
   (terminate + reboot + preview iframe reload) recovering dev+preview from a
   wedged (alive-but-blocked) worker, and an event surfacing actual worker
   death. Wedge DETECTION stays agent-owned (their timeout): heartbeat and
   auto-reconnect epoch machinery declined at `works` tier (robust-class).
   Lifecycle today is `dispose()` only; restart is additive beside it.
3. **`os.cpus()` / `os.availableParallelism()` report 1 in the no-COI tier.**
   Deliberate Node-observable divergence from the host count (probe: host-12 is
   "faithful to host"): every no-COI "process" shares ONE event loop, so host
   count advertises parallelism that does not exist and sizes guest worker
   pools (Vite/esbuild) onto a throughput cliff. 1 models the actual execution
   substrate — exactly what Node reports on a 1-core host. COI tier keeps host
   values.
4. **Degradation shape.** Every no-COI gap = warn-once + capability-report row,
   or loud throw (`execSync` stays `NotImplementedError`); console-swap
   mandatory. Never a quiet subset — same-realm fallback never masquerades as
   isolated (resolves `kernel/process-equals-web-worker` fork FOR THIS TIER;
   retiring the fallback under COI stays that item's scope). SUPERSEDES
   ADR-0011's same-realm-fallback boundary clause ("for non-isolated test
   environments only", deprecated): in this tier the fallback is a warned +
   capability-reported product mode — dated correction note on ADR-0011 +
   README Corrections row.

Rejected: reusing/extending `CapabilityCheck` for the semantic report (mixes
platform facts with composition policy); heartbeat wedge detection (cannot
preempt one blocked event loop); host cpu count no-COI (fidelity to a number
whose capability is absent = a silent lie to pool-sizing callers).

## Consequences

- Additive public SDK surface (report, restart, died event) → irreversible;
  shapes finalize at the implementing slices, bound by this ADR's semantics.
- cpus=1 is a compat-matrix-visible divergence, warned + reported — honest
  under the Fidelity bar because the host value would misreport capability.
- Goal `no-coi-sandbox-tier` invariants I1/I6/I7 now carry an ADR; slice
  contracts cite ADR-0367 instead of goal fiat.
