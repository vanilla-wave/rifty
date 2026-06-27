---
area: runtime-js
status: draft
title: perf_hooks + worker_threads spec-global re-exports
created: 2026-06-20
why: Spec-identical browser globals rifty already uses internally, surfaced for instanceof + pool libs; env-data/SHARE_ENV ride kernel spawn channel (partial-but-honest cross-realm).
user_story: As a dev running tinypool/piscina or a perf-instrumented Express app, I want worker_threads MessageChannel/MessagePort + perf_hooks PerformanceEntry classes & histograms, but today they're missing so `instanceof` checks and pool plumbing throw
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §8]
code: [packages/runtime-js/src/builtins/perf_hooks.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/spawn-worker.ts:146]
---

## Context

Re-export spec-identical browser globals rifty already runs on internally — real, not fakes. Env-data/SHARE_ENV need the kernel spawn channel for cross-realm.

| feature · since | real path | anchor |
|---|---|---|
| `worker_threads.MessageChannel/MessagePort` v10.5 | re-export native globals (kernel already uses them) | spawn-worker.ts:146 (`new MessageChannel()` ×4) |
| `worker_threads.BroadcastChannel` v15.4 | re-export native global | worker_threads.ts |
| `perf_hooks PerformanceEntry/Mark/Measure` v8.5 | re-export native classes for `instanceof` | perf_hooks.ts |
| `perf_hooks.createHistogram` v15.9 | pure-JS HDR buckets (record/min/max/mean/percentile/reset); substrate for parked monitorEventLoopDelay | perf_hooks.ts |
| `performance.timerify` v8.5 | wrap fn, bracket `performance.now()`, emit `'function'` entry | perf_hooks.ts |
| `worker_threads.SHARE_ENV` v11.14 | export symbol; same-realm aliases `process.env`; cross-realm needs shared-env channel (partial-but-honest) | worker_threads.ts |
| `getEnvironmentData/setEnvironmentData` v15.12 | module-scoped `structuredClone` Map; cross-realm rides spawn init payload | worker_threads.ts |

Excluded (fidelity-blocked, loud-stub catch-all): `PerformanceNodeTiming`, `monitorEventLoopDelay`, `PerformanceObserver.observe`.
Real-parallelism side: see kernel/real-worker-threads.

## Options or Next

Per-feature promotable. Each: failing parity test (vs real Node) first, then implement. Re-exports (MessageChannel/Port, BroadcastChannel, PerformanceEntry/Mark/Measure) are trivial S — land first. createHistogram + timerify pure-JS M. SHARE_ENV + environmentData: same-realm trivial; cross-realm propagation gated on spawn init payload — mark cross-realm fidelity caveat (med) in compat matrix, not a silent stub.

## Reversibility

REVERSIBLE — recorded here.
