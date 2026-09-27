---
area: distribution
status: draft
title: Publish docs/public/compat/browsers.md — mode × persistence × engine floors with the ADR-0469 legend and the traffic-share ratio
created: 2026-06-08
why: docs/public/compat/README.md promises browsers.md "with first cross-browser CI run"; floors are now computed and partly executed, the legend is decided (ADR-0469), the file still does not exist
user_story: As a host engineer, I want one table telling me per browser and version whether COI and non-COI run and what share of traffic that is, but today the answer is spread over a research note, two contradicting scope docs and a chromium-only CI
epic: browser-support-floor
sources: [ADR-0469, ADR-0007, D-001, docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md, docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md]
code: [docs/public/compat/README.md, tools/compat-matrix-generator/cli.js]
---

## Context

Finding. Predecessor `service-worker/cross-browser-compat-matrix` (created 2026-06-08, moved here 2026-09-27 — engines are not a service-worker concern; history on the old path). Its blocker "the cross-browser cron never ran" is half-lifted: the no-COI lane ran on three engines 2026-09-16.

Matrix v1 content, all from the two evidence files:
- axes: mode (COI, non-COI) × persistence (ephemeral = memory VFS, persistent = OPFS replica; `opfs` required only under `persistence: 'required'`, `report.ts:71`; default `'preferred'` falls back to memory, ADR-0372) × engine.
- non-COI persistent floors: Chrome/Edge 110 (`toSorted`; `108` computed once `toolchain-build/es-floor-guard` lands — v1 publishes 110 with that note), Firefox 115 (`toSorted` > module workers 114 > `DecompressionStream` 113 > OPFS 111), Safari/iOS 26 (`createWritable`), Chrome Android 110, Samsung 21, Opera 96, Yandex ≈ Chromium ~150 (not in caniuse); non-COI ephemeral (memory VFS, no OPFS requirement), derived per capability at pickup — provisional: Chrome ≈ 98 (`structuredClone`) after item 2, Firefox 114 (module workers), Safari/iOS 16.4 (`DecompressionStream`); the Safari cell is published as `❌` with the P1 reason (today the shape selects OPFS and loses data) until `vfs/opfs-createwritable-capability-gate` lands, then `16.4`; COI adds Firefox 145 (`Atomics.waitAsync`, probe requires it), Safari/iOS ❌ (D-001 `credentialless`, WebKit ignores it), Web Locks / nested workers / SW non-binding.
- executed rows, each naming its run: Chromium 148 `✅` (no-COI lane 100/100, `playwright test --config <3-engine no-coi config> --project=chromium`, 2026-09-16, evidence §Spec × engine), Firefox 150 `✅` (99/100, same command `--project=firefox`; the red is the version-pinned oracle, test-infra), WebKit 26.4 `⚠` (41/100 under Playwright's ephemeral context — 55 test-infra: no OPFS root; the product red earning ⚠ is the 13-test `NotImplementedError('sandbox.toolchain.worker')` misreport = I4; `checkSandboxSupport` there unmet `["opfs"]`; `replica-storage` + `opfs-reload` re-run green under `launchPersistentContext`; 57 specs unobserved; engine build, not Safari).
- binding-requirement table per capability (BCD 8.0.13), non-version cut-off rows (secure context; CSP `unsafe-eval` — Chromium ✅, FF/WebKit ❓; Firefox Private Browsing ❌ OPFS; Safari Lockdown ❌ Web Locks; ITP eviction; mobile memory ❓), and the predecessor's capability row: transferable `ReadableStream` (SSE fast path) Chromium ≥89 / Firefox ≥103 / Safari ≥16.4 with the buffering fallback (`packages/service-worker/src/body-transport.ts`).
- share, computed at pickup: numerator = versions ≥ floor per mode × persistence, denominator = all tracked traffic (caniuse-lite usage weights, fresh copy, global and RU); caveats: RU tracked sum ≈ 67 % (Yandex Browser absent), StatCounter cross-check (§4 of the research). The research's 96.7 / 97.8 % are over an external host's browserslist and are cited only as such.
- rows later slices fill: after item 2 — Chrome/Edge `110 → 108`, Chrome Android `110 → 109`, Opera `96 → 94`, Firefox `115 → 114`; `✅108/114/26.0` (floor-smoke), COI cross-engine, real Safari / iOS / Yandex. Every executed cell names its run (run id or command), build and date; nothing scheduled.

Also carries the ADR-0469 correction of `AGENTS.md` if not yet merged. The `docs/public/compat/README.md` index entry goes through `tools/compat-matrix-generator/cli.js` (`check:compat-drift` diffs the README), never a hand edit. Hand-maintained; every cell dated. → I1, I9.

## Challenge

<!-- Premise checked at goal FIT 2026-09-27 (goal.md §Challenge); recheck at PICKUP only for changed promises. -->

## Out of scope

Generated matrix (rejected route, goal §Decisions); the Node-module matrices already in `docs/public/compat/`.

## Decisions

- 2026-09-27 — moved from `service-worker/` (area mismatch); predecessor content superseded by goal evidence — trace: none
