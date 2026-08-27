---
area: perf
status: draft
title: child fs sync-RPC under a loaded owner — sensitivity known mechanistically, rig cannot measure it
created: 2026-08-27
why: hot-path goal measured an idle owner only and the artifact schema REJECTS anything else (child-fs-artifact.mjs parseRawSample requires ownerLoad 'idle'); instrumented run showed probe latency inflating 5–70× above the 18 µs idle hop while the owner digests publication work — owner-load sensitivity is real and unmeasured
sources: [docs/backlog/perf/reference/child-fs-rpc-hot-path.md, ADR-0150]
code: [tools/perf/src/child-fs-artifact.mjs, packages/kernel/src/ipc/sync-dispatch.ts, packages/workbench/src/workers/workbench-owner-runtime.ts]
---

## Question

How much does owner-realm load add per hop / per anchor, and is it ever worth a
measured slice?

## Context (analysis 2026-08-27, code-derived)

- Owner in the product lane is the dedicated `workbench-owner` Worker
  (`workbench-owner-runtime.ts` ~:435 installs fs handlers on its realm
  dispatcher); children spawn from that realm. Settled negative: page
  main-thread load (rendering/layout) is IRRELEVANT to hop latency.
- Chromium topology runs the event-driven `Atomics.waitAsync` dispatcher path;
  each hop's reply settle queues on the owner's event loop → a T-ms owner
  macrotask adds up to +T ms to a hop (spiky: npm extraction, durability flush
  live owner-side); a saturating sibling child ≈ ≤2× the RPC-bound component.
  Busy-poll fallback (50 ms backstop) only surfaces as missed-notify outliers.
- Realistic load shape worth measuring: `busy-sibling` — second kernel child
  doing owner-fs RPC in a loop (= "dev server serving while `vite build`
  runs"). Owner-internal `npm install` load declined for now (overlap proof
  materially harder).
- Minimal honest rig extension (sized ~500 LOC + ~6 fault rows): CLI
  `--owner-load idle|busy-sibling`; product-lane fixture opens a second
  terminal running a churn child whose per-phase op counts ARE the
  proof-of-load (each phase observation is itself an owner-fs hop; validator
  rejects opsBuild/opsExpress ≤ 0); per-sample `load` block required iff
  busy-sibling, forbidden when idle — the three committed idle artifacts stay
  byte-valid; in-realm samples stay 'idle' (no owner in that topology).

## Options / Next

- No slice now: direction and bounds are code-determined, a loaded number would
  be diagnostic-only, and `child-fs-write-publication-coalescing` removes the
  main source of owner busyness first. Promote on a user-visible
  dev-server+build slowness report, or once hop-count instrumentation lands.

## Reversibility

REVERSIBLE — additive enum + conditional artifact block; idle path unchanged.
