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

## Challenge

challenge: 2026-08-27 — 4 problems
- sizing — headline "wake = 62–65% of a ~10 µs hop" and the −6.0 µs are Node-on-macOS `worker_threads` numbers, but the sibling draft from the same run/commit (docs/backlog/perf/child-fs-write-publication-coalescing.md) measures the shipped product-lane hop at 18 µs; the doc only asserts "relative shares transfer" to Chromium with no measurement, so the actual share and saving in the topology users run are unknown.
- premise — the macro sizing (16.5 k hops × 6 µs) silently assumes every hop is an idle-owner hop, while the same instrumented run records probe latency inflating 5–70× and a 2.1 s stat-latency term under owner publication work (child-fs-write-publication-coalescing.md, child-fs-loaded-owner.md); in that regime a 10–20 µs spin burns its budget and parks anyway, and the doc never sizes the idle-hop share of real workload hops.
- ux — no named scenario changes perceptibly: ≤0.1 s off a ~6 s `vite build` and ~20 ms off a ~277 ms express run (per the doc's own anchors in reference/child-fs-rpc-hot-path.md), yet the `user_story` still claims user value in mechanism terms ("hop latency near the ring's floor"); the doc's own promotion trigger is a hop-latency-sensitive path that it admits does not exist today.
- direction — CLAUDE.md lists "production perf" as an explicit non-goal and ROADMAP M11 (the active focus) is usage ergonomics, and a cheaper route to the same user-visible value already exists and is equally REVERSIBLE: child-fs-write-publication-coalescing targets 4.4 s of the same ~6 s build (~44×) versus this lever's ≤0.1 s, so spending a slice here is straight opportunity cost.

## Options / Next

- `SabRing.waitReply`: spin on REP_STATE with bounded budget, then
  `Atomics.wait` as today; no wire/protocol change.

## Reversibility

REVERSIBLE — client-side wait strategy only.
