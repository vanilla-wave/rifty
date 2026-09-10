---
area: distribution
status: draft
title: Configure no-COI worker storage and effective startup budget
created: 2026-09-10
why: SDK embedders must currently override storage globals and patch the fixed handshake deadline
epic: no-coi-self-hosted-project
sources: [https://github.com/vanilla-wave/rifty/issues/328, https://github.com/vanilla-wave/rifty/issues/329, docs/backlog/distribution/reference/no-coi-project-open-refine.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-entry.ts, packages/workbench/src/workers/owner-storage.ts, packages/vfs/src/boot.ts]
---

## Context

Goal I1/I2. SDK options currently expose no namespace/persistence policy or
startup budget; runtime host uses 10,000ms. Existing Workbench storage selection,
VFS native-root mounting and timer validation supply reusable behavior.

## Question

Compile public configuration through the existing authoritative worker bootstrap
before preload, including initial boot and restart. Capture/validate before
effects. Retain namespace omission/origin-root default, required refusal,
observable preferred fallback and unreadable-preload failure. Required OPFS is
not navigator.storage.persist or eviction protection.

Trace each actual startup timer before selecting the public budget carrier.
Preserve explicit default and lifetime settlement; a timeout does not mean no
effects. Close while startup is pending must terminate the selected worker and
settle without later revival. Do not widen this to snapshot-apply or run budgets.

PICKUP prepares public-input RED, real native A/B/default namespace/persistence
proof and delayed-worker timeout/close cases. No new config/timeout coordinator.
