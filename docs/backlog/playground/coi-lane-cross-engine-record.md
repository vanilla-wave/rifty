---
area: playground
status: ready
title: Repair ci-cross-browser.yml, make it manual-only, run it once and record the named run's Firefox/WebKit rows in browsers.md, record-only
created: 2026-09-27
why: ci-cross-browser.yml runs weekly and is red on every run (6/6 since 2026-08-17) with nobody reading it — chromium by a workflow command bug, firefox/webkit by launcher failures; the COI row of browsers.md has no executed cell outside Chromium
epic: browser-support-floor
sources: [ADR-0469, ADR-0007, ADR-0087, D-001, docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md, docs/backlog/toolchain-build/reference/browser-honest-coverage.md]
code: [.github/workflows/ci-cross-browser.yml, playwright.config.ts]
---

## Context

Finding. `gh run list --workflow=ci-cross-browser.yml`: failure on 35584135221 (2026-09-21), 34828593376, 34103103365, 33382749764, 32690921909, 31995187173 — every weekly run. Run 35584135221: chromium `Command "test:e2e:chromium" not found` — line 39 `pnpm test:e2e${{ matrix.engine == 'chromium' && '' || format(':{0}', matrix.engine) }}`: the GitHub Actions `&&`/`||` ternary treats `''` as falsy, so chromium also gets `:chromium`; firefox/webkit: 12 failed in the ai-mode.spec launcher, 151 did not run. Expectations from probes 2026-09-16: Firefox 150 `checkSandboxSupport` coi `supported` (honours `COEP: credentialless`; `Atomics.waitAsync` since 145); ADR-0087 names "webkit/firefox SAB+SW" the historical flake source; WebKit under `credentialless` → `crossOriginIsolated: false`, `SharedArrayBuffer` undefined (all three engines probed on 127.0.0.1 and localhost; `require-corp` yields COI+SAB everywhere incl. WebKit 26.4) → COI × WebKit is `❌` by D-001, not by engine. BT-12 (`reference/browser-honest-coverage.md`) asked for this one run since 2026-06.

Needed: fix the command expression, remove the `schedule` trigger (manual dispatch only — user 2026-09-27 "пока без расписания"), get the launcher reds to a classified state, one dispatched run; classify failures (capability-missing / engine-behavior / test-infra / flake) as in the no-COI evidence file; rows → browsers.md with build + date; product reds → draft findings, never fixes here (user 2026-09-27). → I6.

## Challenge

challenge: 2026-09-28 — clear; unchanged goal FIT premise and ADR-0469 record-only decision. RDY-8: existing-behavior proof / test infrastructure; prior executed baseline in `docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md`.

## Acceptance

1. One manual-only non-gating dispatch runs explicit valid COI commands on Chromium, Firefox and WebKit. → I6
2. Reports preserve build, date, failures and classes; named-run rows land in browsers.md. → I6
3. Product failures are recorded; no product repair or COEP policy change. → I6

## Out of scope

Switching D-001 to `require-corp` (question `distribution/coi-on-webkit-require-corp`); gating; fixing reds.

## Decisions

- 2026-09-27 — record-only — user "Только записать"

- 2026-09-28 — pickup: reuse accepted evidence under RDY-8; relevant browser runs plus independent Final+GREEN; no new product promise.
