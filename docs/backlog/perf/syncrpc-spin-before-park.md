---
area: perf
status: draft
title: bounded spin-before-park in SabRing.waitReply — measured −6.0 µs/hop (9.2 → 3.2)
created: 2026-08-27
why: stage-attributed micro-bench (2026-08-27, d4caf2e6a, Node worker_threads, production SabRing/codecs/dispatcher, 50k warm iters, medians) — Atomics wake latency is 62–65% of a ~10 µs hop (reply-direction unpark 4.5 µs + request-direction owner event-loop task 2.0 µs); a 20 µs spin-then-park client resumes at the REP_STATE store and measured 3.17 µs vs 9.17 µs parked (control re-run 9.13); ring state machine 0.4 µs, version checks ~0.02, SAB copies ~0.04 at small payloads — all other suspects negligible; JSON framing measured 1.7 µs (spike's 3.1 µs not corroborated)
user_story: As a dev whose child hits owner fs over sync-RPC, I want hop latency near the ring's floor, but today ~4.5 µs of every reply is OS unpark from Atomics.wait.
sources: [docs/backlog/perf/reference/child-fs-rpc-hot-path.md, ADR-0366]
code: [packages/kernel/src/ipc/sab-ring.ts, packages/kernel/src/ipc/sync-client.ts]
---

## Context

Client is a dedicated blocked Worker: spinning is legal and burns only its own
core for ≤ the owner's ~4–5 µs turnaround; budget must be bounded/adaptive
(~10–20 µs) then park. Request-direction ~2 µs (notify → owner `waitAsync`
promise task) is NOT removable this way — the owner realm cannot spin; that is
the topology floor. Busy-poll dispatcher fallback measured 1.15 ms/hop — hot
paths must never see it (Chromium has waitAsync).

Honest macro sizing: vite build ≈ 16.5 k hops × 6 µs ≈ 0.1 s; express ≈ 3.5 k
hops ≈ 20 ms. A 3× hop-cost cut, but today's anchor wins are small — worth
picking up bundled with other ring work or when hop-latency-sensitive paths
appear, not as a standalone slice. Numbers are Node-on-macOS; Chromium absolute
µs will differ, relative shares (wake dominates) transfer. Repro: scratch
scripts pattern — production `SyncRpcDispatcher` + client Worker via tsx,
stage stamps through a shared BigInt64Array of hrtime.

## Options / Next

- `SabRing.waitReply`: spin on REP_STATE with bounded budget, then
  `Atomics.wait` as today; no wire/protocol change.

## Reversibility

REVERSIBLE — client-side wait strategy only.
