---
area: distribution
status: draft
title: isolate-host suite rows that pin a wall-clock phase or bound red under extreme host load
created: 2026-11-22
why: A flaky red in the isolate-host lane costs PRs a rerun and hides real reds; each needs a scenario redesign, not a bigger bound.
sources: [docs/process/traps.md]
code: [packages/isolate-host/tests/pool-faults.test.ts, packages/isolate-host/tests/corpus.ts, packages/isolate-host/tests/limits.test.ts, packages/isolate-host/tests/protocol.test.ts, packages/isolate-host/tests/pool.test.ts, packages/isolate-host/tests/child-trust.test.ts, packages/isolate-guest/tests/embedder.test.ts]
---

## Context

Stand (PR #420, macOS arm64, 12 CPUs): `pnpm vitest run --project isolate-host`, 48 `yes` processes plus neighbouring sessions (their load is not controlled). Final product of #420 (`d057830c9`): 10 runs at load average 38–268, one more run discarded (an inspector-port clash from outside the suite). Baseline (`50c9d8bf1`): none of these red in 10 runs at load 40–186. External reviewers of #420 saw the same rows at load 250–309 with swap nearly exhausted. Every row is green in isolation, and #420 changed none of them. Counts are reds in the 10 final runs.

**The guest's output must land before a short deadline** (`stdout: ''` instead of its marker):
- `pool-faults` §4 "a builtin that ignores termination (default-comparator sort of 3e6 doubles)…" — 6/10. Building the 3e6-element array before `console.log('c')` outlasts `timeoutMs` 1500, so the deadline hits the setup, not the sort.
- `pool-faults` §4 "Atomics.wait forever…" — 2/10 for `'c'`; 1/10 a 5000 ms neighbour got only `'a0\n'`.
- `pool-faults` §4 "a busy loop…" — 1/10, plus 1/10 on its neighbours.
- `limits` "a synchronous busy loop is killed at the deadline…" — `'spin'` missing, 4/10.
- `pool-faults` "a cancelled call still running keeps its slot…" — `'c'` missing, 2/10.

Each row needs boot plus setup to finish within its `timeoutMs`. An output frame that is sent in time but read late by a starved consumer is also lost (declared: `isolate-host-starved-deadline-outcome`).

**Elapsed-time bounds:**
- `protocol` hostile rows `ms < 1000` — up to 16 rows in one run at load 268.
- `protocol` "a channel closed without a result…" — 4/10 (1019–4427 ms; reviewers 1382).
- `pool.test` idle worker `< 5000` — 1/10 (7131).
- `embedder` "performance.now() restarts with every call…" — 3/10.
- `limits` "1e6 one-byte writes…" and "a 256 MiB flood…" (`held` null) — 1/10 each.
- `limits` "empty writes…" — 120 s test timeout once.

**Parity rows whose observable is a time race:**
- `interval-keeps-its-period` (`g[0] < 275`). The period is observable only below the embedder's delivery latency: a worker stalled 170 ms in every 340 gives 342 ms gaps, which is exactly what re-arming from the end gives. Repro: SIGSTOP/SIGCONT the warm worker every 170 ms while `runCode` runs the row. Deterministic twin: `isolate-guest/tests/host-bridge.test.ts` on a fake host clock. The real-Node row stays the oracle.
- `event-loop-order` — 1/10. `setImmediate` against `setTimeout(…, 100)`: a loop whose first turn starts more than 100 ms late runs the timer first, in Node as in rifty, each independently.
- `interval-storm` (`termination: 'timeout'`) — 2/10.
- `slow-interval-keeps-pace` — 1/10.

**Whole-run collapse:** one run at load 268 took 693 s (normal ~230 s). In it, every `child-trust` status row ended with a non-exact outcome.

**Open question: `ERR_ISOLATE_HOST_WORKER_LOST (code 1, signal null)`** instead of `memory` (`pool-faults` "a resizable ArrayBuffer / a growable SharedArrayBuffer with written pages", reviewer log at load 250–309, swap nearly exhausted) and instead of `timeout` (the sort row, once). It was not seen on this stand (0 in 10). A worker that exits with code 1 is not a slow test: it is the worker's own process failing. The likeliest reading is that machine memory ran out and an allocation in the worker's own JS threw uncaught. That is unconfirmed: the worker's stderr is discarded by design (ADR-0563 §6), so the run does not name the throw. If it reproduces as a host-side throw on an allocation failure, it is a product finding (the worker should die as a lost worker with its RSS cause, not exit 1), not a row of this record.

Owner: next isolate-host test-hygiene pickup; trigger: any of them red in CI. Rule: `docs/process/traps.md` wall-clock-assertion-under-load (no bigger bound; an event, or a stall at the judged point).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
