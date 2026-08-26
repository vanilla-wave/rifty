---
area: perf
subsystem: toolchain-build
status: draft
title: Child fs perf real product-COI owner-to-kernel-child lane
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: the benchmark needs raw Vite and Express samples from the actual playground owner fs served to a supervised child
user_story: As the child-fs measurement rig, I want both anchors executed through the real COI owner→kernel child topology, but today only a throwaway spike drives it.
sources: [perf/child-fs-perf-lane split @ fb02b2c2f, ADR-0150, ADR-0196]
code: [tests/browser-unit/fixtures/child-fs-product-lane.ts]
---

## Question

Compile after the artifact core lands: drive the public sealed Workbench fixture
with canonical scenario bytes; prove topology from the physical child lifecycle,
not a lane label; assert the goal's exactly 2180 transformed modules; return raw
Vite/Express output and emitted JS only.
