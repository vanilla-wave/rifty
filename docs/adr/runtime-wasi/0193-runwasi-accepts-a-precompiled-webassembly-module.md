# ADR 0193: runWasi accepts a precompiled WebAssembly.Module

Status: Accepted
Date: 2026-07

> TL;DR: widen public `runWasi(wasm)` from `BufferSource` to `BufferSource | WebAssembly.Module` so callers can compile once and re-run; detect the form by the `WebAssembly.instantiate` RESULT shape, never by realm-local `instanceof` on the input.

> Correction 2026-07-24 (ADR-0316): the Playground vendored-esbuild bridge is
> retired, so no product esbuild path consumes this API. The public
> precompiled-Module input, fresh-instance semantics, and cross-realm rationale
> remain unchanged.

## Context

The playground's esbuild transform bridge calls `runWasi` per transform. Compiling
the 19 MB esbuild.wasm each call cost 38–99 ms; V8 compiles the Module lazily
(~14 ms) and caching the compiled `WebAssembly.Module` across calls brings a
transform to 7–10 ms. `runWasi` is exported from the package root and the `./wasi`
subpath (ADR-0172), so widening its input type is a public-API change —
decision-workflow rule 1 makes it irreversible.

A naive `wasm instanceof WebAssembly.Module` branch is realm-local: a Module built
in another realm (node:vm context, structured-clone boundary between workers)
fails the check, yet `WebAssembly.instantiate()` ACCEPTS it — and for a Module
input resolves to a bare `Instance`, not `{ module, instance }`. The instanceof
branch then reads `.instance` off an Instance and runs `undefined`.

## Decision

- `runWasi(wasm: BufferSource | WebAssembly.Module, opts)` is the public form. A
  fresh instance is created per call either way — one-process-per-run WASI
  semantics are unchanged; only compilation is reusable.
- Form detection branches on the RESULT of `WebAssembly.instantiate(wasm, imports)`:
  `result instanceof WebAssembly.Instance ? result : result.instance`. The Instance
  is always created by the calling realm's `WebAssembly`, so that instanceof is
  reliable; the input never needs a realm-sensitive check.

## Consequences

- esbuild-bridge (and any repeat runner) caches one Module, re-runs cheaply.
- Cross-realm Modules (vm/structured-clone) work; pinned by a node:vm unit test
  in `wasi-run.test.ts`.
- Callers passing bytes see no change; no new subpath, no option surface growth.
