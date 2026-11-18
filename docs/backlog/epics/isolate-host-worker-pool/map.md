# Map — isolate-host-worker-pool

## Items

1. `distribution/isolate-host-pool-acceptance` — **acceptance carrier** — the
   `## User scenario` as tests over the real built package, real workers and
   isolated-vm (I1–I7), plus `scripts/measure.mjs` for I9; committed RED.

Wall hypotheses the carrier is expected to hit (units only when the run hits
them): worker main hosting many isolates with call-addressed frames and a
cancel request; consumer-side pool (placement, rerun, culprit, stuck grace,
idle unref, recycle); host timer-fire backpressure, now a shared-worker
resource (`distribution/isolate-host-timer-fire-backpressure`); V8 code cache
per worker; superseding ADR + ADR-0557 §Corrections, trust-model, README,
compat rows (I8).

## Open questions

- Worker RSS ceiling and recycle watermark with many calls per worker: after
  `dispose()` RSS stays at its high-water mark (step 0 retention rows, macOS);
  Linux unmeasured — owner: agent — probe both at PICKUP of the pool wall.
- A rerun whose original deadline runs out (I5): reject naming the lost
  worker (recommended — an honest unknown failure, keeps the `timeoutMs` +
  1 s bound), `timeout` (keeps the bound, tells the model its code was slow
  when it was not), or a fresh `timeoutMs` for the rerun (fair to the guest,
  bound becomes 2 × `timeoutMs` + 1 s) — owner: user — asked 2026-11-18 via
  the manager thread; carrier row 8 encodes the recommendation.
- A worker lost with no culprit (I5): rerun its calls once (recommended —
  the frame's point 3 extended; neighbours of an unknown culprit lose only
  delay, the true culprit costs at most two workers) or reject them at once
  as A does today — owner: user — asked 2026-11-18 via the manager thread;
  carrier row 8 encodes the recommendation.
- Shard size 4 vs isolated-vm's pool of cores + 1 threads (CI runner cores) —
  owner: agent — probe 4 busy guests + 1 neighbour on the CI runner.
- How many idle workers stay warm, and when an idle worker is reaped —
  owner: agent — smallest rule meeting I1 + I6 + the I9 numbers.
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
