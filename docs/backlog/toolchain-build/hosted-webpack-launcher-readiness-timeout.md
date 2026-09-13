---
area: toolchain-build
status: draft
title: Diagnose hosted webpack launcher readiness timeout
created: 2026-09-13
why: the hosted Chromium gate timed out before starter selection while the unchanged isolated scenario passed
sources: [https://github.com/vanilla-wave/rifty/actions/runs/34732019153/job/103656477292, docs/backlog/playground/webpack-dev-server-starter.md]
code: [tests/e2e-hosted/webpack-dev-server.spec.ts, tests/e2e/helpers/webpack-dev-server-scenario.ts, tests/e2e/helpers/playground.ts]
---

## Question

Does the hosted scenario attempt starter selection before the second navigation's
Workbench is ready? CI at `7df33326b` timed out after 2 s clicking
`[data-action="open-launcher"]` inside `pickStarter`, before webpack execution.
The hosted spec waits for initial UI, then the shared scenario navigates again.
That is a candidate timing boundary, not an established cause or product defect.

Unchanged isolated repro: `pnpm exec playwright test --config=playwright.hosted.config.ts
tests/e2e-hosted/webpack-dev-server.spec.ts` — 1 PASS, about 1.2 min, Chromium
148.0.7778.96, Node 24.16.0. No speculative product repair. Native hosted test
uses local HTTPS `hosted.rifty.test`, not an external deployment.

Owner: browser test lifecycle. Pickup trigger: next reproduced launcher failure;
capture page/owner readiness across navigation before choosing a fix. Slow Worker
readiness is reachable under the existing MessagePort fault model. Dedup found
the separate webpack-starter contract, no matching launcher timing finding.
