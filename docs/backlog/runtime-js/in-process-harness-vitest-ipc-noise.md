---
area: runtime-js
status: draft
title: installProcessGlobals() in-process under vitest leaks IPC deserialize noise
created: 2026-06-12
why: fullstack-demo-live-run.opt-in passes 8/8 but vitest's worker IPC logs "Unable to deserialize cloned data" unhandled rejections after the suite
user_story: As a rifty contributor running the fullstack-demo opt-in suite, I want clean output, but running `installProcessGlobals` in-process inside a vitest worker leaks "Unable to deserialize cloned data" rejections post-suite because the smoke isn't spawned as a separate tsx child.
sources: [ADR-0130]
code: [tests/integration/fullstack-demo-live-run.opt-in.test.ts]
---

## Context

Running the full rifty stack (installProcessGlobals + timer patches + live install + fs streams) IN-PROCESS inside a vitest worker leaves teardown-time async work whose errors cross vitest's RPC boundary and fail to deserialize — post-suite noise, tests unaffected. Known-good pattern: `vite-live-run.opt-in` spawns its smoke as a SEPARATE tsx child (`tests/integration/fixtures/real-vite-smoke.ts`) precisely to keep runtime globals out of the vitest realm.

## Options or Next

Convert `fullstack-demo-live-run.opt-in` to the spawned-child harness (extract a `fullstack-demo-smoke.ts` fixture, assert on its stdout markers + exit code). Do it the first time the noise gates anything (CI does not run opt-ins today).

## Reversibility

REVERSIBLE — test-harness layout; recorded here (also noted in the test header).
