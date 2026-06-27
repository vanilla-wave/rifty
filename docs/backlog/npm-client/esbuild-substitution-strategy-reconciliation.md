---
area: npm-client
status: draft
title: Reconcile esbuild's three overlapping substitution paths — full-package override, file-overlay shim, and vendored-wasm WASI binding
created: 2026-06-13
why: bakedOverrides installs @esbuild/wasi-preview1@0.28.0 (pulling ~20MB wasm + JS) at node_modules/esbuild, then esbuildShimFiles overwrites its lib/main.js + package.json with a no-op passthrough, while the real transform (transformWithEsbuild) uses a separately build-time-vendored wasm and never touches the installed bytes — so the override's heavy payload is consumed by neither downstream path, and no ADR reconciles the three mechanisms.
user_story: As a developer resolving an `esbuild`-using project in rifty, I want install to not pull ~20MB of `@esbuild/wasi-preview1` bytes that get overwritten by a passthrough shim and read by nobody, but currently the full-package override stays load-bearing because nothing measured whether dropping it breaks real-Vite e2e.
sources: [ADR-0006, ADR-0027, ADR-0047, ADR-0051]
code: [tools/shadow-registry/src/index.ts, apps/playground/src/workers/real-vite-bootstrap.ts, tools/shadow-registry/src/esbuild-binding.ts]
---

## Context

Three coexisting esbuild paths: (1) full-package override redirects esbuild -> @esbuild/wasi-preview1@0.28.0, installed at node_modules/esbuild; (2) esbuildShimFiles overlay overwrites that package's lib/main.js + package.json with a passthrough after install; (3) transformWithEsbuild runs a build-time-vendored esbuild.wasm (ESBUILD_WASM_VENDOR_PATH), not the override's installed wasm. Correction to a prior framing: this is NOT a literal ADR-0027 Option C violation — Option C means installing OUR re-implementation; the override installs the REAL upstream package, which Option A contemplates. The genuine gap is the unreconciled seam between ADR-0006 swap and ADR-0027 overlay where the swap target's JS is entirely discarded, plus the ADR-0047 vendored-wasm path making the override's payload dead weight. Secondary smell: SHIM_ESBUILD_VERSION='0.21.5' contradicts the override's installed 0.28.0. devserver-esbuild-transform.md is about wiring a toy dev-server, not this reconciliation.

## Options or Next

Investigate whether the esbuild bakedOverrides entry is still load-bearing now that ADR-0047's binding exists: (a) if Vite only needs import 'esbuild' to resolve to a passthrough module, drop the heavy full-package override and synthesize node_modules/esbuild from esbuildShimFiles alone (avoids pulling ~20MB nothing reads); (b) if the override is needed for exports-map/types fidelity, document WHY the bytes are immediately overwritten and align SHIM_ESBUILD_VERSION with the override's pin; (c) record a short ADR/CHANGELOG note reconciling ADR-0006+0027+0047 for esbuild. First step: measure whether removing the override breaks real-Vite e2e.

## Reversibility

REVERSIBLE — backlog item; internal data-table + overlay wiring change, no public API surface alters. A reconciling ADR is warranted only if it overturns the recorded ADR-0006/0027 split.
