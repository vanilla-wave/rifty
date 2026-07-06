# ADR 0196: Browser-unit test lane is a thin Playwright harness on the playground dev server

Status: Accepted (2026-07-02)
Date: 2026-07

> TL;DR: The middle tier between node vitest and full e2e — real Worker + COI + OPFS behavioral tests for worker-side playground modules — is a dedicated Playwright config (`playwright.browser-unit.config.ts`, specs in `tests/browser-unit/`) driving a minimal `unit-harness.html` page (no App mount) served by the playground vite dev server; modules load via dynamic `import('/src/…')` in `page.evaluate`. No new dependencies.

## Context

Worker-side boot modules (`real-vite-bootstrap`, `dev-server-boot`, `kernel-worker-entry`) need a real Worker+COI realm to test behaviorally; node vitest can't provide it, so their contracts degraded to source-greps (epic `playground-testable-core`), and the only tier exercising the page↔owner↔SW fabric was 46 e2e specs. Candidates (backlog item): (a) vitest browser mode, (b) extend the node conformance harness, (c) thin Playwright harness. Spike evidence (2026-07-02): harness page reports `crossOriginIsolated === true` with no App/xterm/monaco mounted; `import('/src/glue/realVite.ts')` + `startWorkspaceOwner(...)` boots the REAL owner worker (ready frame + `exec('pwd')` round-trip); costs — dev-server cold start 0.7–1.3s, page load 60–75ms, owner boot→ready ~550ms, exec round-trip ~1ms, whole cold suite 5.9–7.4s.

## Decision

1. **Thin Playwright (option c).** (a) rejected: needs new deps (`@vitest/browser` + provider) with unproven COI+SAB+nested-worker maturity for this fabric, while the vite config already serves the exact COI headers production uses; (b) rejected: node has no browser realm — OPFS/SW/module-worker gaps would force mocks, violating fidelity.
2. **Harness page, not the App.** `apps/playground/unit-harness.html` replays exactly two seams from `main.tsx` (`setKernelWorkerUrl`, `setNodeEntryWorkerUrl` via `?worker&url`) and nothing else. Tests drive real modules through `page.evaluate(() => import('/src/…'))` — bare specifiers only inside vite-transformed code (harness inline script), never in evaluate bodies.
3. **Lane invariants:** dedicated port via `RIFTY_PLAYGROUND_PORT` (default 5299) + `reuseExistingServer: false` (sibling-worktree stale-server trap); `global-setup.ts` performs one full owner boot with retry-once to absorb the vite dep-optimize full-reload (page-side import alone is NOT enough — the owner worker pulls its own module graph); lane runs serial in CI (concurrent WASI boots starve the owner — same reason chromium-light is serial).
4. **Economics accepted:** ~3–4s fixed suite cost; fresh-owner-per-test ~0.65s where isolation matters; shared-owner marginal ~1ms — specs may share one page/owner via fixtures when contracts are independent.

## Consequences

- Worker-module contracts (owner boot, dev-server boot, vfs-write acks, preview publishes) become behaviorally testable below e2e; the worker-file source-grep allowlist entries get a burn-down path.
- e2e stays the end-to-end confirmation tier; this lane never boots the UI and must not accrete App-level scenarios.
- A second webServer flavor exists to keep green (config drift risk) — mitigated by reusing the playground vite config verbatim.
- If a future module genuinely needs vitest ergonomics in-browser, revisiting (a) requires superseding this ADR with new evidence.
