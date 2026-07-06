---
area: perf
subsystem: playground
status: draft
title: esbuild-wasm init dominates the vite build e2e (+30 s vs the WASI transform bridge)
created: 2026-07-07
why: vite7-build-preview e2e went 7.9 s → 37.1-37.3 s (2 runs) when ADR-0192 moved the guest esbuild JS API from the WASI transform bridge to the host esbuild-wasm service; dev boots are unaffected (lazy init keeps esbuild off the instant-preset path, m1 = 4.8 s unchanged)
user_story: As a user running `vite build` in the playground, I want the build to finish in seconds, but the first esbuild API call now pays a 13.5 MB wasm fetch + compile + Go-runtime service start inside the build child realm
sources: [docs/adr/toolchain-build/0192-real-esbuild-js-api-for-in-browser-vite-via-esbuild-wasm.md]
---
## Context
`installEsbuildBridge()` creates one lazy host instance PER CHILD REALM (`globalThis.__riftyEsbuild`); a `vite build` child initializes from zero: fetch `esbuild.wasm` (13.5 MB) → `WebAssembly` compile → gojs service start (inline `worker: false`, service pump shares the JS loop with vite build work). The retired WASI path compiled its 19 MB module once per realm too, but V8 compiled it lazily in ~14 ms (see boot-speedup #108) and each transform was a short-lived process — no Go scheduler resident on the loop.
## Options / Next
Measure the split first (fetch vs compile vs service start vs per-call): probe timestamps around `ensureInitialized()`. Then, in cost order: (a) `WebAssembly.compileStreaming` + `Cache` API for the compiled module (mirrors the WASI Module-cache trick); (b) precompile the Module in the owner and hand it to children via `initialize({ wasmModule })` (esbuild-wasm supports it; structured-clone of `WebAssembly.Module` is free); (c) nested-worker service (`worker: true`) to unshare the JS loop — REJECTED for dep-optimizer fs access in ADR-0192 probes, but the BUILD path might tolerate it (verify fs needs). Do not regress dev lazy-init (instant presets must never load the wasm).
## Reversibility
REVERSIBLE — perf-only, no API change. Judgment call recorded per decision-workflow.
