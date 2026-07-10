---
area: npm-client
status: draft
title: Does the `esbuild` full-package override (~20MB WASI wasm) still earn its install cost post-ADR-0192?
created: 2026-06-13
why: bakedOverrides installs @esbuild/wasi-preview1@0.28.0 (~20MB wasm) at node_modules/esbuild, then the ADR-0188 alias files replace its package.json + lib/main.* with the ADR-0192 shim delegating the whole JS API to the host esbuild-wasm instance — so the guest JS API consumes none of the override's bytes, and nothing measured whether any remaining consumer (CLI conformance) reads the INSTALLED wasm rather than the build-time-vendored copy.
user_story: As a developer resolving an `esbuild`-using project in rifty, I want install to not pull ~20MB of `@esbuild/wasi-preview1` bytes if nothing reads them, but the override stays load-bearing until something measures whether dropping it breaks real-Vite e2e or the CLI-conformance surface.
sources: [ADR-0006, ADR-0027, ADR-0047, ADR-0188, docs/adr/toolchain-build/0192-real-esbuild-js-api-for-in-browser-vite-via-esbuild-wasm.md]
code: [tools/shadow-registry/src/index.ts, apps/playground/src/workers/esbuild-host.ts, tools/shadow-registry/src/esbuild-binding.ts]
---

## Context

Post-ADR-0192 the guest `esbuild` package = shadow shim → host `esbuild-wasm`
(playground-bundled 13.5MB asset, lazy-loaded): `transform`/`build`/`context`
real, exact-pinned 0.28.0 in lockstep with the override trigger (the old
`SHIM_ESBUILD_VERSION` 0.21.5-vs-0.28.0 smell is resolved; ADR-0188's exact-pin
range loud-throws on drift). The ADR-0047 WASI binary keeps its CLI-conformance
role via the build-time-vendored copy (`ESBUILD_WASM_VENDOR_PATH`). What REMAINS
unreconciled: the bakedOverrides entry still downloads `@esbuild/wasi-preview1`'s
~20MB tarball into every tree whose install resolves `esbuild`, while the alias
files immediately replace its JS entry — the installed wasm's only plausible
reader is a guest-side `.bin`/CLI path, and nobody verified one exists.

## Options or Next

Measure whether the installed override bytes have any reader: (a) if none, drop
the heavy full-package override and synthesize `node_modules/esbuild` from the
alias files alone (the delegating shim needs no upstream bytes); (b) if a guest
CLI path reads `node_modules/esbuild/esbuild.wasm`, document that as the
override's sole purpose next to the bakedOverrides entry; (c) record a short
note reconciling ADR-0006+0027+0188+0192 for esbuild. First step: remove the
override locally and run the real-Vite e2e + the esbuild CLI-conformance
surface.

## Reversibility

REVERSIBLE — backlog item; internal data-table + overlay wiring change, no public API surface alters. A reconciling ADR is warranted only if it overturns the recorded ADR-0006/0027 split.
