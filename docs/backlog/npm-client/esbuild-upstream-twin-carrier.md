---
area: npm-client
status: draft
title: Execute the upstream twin install and stock build scenario against Node
created: 2026-10-20
why: the fitted goal has no executable acceptance carrier
epic: esbuild-upstream-twin
sources: [docs/backlog/epics/esbuild-upstream-twin/goal.md]
code: [tests/browser-unit/esbuild-upstream-twin.spec.ts]
---

## Context

Carrier only; no runtime behavior changes. Remaining scenario rows and runtime
contracts stay on the goal map. Upstream tarballs are unmodified `npm pack`
results; version strings are the only per-version suite input.

## Challenge

challenge: 2026-10-20 — clear; reuses goal's checked premise, no scope change.

## Acceptance

1. Same stock `build.mjs` and two-file TypeScript project execute on Node 24
   and COI Chromium; install from the requested range, compare bundle bytes
   and every installed upstream twin file's SHA-256. Carrier committed as
   expected failure until the cutover; an unexpected pass fails the test. → I1
2. All three picked versions (0.21.5/0.25.12/0.28.2) use the same test and
   generate the oracle by executing upstream on Node at test time. → I5

## Reference contract

- Oracle: Node v24.16.0 + esbuild-wasm tarballs, stock Node entry.
- RED: `RIFTY_PLAYGROUND_PORT=5831 pnpm playwright test --config playwright.browser-unit.config.ts tests/browser-unit/esbuild-upstream-twin.spec.ts --grep 0.25.12`:
  Node build exits 0; Chromium install exits 1, `esbuild.version (shadow recipe
  does not admit ^0.25.0)` before the build.

## Out of scope

Product implementation; goal's remaining API/CLI/Vite/no-COI and runtime
parity rows compile at their pickup. This carrier does not close the goal.

## Decisions

- 2026-10-20 — acceptance-carrier first per RECHART; archive integrity and
  expected file hashes derived from real upstream bytes, never typed goldens.
