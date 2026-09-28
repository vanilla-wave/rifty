---
area: distribution
status: ready
title: One-URL manual protocol for real Safari 26 (macOS), iOS Safari and Yandex Browser rows in browsers.md
created: 2026-09-27
why: Playwright's WebKit is the engine, not Safari (no ITP, Lockdown, real quota, iOS memory); Yandex Browser (≈26 % RU traffic, Chromium ~150) is absent from caniuse; none can run in CI — the user runs them on own hardware (decision 2026-09-27) and browsers.md needs their dated rows
epic: browser-support-floor
sources: [ADR-0469, docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md]
code: [apps/playground/no-coi-harness.html, packages/workbench/src/support/check-sandbox-support.ts]
---

## Question

Transport and protocol. One https URL reachable from a Mac and an iPhone (deployed playground vs local tunnel — open) running `checkSandboxSupport({ persistence: 'required' })`, then boot → install → build → reload → reopen on the no-COI tier, ending in a copyable result block: engine + version (UA), per-step outcome + timing, `navigator.storage.estimate()`, memory where observable (`performance.measureUserAgentSpecificMemory` needs COI — likely unavailable; fallback: OS-level observation noted by hand), ITP/eviction note after 7 days if the user re-visits. Yandex Browser: same page, or `tools/floor-lane --executable-path` (item 7). Rows → browsers.md, dated, marked as manual runs; each row states storage estimate and per-step outcomes, memory and eviction where observable, else ❓ with the reason (iOS: no page-level memory API without COI; eviction: 7-day revisit). Closure of the epic depends on the user executing the protocol once. → I8.

## Challenge

challenge: 2026-09-28 — clear; unchanged goal FIT premise reused. Proof tooling for existing behavior (RDY-8).

## Out of scope

Device farms / BrowserStack; Android devices beyond Yandex on desktop; COI tier on iOS (❌ by D-001).

## Decisions

- 2026-09-28 — native Safari26.6.2 measured after user enabled WebDriver; SDK sequence passes, support probe remains recorded failure. Native Yandex already measured. Only physical-iOS result remains required.

- 2026-09-28 — protocol delivered at `tools/floor-lane/README.md`; native Yandex26.8 proof in browsers.md; required Safari/macOS+iOS reports remain, Safari WebDriver unavailable without user setting change.

- 2026-09-27 — in the epic, user-run — user "В эпик"

## Reference contract

Accepted goal browser-support-floor, ADR-0469; proof of existing SDK behavior.

## Acceptance

1. Execute and record the Context/Question procedure; distinguish computed, executed, product failure and unavailable harness evidence. → I8
