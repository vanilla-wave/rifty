---
area: runtime-js
status: ready
title: Retire the generated esbuild client from no-COI execution
created: 2026-10-20
why: Isolated children can run the upstream client but installed esbuild still selects legacy
user_story: As a no-COI SDK developer, I want installed esbuild to run its upstream Node client
epic: no-coi-child-processes
blocked_by: []
sources: []
code: []
---

## Context

The user keeps the shared COI client for the separate upstream-twin goal.
Remove only no-COI activation and reachable generated-client code; preserve
installed-package behavior, Vite build/rebuild and COI adapter behavior.

## Challenge

challenge: 2026-10-20 — inherited accepted goal and explicit no-COI-only amendment.

## Acceptance

1. Installed esbuild transforms twice with Node output; no legacy realm slot or loaded generated client. Carrier: `tests/no-coi/no-coi-esbuild-retirement.spec.ts`. → I3
2. Packed toolchain boot/execution graph excludes the generated client; public packed SDK still runs helpers and upstream transforms. Carriers: `tests/integration/no-coi-esbuild-graph-proof.mjs`, `tests/integration/no-coi-child-browser-proof.mjs`. → I3
3. Existing Vite build/rebuild remains usable through real SW children; shared COI client retained. Carriers: `tests/no-coi/no-coi-agent-installed-cli.spec.ts`, existing esbuild browser contract. → I3

## Reference contract

Node v24.16.0 + untouched esbuild-wasm 0.28.0 archive; same transform source.
Existing installed Vite 7.3.6 scenario remains the regression baseline.

## Parity cases

1. Installed alias transform and repeated fresh invocation equal native Node stdout/stderr/status. → I3

## Out of scope

COI upstream cutover; expanding the exact-version installation recipe;
synchronous child processes; worker_threads.

## Decisions

- ready-verdict: 2026-10-20 — Contract+RED @ 09be0e47178a079b4cac4d1c40656af957570583

- 2026-10-20 — explicit user amendment keeps the shared COI client; I3 retires no-COI debt only.
