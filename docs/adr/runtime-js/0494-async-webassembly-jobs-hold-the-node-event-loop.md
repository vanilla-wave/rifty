# ADR-0494: Async WebAssembly jobs hold the Node event loop

- Status: accepted
- Date: 2026-10-01
- Extends ADR-0152's handle classes; streaming ceilings (ADR-0158) unchanged.

## Context

Real Vitest starts three WebAssembly.compile jobs; the unreferenced browser jobs
are still pending when Node-entry drains and exits 0 silently. Native Node
v24.16.0 prints detached compile/instantiate completions before EXIT 0. Executed
native-job RED: activeRefs 0 instead of 2 (`wasm-keepalive.test.ts`).

## Decision

compile/instantiate acquire the existing realm ref, release when the returned
native promise settles. Return a settlement chain preserving values/rejections;
a caller catch remains handled, an uncaught rejection reaches the existing trap.
No CLI source patch or generic promise interception.

## Alternatives

- Track Vitest's exported/action promise: rejected by I4/general runtime constraint.
- Count every promise: rejected; promises alone do not hold Node's event loop.
- Track only native WebAssembly compile/instantiate jobs: chosen by the live trace.

## Proof

Native-job regression, same Node/Chromium scenario, real Vitest config/run e2e.
