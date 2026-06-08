---
area: runtime-wasi
status: parked
title: Go-runtime (gojs) bridge for non-esbuild Go-WASM guests
created: 2026-06-08
why: deferred per ADR-0044 D3; moot for esbuild (ADR-0047 runs the real WASIp1 build) — needed only if another gojs guest with no WASI build appears
sources: [ADR-0044 D3, ADR-0047 D3, TASKS Follow-ups, REVIEW_ACTIONS A-008]
---
## Context
`esbuild-wasm` (0.21.5/0.25.0/0.28.0) targets Go's `js/wasm` ABI (`gojs.runtime.*` / `gojs.syscall/js.*`), NOT WASIp1. But esbuild no longer needs a gojs bridge — rifty runs the separate `@esbuild/wasi-preview1` WASIp1 build on the existing shim (ADR-0047 reverses ADR-0044's premise). So the multi-week Go-runtime bridge is currently moot.
## Options / Next
The bridge (`@riftydev/runtime-go-wasm`: full `syscall/js` handle protocol, `wasm_exec.js`-equivalent host shim, GC + goroutine scheduling) only matters if some *other* gojs guest with no WASIp1 build appears. Blocks nothing today. Pick up when a real Go-WASM guest shows up; multi-week design.
## Reversibility
IRREVERSIBLE when taken up — a new package + large host shim (new cross-package surface), its own ADR. Gate: a concrete gojs guest with no WASI build. Until then: do nothing.
