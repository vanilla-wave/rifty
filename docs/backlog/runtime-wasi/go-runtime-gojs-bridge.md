---
area: runtime-wasi
status: draft
title: Go-runtime (gojs) bridge for non-esbuild Go-WASM guests
created: 2026-06-08
why: deferred per ADR-0044 D3; ADR-0226 derives esbuild's exact browser client and embedded bootstrap instead of a generic bridge — needed only if another gojs guest appears
user_story: As a dev wanting to run a Go-WASM binary built for `js/wasm` (`gojs.runtime.*` / `syscall/js`, no WASIp1 build), I want it to execute in rifty, but today there's no `wasm_exec.js`-equivalent host shim — only WASIp1 guests run
sources: [ADR-0044 D3, ADR-0047 D3, ADR-0226, TASKS Follow-ups, REVIEW_ACTIONS A-008]
---
## Context
`esbuild-wasm` targets Go's `js/wasm` ABI, not WASIp1. ADR-0226 derives esbuild 0.28.0's exact browser CJS client, retains its embedded gojs bootstrap, and lets Worker termination own teardown; the CLI still uses `@esbuild/wasi-preview1` per ADR-0047. This is not a reusable Go runtime, so `@riftydev/runtime-go-wasm` remains moot.
## Options / Next
The bridge (`@riftydev/runtime-go-wasm`: full `syscall/js` handle protocol, `wasm_exec.js`-equivalent host shim, GC + goroutine scheduling) only matters if some *other* gojs guest with no WASIp1 build appears. Blocks nothing today. Pick up when a real Go-WASM guest shows up; multi-week design.
## Reversibility
IRREVERSIBLE when taken up — a new package + large host shim (new cross-package surface), its own ADR. Gate: a concrete gojs guest with no WASI build. Until then: do nothing.
