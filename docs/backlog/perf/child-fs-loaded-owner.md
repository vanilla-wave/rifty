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

## Challenge

challenge: 2026-08-27 — 5 problems
- premise — the `why:` evidence (probe latency 5–70× above the 18 µs idle hop) was measured under owner *publication* load per `child-fs-write-publication-coalescing.md`, but the drafted rig measures `busy-sibling` RPC contention and explicitly declines owner-internal work load; by the doc's own bound ("a saturating sibling child ≈ ≤2× the RPC-bound component") the proposed load shape cannot reproduce the phenomenon cited to justify the item.
- sizing — the doc carries only per-hop ratios and bounds (+T ms per T-ms macrotask, ≤2×), never a share of a real anchor; the cited sibling item already assigns the 2.1 s stat-latency term to publication and expects it to deflate once coalescing lands, so the residual owner-load share of the ~6 s product `vite build` — the exact quantity the deferral rests on — is unsized in the doc.
- premise — cheaper route unweighed: the same number was already obtained with temporary instrumentation and a documented repro (per-method counters in `packages/kernel/src/ipc/sync-dispatch.ts` `pumpOnce` + child-blocked timers in `sync-rpc-fs`, `pnpm bench:child-fs --runs 1`) at zero committed surface, versus a permanent `--owner-load` CLI enum plus conditional artifact block in `tools/perf/src/child-fs-artifact.mjs` for a fact the doc itself calls diagnostic-only.
- direction — the deferral is recorded, but the carrier it freezes is ~500 LOC + ~6 fault rows of permanent rig machinery for a number with no decision attached, against AGENTS.md §Simplicity ("no machinery the contract is deliverable without") and a mission that names production perf a non-goal while M11 (usage ergonomics) is the active milestone; the rig design (second-terminal churn child, per-phase op counts as proof-of-load) has no spike behind it, which `docs/backlog/README.md` calls a frozen assumption in a question draft.
- ux — no user scenario improves from the proposed work even if executed: the deliverable is an artifact field, the asserted scenario ("dev server serving while `vite build` runs") has no in-repo observation or report behind it, and the doc's own remedy for that scenario is the coalescing item, not the measurement.

## Options / Next

- No slice now: direction and bounds are code-determined, a loaded number would
  be diagnostic-only, and `child-fs-write-publication-coalescing` removes the
  main source of owner busyness first. Promote on a user-visible
  dev-server+build slowness report, or once hop-count instrumentation lands.

## Reversibility

REVERSIBLE — additive enum + conditional artifact block; idle path unchanged.
