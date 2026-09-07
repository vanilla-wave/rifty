# ADR 0381: Browser scoped eval compiler distribution

Status: Accepted
Date: 2026-09-07

## Context

ADR-0380 defers TypeScript until after the runtime installs Node globals.
TypeScript 5.9.3 detects `process.nextTick` + `require`, enters `getNodeSystem`,
then calls `os.platform` on the browser-mapped empty builtin. Executed packed
Chromium RED: `TypeError: c.platform is not a function`; native Node tests pass.
`setSys` is internal and runs after initialization; no browser/parser entry exists.

## Decision

Generate one ESM artifact from the unchanged, hash-pinned upstream compiler
inside a lexical IIFE: `process` and `require` are undefined locally; a local
CommonJS `module.exports` returns the real TypeScript API. Preserve its license.
No runtime eval, Blob, extra Worker or global mutation. This recreates the
browser environment in which the previously eager import succeeded (`ts.sys`
undefined); it does not provide fake fs/os implementations.

Both source and published builds import the same checked-in artifact behind
ADR-0380's lazy boundary. `tools/publishing/generate-eval-compiler.mjs` pins
TypeScript 5.9.3/source SHA and esbuild 0.28.0; `--check` verifies exact output
in CI and `pr:check`. Dependency upgrades require re-probing before pin changes.
TypeScript remains declared for the compiler types. Its parser/classifier
behavior and the guest's globals are unchanged.

## Alternatives

- Supported upstream initialization hook: absent; package browser-map only
  replaces builtins, and `setSys` is too late. Rejected by source inspection.
- Lexically browser-scoped artifact: chosen; VM/esbuild probe runs real parsing
  and transpilation with zero host require calls, preserving process identity.
- Dedicated clean Worker: viable, but adds transport, lifecycle and error
  correlation plus precomputed marker delivery for the existing sync callback.
- Temporarily mask globals across `import()`: rejected; guest code can observe
  the mutation while the chunk loads.
- tsup-only adaptation: rejected; workspace Vite source imports need the same
  carrier. Existing generated-esbuild-runtime workflow supplies the precedent.

## Proof

`tests/integration/client-bundle-browser-proof.mjs` keeps the actual packed
Worker RED for successful and failed compiler fetches. Source regression
matches generated compiler provenance as well as the legacy TypeScript input;
packed measurement tracks the emitted lazy classifier module. A missing
compiler is a failing carrier, never an empty successful graph.
