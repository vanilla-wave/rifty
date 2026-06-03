# ADR 0007: Chrome-first with cross-browser infrastructure from M0 (D-006)

Status: Accepted
Date: 2026-05

Summary of decision D-006. Chromium is the primary target. Firefox/WebKit are best-effort and the testing infrastructure for them ships from M0 — flipping the matrix on in CI is a one-line workflow change.

## Infrastructure (M0)

- `playwright.config.ts` with `chromium`, `firefox`, `webkit` projects (all three present from day one).
- npm scripts: `test:e2e` (chromium-only, default), `test:e2e:all`, `test:e2e:firefox`, `test:e2e:webkit`.
- `postinstall` installs all three browsers via `playwright install`.
- A cross-browser workflow `ci-cross-browser.yml` runs weekly via cron + manual trigger; default `ci.yml` runs only chromium.

## Capabilities detection

`@riftydev/runtime-js/env/capabilities` checks `crossOriginIsolated`, `SharedArrayBuffer`, `Atomics.waitAsync`, `FileSystemFileHandle.prototype.createSyncAccessHandle`, and surfaces a feature-vs-engine report at boot. Acceptance criteria for M1 explicitly require this UI fallback.

## What we will not do

- Block PRs on cross-browser failures.
- Add Chrome-specific feature checks (`if (isFirefox)`). Always use feature detection.
- Hand-tune the UI for pixel-perfect cross-browser parity — out of scope for a pet project.
