---
area: npm-client
status: draft
title: Guest processes see NAPI_RS_FORCE_WASI=1 only where a napi-rs loader needs it
created: 2026-10-16
why: dev-server children and `.bin/vite` spawns get `NAPI_RS_FORCE_WASI=1` in their guest-visible env with no deciding record; Rolldown 1.0.3's generated loader already falls back to its WASI binding when no native binding loads, so the injection may be unnecessary and is an env key real Node does not set
user_story: As a developer printing `process.env` in a Vite 8 project, I want the environment Node would give me, but today rifty adds `NAPI_RS_FORCE_WASI=1` for reasons nobody recorded
blocked_by: []
sources: [ADR-0534, ADR-0336, ADR-0384, docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md]
code: [tools/shadow-registry/src/runtime/launch.ts, tools/shadow-registry/src/runtime/vite-cli-prep.ts]
---

## Context

Found 2026-10-16 by the inventory sweep (goal `honest-guest-package-adaptations`
I3; launch-preparation row). `preparePackageServerEnvironment` adds the key to
every dev-server child (`launch.ts`); `prepareViteBinSpawnRequest` adds it to
`.bin/vite` spawns; the code comment cites ADR-0051/0162, neither of which
decides it; ADR-0336 uses it as its real-Node probe protocol only. Rolldown 1.0.3
`dist/shared/binding-*.mjs`: `nativeBinding = requireNative(); if (!nativeBinding
|| process.env.NAPI_RS_FORCE_WASI) { … require('@rolldown/binding-wasm32-wasi') }`
— without the key the loader still reaches the WASI binding after the native
attempts fail. Declared since 2026-10-16 (ADR-0534, kill condition = this
item). First step: run the Vite 8 build/dev/preview lanes and a napi-rs-loaded
package without the key; then remove it.

## Challenge

challenge: 2026-10-16 — not run (draft)
