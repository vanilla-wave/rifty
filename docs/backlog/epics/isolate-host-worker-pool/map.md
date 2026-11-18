# Map — isolate-host-worker-pool

## Items

1. `distribution/isolate-host-pool-acceptance` — **acceptance carrier** — the
   `## User scenario` as tests over the real built package, real workers and
   isolated-vm (I1–I8), plus `scripts/measure.mjs` for I10; committed RED.

Wall hypotheses the carrier is expected to hit (units only when the run hits
them): worker main hosting many isolates with call-addressed frames and a
cancel request; consumer-side pool (placement, rerun, culprit, stuck grace,
idle unref, recycle); host timer-fire backpressure, now a shared-worker
resource (`distribution/isolate-host-timer-fire-backpressure`); V8 code cache
per worker; superseding ADR + ADR-0557 §Corrections, trust-model, README,
compat rows (I9).

## Open questions

- Worker RSS ceiling and recycle watermark with many calls per worker: after
  `dispose()` RSS stays at its high-water mark (step 0 retention rows, macOS);
  Linux unmeasured — owner: agent — probe both at PICKUP of the pool wall.
- Culprit at an RSS crossing: the catastrophic culprit is already
  ivm-disposed at the crossing; a 20000-interval flood leads heap stats by
  4 MiB only (step 0) — owner: agent — attribution probe after timer
  backpressure lands.
- Shard size 4 vs isolated-vm's pool of cores + 1 threads (CI runner cores) —
  owner: agent — probe 4 busy guests + 1 neighbour on the CI runner.
- How many idle workers stay warm, and when an idle worker is reaped —
  owner: agent — smallest rule meeting I1 + I6 + the I10 numbers.
- Export goal (other thread) rewrites `src/child/*` and the bridge — owner:
  agent — IMPLEMENT rebases onto it once merged (manager hand-off).

## Out of scope

- Export of an embeddable rifty guest for custom integrations (separate goal).
- Queue, priorities, prewarming, metrics, tenant affinity, a concurrency
  limit, an `AbortSignal` option, a process-per-call mode.
- Hard containment of an isolate escape; side-channel mitigation inside a
  shared worker (declared, I9).
- Platforms beyond isolated-vm prebuilds (linux-x64/arm64, darwin-arm64,
  win32-x64); Windows is not tested.
