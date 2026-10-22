---
area: service-worker
status: draft
title: Diagnose packed scoped preview timeout after snapshot apply
created: 2026-10-22
why: one CI packed-consumer journey built successfully but its fresh-apply iframe did not satisfy the guest-ready predicate within 120 seconds; missing diagnostics leave the failed condition and cause unknown
user_story: As a Workbench host reopening a scoped Vite project with a fresh snapshot apply, I want its preview to load the supplied project, but one packed Chromium run timed out after the build and source checks passed
sources: [ADR-0409]
code: [tests/integration/workbench-scoped-preview-proof.mjs, tests/integration/fixtures/workbench-vite-consumer/src/scoped-preview-proof.ts]
---

## Context

Observed in PR #383, HEAD `1bd0cf938`, BASE `c39266974`; CI checkout
was merge commit `f4152cd`:
[CI job 119560414396](https://github.com/vanilla-wave/rifty/actions/runs/39698003871/job/119560414396),
`pnpm test:packed-consumer`, Node 24.16.0 / Chromium 148.0.7778.96.
`guestFacts` line 50 timed out after 120000 ms, called at line 361 after
`/sandbox/?fresh=1&apply=1`. Prior scoped open, SW restart, HMR, durable
reopen and same-ID apply assertions passed; the fresh apply's build,
source bytes, control proof and advertised URL assertions also passed.

The predicate combines app/API/chunk text and loaded image width. The log
identifies none of these as the failed condition and carries no iframe/network
snapshot at timeout. A product failure, harness race or runner delay is not
established. No assertion, deadline or runtime code is relaxed for this finding.
Reproduction command: `pnpm test:packed-consumer`; PR #383 carries its isolated
replay/CI disposition. This observation alone does not prove a signal-goal
regression or authorize a lifecycle mechanism.

Dedup: active titles/code, goal maps, traps and ADR declined concepts checked.
`preview-frame-context-lifecycle` concerns 256-entry eviction;
`preview-dispatch-termination-chokepoint` concerns terminal events. Neither
establishes this failure's cause; keep separate until discriminating evidence.

## Question

Which guest-ready conjunct or request failed after fresh apply, and does it
reproduce independently of CI load? Capture the actual iframe document,
network outcomes and owner lifecycle at the existing deadline before selecting
a repair. Boundary: browser/SW/owner lifecycle; fault axis remains unknown.

Owner: service-worker/Workbench preview maintainer. Trigger: next packed
fresh-apply timeout, or an isolated replay that reproduces this observation.
No goal/tier expansion or new coordination mechanism proposed.

## Follow-up

- 2026-10-22 — full local `pnpm test:packed-consumer` PASS, 313.65 s.
- 2026-10-22 — repeat [CI job 119569093003](https://github.com/vanilla-wave/rifty/actions/runs/39700601423/job/119569093003), HEAD `028db5c28`, failed at `guestFacts` called from line 333: same-ID apply, before the fresh apply. Same 120000 ms predicate timeout after build/source/control assertions. Cause still unknown; current PR investigation continues with bounded DOM/network failure diagnostics, unchanged assertions/deadlines.
