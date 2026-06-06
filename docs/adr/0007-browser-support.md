# ADR 0007: Chrome-first with cross-browser infrastructure from M0 (D-006)

Status: Accepted
Date: 2026-05

Decision D-006: Chromium is the primary target; Firefox/WebKit are best-effort. Cross-browser test infrastructure ships from M0, so enabling the full matrix in CI is a one-line workflow change.

## Infrastructure (M0)

- `playwright.config.ts`: `chromium`, `firefox`, `webkit` projects all present from day one.
- npm scripts: `test:e2e` (chromium-only, default), `test:e2e:all`, `test:e2e:firefox`, `test:e2e:webkit`.
- `postinstall` installs all three browsers via `playwright install`.
- `ci-cross-browser.yml`: weekly cron + manual trigger. Default `ci.yml` runs chromium only.

## Capabilities detection

`@riftydev/runtime-js/env/capabilities` checks `crossOriginIsolated`, `SharedArrayBuffer`, `Atomics.waitAsync`, and `FileSystemFileHandle.prototype.createSyncAccessHandle`, surfacing a feature-vs-engine report at boot. M1 acceptance criteria require this UI fallback.

## What we will not do

- Block PRs on cross-browser failures.
- Add Chrome-specific feature checks (`if (isFirefox)`) — always use feature detection.
- Hand-tune the UI for pixel-perfect cross-browser parity (out of scope for a pet project).
