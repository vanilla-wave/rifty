# Map — isolate-host-worker-pool

## Items

1. `distribution/isolate-host-pool-acceptance` — **acceptance carrier** — the
   `## User scenario` as tests over the real built package, real workers and
   isolated-vm (I1–I7, I10), committed RED (`it.fails`); I8 docs and I9
   numbers (`scripts/measure.mjs`, README) are read at CLOSE.

Wall hypotheses the carrier is expected to hit (units only when the run hits
them): worker main hosting many isolates with call-addressed frames and a
cancel request; consumer-side pool (placement, rerun, culprit, stuck grace,
idle unref, recycle); host timer-fire backpressure, now a shared-worker
resource (`distribution/isolate-host-timer-fire-backpressure`); V8 code cache
per worker; superseding ADR + ADR-0557 §Corrections, trust-model, README,
compat rows (I8).

## Open questions

- Worker RSS ceiling and recycle watermark (I10 ≤ 512 MiB) with many calls
  per worker: after `dispose()` small-object heaps stay resident (step 0
  retention rows, macOS); Linux unmeasured — owner: agent — probe both at
  PICKUP of the pool wall; carrier row 11 needs a vector resident on both.
- A pool-initiated RSS kill with no certain culprit (I5): step 0's only
  vector is the host-side timer fire queue — owner: agent — after the
  timer-backpressure wall, re-run the step 0 RSS probes; a vector left
  becomes a carrier row, none left → recorded unreachable.
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
  shared worker (declared, I8).
- Platforms beyond isolated-vm prebuilds (linux-x64/arm64, darwin-arm64,
  win32-x64); Windows is not tested.
