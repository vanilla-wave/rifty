---
area: distribution
status: draft
title: Three isolate-host rows pin a wall-clock phase and red under extreme host load
created: 2026-11-22
why: A flaky red in the isolate-host lane costs PRs a rerun and hides real reds; each needs a scenario redesign, not a bigger bound.
sources: [docs/process/traps.md]
code: [packages/isolate-host/tests/pool-faults.test.ts, packages/isolate-host/tests/corpus.ts]
---

## Context

Stand (PR #420, macOS arm64, 12 CPUs): `pnpm vitest run --project isolate-host` 10 times with 48 `yes` processes plus neighbouring sessions. After the load-free fixes of #420, at load average 150–320, each red once in 10 (0 in 10 on the baseline stand at load 40–186); green in isolation:

- `pool-faults.test.ts` "a builtin that ignores termination (default-comparator sort of 3e6 doubles): culprit timeout within timeoutMs + 1000 ms" — culprit `stdout: ''`, not `'c\n'`: building the 3e6-element array before `console.log('c')` took longer than its `timeoutMs` 1500, so the deadline hit the setup, not the sort (2 in 17 runs of the stand after #420, both this symptom). An external reviewer of #420 saw the same row once end `ERR_ISOLATE_HOST_WORKER_LOST (code 1)` instead of `timeout`, green in isolation. It was not seen on this stand (0 in 27 runs): a worker exiting with code 1 under load could be a product defect, not a test's — unclassified until reproduced. The row needs the deadline to land inside an uninterruptible builtin; a fixed deadline after a host-speed setup cannot promise that.
- `corpus.ts` parity row `interval-keeps-its-period` (`g[0] < 275`) — the period (re-armed from the tick's start, not the callback's end) is observable only below the embedder's delivery latency: the worker stalled 170 ms in every 340 gives 342 ms gaps, exactly what re-arming from the end gives (repro: SIGSTOP/SIGCONT the warm worker every 170 ms while `runCode` runs the row). Deterministic twin: `isolate-guest/tests/host-bridge.test.ts` on a fake host clock; the real-Node row stays the oracle.
- `corpus.ts` parity row `event-loop-order` — `setImmediate` against `setTimeout(…, 100)` armed in the same run: a loop whose first turn starts more than 100 ms late runs the timer first, in Node as in rifty, each independently. The row pins phase order through a time race.

Owner: next isolate-host test-hygiene pickup; trigger: any of them red in CI. Rule: `docs/process/traps.md` wall-clock-assertion-under-load (no bigger bound; an event or a stall at the judged point).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
