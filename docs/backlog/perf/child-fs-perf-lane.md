---
area: perf
subsystem: toolchain-build
status: draft
title: Committed product-vs-in-realm perf lane for child fs anchors (vite build + express cold start)
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: all current numbers live on a throwaway spike branch; the epic's I3 needs a durable rig so every slice proves its effect on the same anchors
user_story: As the epic's acceptance instrument, I want one committed lane that runs the 2180-module vite build and an express cold require-walk in BOTH worlds (product COI child over sync-RPC; single in-realm worker) and reports self-timed numbers, but today the harness is `prototype/` on the spike branch only.
sources: [spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/README.md + FINDINGS.md §2b]
code: [packages/runtime-js/src/ipc/sync-rpc-fs.ts]
---

## Question

Durable carrier for the two-world measurement: e2e spec lane (playwright,
needs playground dev server, like the spike's `breakdown.spec.ts`) vs bench
script. Constraints from spike: measure vite's own `built in Xs` self-report
(wall includes ~1 s spawn floor no fs change moves); `performance.now()`
clamped to 5 µs in browser → means over ≥2000 iterations, not p50; same guest
bytes must run in both worlds; responder-idle vs loaded-owner recorded as a
run mode. Express anchor: time to listening from cold require walk.

## Reversibility

REVERSIBLE — test/tooling lane, no product surface.
