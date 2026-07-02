---
area: toolchain-build
status: draft
title: Real-browser unit lane for cross-realm playground modules
created: 2026-07-02
epic: playground-testable-core
why: worker-side boot modules (real-vite-bootstrap 79 source-greps/23 its, dev-server-boot, kernel-worker-entry) need a real Worker+COI realm to test behaviorally — node vitest can't provide it, full Playwright e2e is the only current runner with that fabric
user_story: As a developer changing owner-worker boot wiring, I want its behavior tested against real Workers under COI without booting the whole playground UI, but today the only tier exercising page↔owner↔SW is 46 e2e specs with retry-hunt economics.
sources: [docs/process/testing.md, ADR-0022, vitest.workspace.ts]
---
## Context
Requirements: COOP/COEP (SAB), module workers, OPFS. Fidelity rule forbids mocking the owner or sibling packages — the lane must run REAL kernel/owner workers. Near-tier already exists: packages' real-Worker conformance tests (kernel spawnWorker) — possibly extendable instead of a new runner. vitest is a workspace (`vitest.workspace.ts`, all projects `environment: node`; playground has own config) — a browser-mode project would be a new entry.
## Options / Next
- Spike FIRST, pick on evidence: (a) vitest browser mode (chromium provider) + COI headers; (b) extend the existing real-Worker conformance harness; (c) thin Playwright page loading modules directly (no App). Criteria: COI actually available, flake profile (concurrent WASI boots starve the owner — lane likely serial like chromium-light in CI), CI wall-clock cost.
- Out of scope: replacing e2e (stays the end-to-end confirmation tier); testing UI components here.
