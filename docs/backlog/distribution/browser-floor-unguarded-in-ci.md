---
area: distribution
status: draft
title: Nothing executable in CI holds the ADR-0469 Chromium 108 floor; a post-floor read lived two months unseen
created: 2026-11-26
why: CI runs only fresh Chromium (148); the static `check:es-floor` is incomplete by construction, so a product read of a Chrome 109+ feature reaches `main` and is found only by a chance 108 run
sources: [docs/adr/distribution/0469-browser-support-tiers-and-evidence-legend.md, docs/adr/toolchain-build/0477-pinned-browser-floor-proof-runners.md, docs/backlog/runtime-js/reference/chromium108-workbench-owner-boot-evidence.md, docs/backlog/distribution/chromium108-coi-browser-unit-reds.md, .github/workflows/browser-floor.yml]
code: [tools/checks/es-floor.mjs, tools/floor-lane/run.mjs, tests/browser-unit/message-port-ref-keepalive.fault.spec.ts]
---

## Context

Facts (PR #470):
- `ArrayBuffer.prototype.detached` (Chrome 114) was read at every runtime-js realm's install from
  `71be444c1` (2026-09-23); still on `main`, removed by #470 (open; fix `3b4cbbe49`, 2026-11-26). On
  Chromium 108 the Workbench owner exits at boot; `check:es-floor` passed with the read in the bundles.
  Found by the node-streams carrier's one-off 108 run (PR #467), not by CI.
- Every gating CI browser lane runs Playwright 1.60's Chromium 148. `browser-floor.yml` (ADR-0477:
  pinned runners, macOS 14, manual dispatch, record-only) runs the no-COI SDK protocol, which on 108
  fails earlier at SDK import (`runtime-js/chromium108-sdk-sync-wasm-import`), so it cannot see a
  Workbench-only regression.
- `check:es-floor` (static, shipped bundles) is incomplete by construction; its header lists the
  read forms it does not see (`getOwnPropertyDescriptors`, `__lookupGetter__`, a receiver from an
  instance, a run-time key, a pass-through wrapper). Its list covers ES builtins only, not Web APIs
  (e.g. ReadableStream async iteration, Chrome 124, in fetch: `chromium108-coi-browser-unit-reds`).
- One executable guard exists for one module: the port-ref fault spec deletes
  `ArrayBuffer.prototype.detached` in the page realm on fresh Chromium before importing
  `message-port-ref.ts` — on Chromium 148: red with `main`'s file and with three other read forms
  (`__lookupGetter__`, `getOwnPropertyDescriptors(...).detached.get`, the prototype of an instance);
  table in `runtime-js/reference/chromium108-workbench-owner-boot-evidence.md` §Executable floor guard.
- ADR-0469: "supported — Chromium: gating CI lanes; a regression blocks merge"; the floor build is
  not among those lanes.

## Question

Which executable floor guard, if any, should CI run — owner: user (CI cost)?

Candidates, not chosen:
1. Smoke lane on real Chromium 108: Workbench owner boot + one `node` program (the port-ref fault
   spec is 3 cases). Timed once locally (macOS arm64, 2026-11-26; evidence §Executable floor guard):
   `npm install playwright@1.28.1` 2 s, `chromium-1033` install under Node 18.20.8 60 s (343 MB),
   the 11 port-ref cases on 108 22.3 s with a cold dev server. #467/#470 drove the old binary with
   Playwright 1.60; ADR-0477 §Alternatives rejected "current runner plus old executable" for the floor
   proof ("explicit executable-path remains for a caller's Chromium-compatible browser, identified by
   its observed build") — which runner a gate would use is open. Availability of `chromium-1033` on
   the CI image (`ubuntu-24.04`, pinned in `ci.yml`; trap `playwright-host-image`) not measured; on
   `macos-14` minutes bill at the macOS rate.
2. "Floor simulation" on fresh Chromium: delete each listed post-floor feature before any rifty
   code runs, in every realm. The page realm is one `page.evaluate` (done for one module above).
   Owner/child/Worker realms start from rifty's own worker scripts; reaching them before their first
   import needs a pre-entry hook in every worker bootstrap, or a Playwright init script per worker
   (not available for dedicated Workers in Playwright 1.60 — not verified). It sees only features
   one can delete; engine behaviour differences (URL IDNA, Error clone, stack text) stay invisible.

Not decided here: whether the static list should also carry Web APIs.

Related: one-off floor runs inside units — `runtime-js/stream-core-node-sources` ("the Chromium 108
lane"), `runtime-js/zlib-node-lib-port` (manual floor-lane run in its PR).
