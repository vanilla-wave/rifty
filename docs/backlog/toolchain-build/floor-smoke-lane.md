---
area: toolchain-build
status: ready
title: Floor-smoke lane — execute boot → install → build → reload → reopen on Chrome 108, Firefox 115 and WebKit 26.0 builds
created: 2026-09-27
why: every lane runs the current Playwright bundle (1.60 → Chromium 148 / Firefox 150 / WebKit 26.4); the computed floors 108 / 115 / 26.0 were never executed, so "works from version X" is a calculation
epic: browser-support-floor
sources: [ADR-0469, docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md]
code: [playwright.no-coi.config.ts, package.json]
---

## Question

Carrier for a floor-smoke on old engine builds. Facts: Playwright bundles map one browser build per release (Chromium 108 ≈ 1.28, Firefox 115 ≈ 1.36, WebKit 26.0 ≈ 1.55–1.56 — confirm via each release's `browsers.json`); a current runner cannot drive an old Firefox (patched juggler protocol changes), CDP compatibility of a current runner with Chromium 108 is unverified. Candidates: (a) isolated `tools/floor-lane/` with one pinned old `@playwright/test` per engine and a minimal smoke spec (boot → install → build → reload → reopen against the no-COI host; COI variant on Chromium only); (b) old browser binaries + current runner via `executablePath` where the protocol allows. Trigger: on demand (floor change, Playwright bump) — never per PR, never scheduled, never a release gate (user 2026-09-27). Output rows in browsers.md with build + date: `✅N`; `❌ + failing step` only for a product failure; `❓ + reason` when the harness cannot launch that build (never a product ❌). The same lane's `--executable-path` mode serves `distribution/real-browser-manual-protocol` (Yandex Browser). → I7.

## Challenge

challenge: 2026-09-28 — clear; unchanged goal FIT premise reused. Proof tooling for existing behavior (RDY-8).

## Out of scope

Intermediate versions (monotonic APIs; per-device truth is `checkSandboxSupport`); gating; real Safari (item 8).

## Decisions

- 2026-09-27 — smoke, not the full suite; on demand only — agent + user "пока без расписания"

## Reference contract

Accepted goal browser-support-floor, ADR-0469; proof of existing SDK behavior.

## Acceptance

1. Execute and record the Context/Question procedure; distinguish computed, executed, product failure and unavailable harness evidence. → I7
