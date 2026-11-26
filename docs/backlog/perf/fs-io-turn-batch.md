---
area: perf
status: draft
title: A batch of async fs calls costs two host turns per call; one operation turn per batch would halve it
created: 2026-11-26
why: "After PR #468 (`runtime-js/fs-callbacks-io-turn`) each async fs call takes two host turns (operation, completion): `Promise.all` of 5000 `fs.promises.stat` in the isolate takes ~130 ms where Node takes ~15 ms and rifty took ~4 ms before"
sources: ["PR #468 cost table (author and external review, 2026-11-26)", docs/backlog/runtime-js/fs-callbacks-io-turn.md]
code: [packages/runtime-js/src/builtins/fs-io-turn.ts, packages/runtime-js/src/builtins/timers.ts]
---

## Context

Measured 2026-11-26 on macOS arm64, medians of 5 (`imm` of 2). Columns are main `c2250727d` →
PR #468; Node v24.16.0 alone, 3 runs: all5000 14–20 ms, cb5000 4–10, seq256 2–8, reads256 3–5,
imm1e5 1.26–2.0 s.

| measure | in-process | isolate | Workbench | SDK |
|---|---|---|---|---|
| `Promise.all` of 5000 `fs.promises.stat` (all5000) | 3.6 → 13.3 ms | 4.1 → 123–145 | 101 → 135 | 3.6–5.9 → 26.5–28.5 |
| 5000 parallel callback `stat` (cb5000) | 3.9 → 12–17 | 4.4 → 121–128 | 98 → 131–140 | 3.9–5.5 → 28–31 |
| 256 sequential `await fs.promises.stat` (seq256) | 0.2 → 0.9–1.0 | 0.2 → 6.5–6.9 | 5.0 → 7.0 | 0.2–0.3 → 1.3–1.9 |
| 256 callback reads of 64 KiB (reads256) | 0.6 → 1.4 | 0.6 → 7.8–9.0 | 20 → 24–25 | 3.4 → 4.6–6.0 |
| a chain of 1e5 `setImmediate` (imm1e5) | 1.25–1.28 s (unchanged) | ≥ 60 s timeout (1 ms each) → 1.06–1.19 s | 178 → 195–197 ms | 176–180 → 193 ms |

A turn costs about 13 µs in the isolate: a host `setImmediate` and an isolated-vm call in. The
manager accepted the cost as declared (compat `isolate-host.md`).

## Question

A batch submitted in one tick (Vite's `Promise.all` over `stat`/`readFile` reached 115) could share
one operation turn: run every operation submitted before that turn, then queue one completion
turn each. N + 1 turns instead of 2N, and no guest code runs in the operation turn. PR #468 measured
no wall-clock effect on `react-vite-preset` (install, Vite start, HMR phases). Which workload would
the saving reach, and does it keep every `fs/callback-*` parity row?

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
