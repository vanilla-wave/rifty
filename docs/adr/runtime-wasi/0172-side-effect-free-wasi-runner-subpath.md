# ADR 0172: Side-effect-free WASI runner subpath

Status: Accepted
Date: 2026-06-24

> TL;DR: publish `@riftydev/runtime-wasi/wasi` as the side-effect-free same-realm runner entry; keep `./worker-entry` for kernel-spawned WASI workers

## Context

`@riftydev/runtime-wasi` already exposes two different surfaces:

- same-realm test/tool runner: `Wasi`, `WasiExit`, `runWasi` from `src/wasi.ts`;
- kernel-spawned worker entry: `worker-entry.ts`, which intentionally has a top-level
  Worker-realm side effect: read `KernelProcessSpec`, fetch the guest WASM, run it,
  and block the entry import until exit.

The package root currently re-exports both. That is fine in Node/tooling, but not
safe in a browser Worker host that only wants `runWasi`: importing the root in the
playground dev-server child also evaluates `worker-entry.ts`, whose auto-run path
sees a Worker realm and treats the host as a WASI guest entry. The TypeScript
starter's real esbuild transform bridge needs the same-realm runner inside that
Worker, not the worker-entry side effect.

This is a public package subpath, so decision-workflow rule 1 makes it irreversible.

## Decision

Add public subpath export `@riftydev/runtime-wasi/wasi` mapped to `src/wasi.ts`
and `dist/wasi.js`. It exports only `Wasi`, `WasiExit`, and `runWasi`.

`@riftydev/runtime-wasi/worker-entry` remains the entry with the top-level
kernel-process side effect. The package root remains backward-compatible, but new
browser Worker hosts that need same-realm execution must import `./wasi`.

Alternatives rejected:

- **Import package root and rely on tree-shaking.** Rejected: ESM evaluation still
  reaches re-exported modules; `worker-entry.ts` can auto-run before tree-shaking
  helps in dev/test paths.
- **Gate `worker-entry.ts` on extra env checks.** Rejected: it weakens the explicit
  worker-entry contract and risks hiding miswired kernel-spawned WASI guests.
- **Import `packages/runtime-wasi/src/wasi.ts` directly from playground.** Rejected:
  foreign package source imports bypass public API.

## Consequences

- Playground's esbuild WASI transform bridge can run the real WASIp1 binary inside
  the dev-server child without triggering the WASI worker-entry auto-run.
- Publish config and tsup build add one public entry: `./wasi`.
- Slightly larger package API surface; no new dependency and no behavior change for
  existing root or `./worker-entry` consumers.
