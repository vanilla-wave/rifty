---
area: toolchain-build
status: ready
title: Real-browser unit lane for cross-realm playground modules
created: 2026-07-02
epic: playground-testable-core
why: worker-side boot modules (real-vite-bootstrap 93 source-greps, dev-server-boot 44, kernel-worker-entry 5) need a real Worker+COI realm to test behaviorally — node vitest can't provide it, full Playwright e2e is the only current runner with that fabric
user_story: As a developer changing owner-worker boot wiring, I want its behavior tested against real Workers under COI without booting the whole playground UI, but today the only tier exercising page↔owner↔SW is 46 e2e specs with retry-hunt economics.
sources: [docs/process/testing.md, ADR-0196, ADR-0022, playwright.browser-unit.config.ts]
---
## Context
Requirements: COOP/COEP (SAB), module workers, OPFS; fidelity forbids mocking the owner or sibling packages — the lane runs REAL kernel/owner workers. Runner fork resolved by spike evidence → ADR-0196: thin Playwright harness (`unit-harness.html`, no App mount) on the playground vite dev server, zero new deps; vitest-browser-mode and conformance-harness-extension rejected there. Spike artifacts already in-repo: `playwright.browser-unit.config.ts`, `tests/browser-unit/{global-setup.ts,owner-boot.spec.ts}`, `apps/playground/unit-harness.html`.

## Acceptance
- Lane runs green via `npx playwright test --config playwright.browser-unit.config.ts`: dedicated port (`RIFTY_PLAYGROUND_PORT`, default 5299), `reuseExistingServer: false`, globalSetup full-owner-boot warmup (absorbs the dep-optimize reload), serial workers.
- Owner-boot fabric covered behaviorally (no App, no greps): owner `ready` handshake, pty `openSession`+`exec` round-trip, and at least one owner→page bridge contract (dev-server frame or preview publish or vfs-write ack) asserted end-to-end against the REAL owner worker.
- Wired into CI as its own lane/job (alongside heavy/light/prod) and documented as a tier in `docs/process/testing.md` (what belongs here vs node-vitest vs e2e).
- Root package.json script `test:browser-unit`; `unit-harness.html` excluded from the production build inputs (dev-server-only surface) or proven absent from `dist/`.
- RED-check: breaking the owner-ready wiring (or the asserted bridge contract) fails the lane.

## Parity cases
None — test infrastructure, no Node-API surface. The lane's own specs are the verification (Acceptance); Node-parity stays with the parity runner.

## Out of scope
- Burning down the worker-file source-grep allowlist entries (real-vite-bootstrap 93, dev-server-boot 44, vite-cli-prep 26, node-entry-bootstrap 9, build-boot 9, kernel-worker-entry 5, bundle-local-buffer 5) — rides the epic's closing gate on this lane; each conversion PR shrinks the ratchet allowlist.
- UI-component testing and App-level scenarios — e2e stays that tier (ADR-0196 consequence).
- vitest-browser-mode migration — requires superseding ADR-0196 with new evidence.

## Decisions
- Runner = thin Playwright harness, harness-page seams, lane invariants (port isolation, warmup, serial), economics: ADR-0196.
- Specs share one page/owner via fixtures when contracts are independent; fresh owner (~0.65s) where isolation matters (ADR-0196 §4).
- Module loading pattern: dynamic `import('/src/…')` inside `page.evaluate`; bare specifiers only in vite-transformed code (ADR-0196 §2).
