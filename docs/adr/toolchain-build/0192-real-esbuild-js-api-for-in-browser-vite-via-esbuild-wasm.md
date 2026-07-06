# ADR 0192: Real esbuild JS API for in-browser Vite via esbuild-wasm

Status: Active
Date: 2026-07

> TL;DR: the `esbuild` package a rifty-hosted Vite sees is the REAL official
> `esbuild-wasm` (gojs build, exact-pinned 0.28.0, wasm vendored) initialized in
> the host worker realm; the guest shim delegates the whole JS API to it —
> `transform`/`build`/`context` with JS plugins all real. Supersedes ADR-0047's
> "build() must run through `runWasi` or throw" consequence; ADR-0047's esbuild
> WASI vendoring + forcing-consumer role is unchanged.

## Context

The react-vite preset (epic `ai-mode-mvp`) is the first template with a user
`vite.config.ts` and CJS-only browser deps (react/react-dom). Two loud shim
ceilings block Vite 7 dev boot (`docs/backlog/playground/react-preset-dev-boot-gaps.md`):
config bundling (`esbuild.build({bundle:true})`) is transform-only and drops the
wrapper's relative user-config import, and the dep optimizer's `esbuild.context`
throws `NotImplementedError`. Both callers pass **JS plugins**
(vite's `externalize-deps`/file-scope injection; `esbuildDepPlugin` flat-id +
browser-field + interop-metadata resolution) — semantics a CLI flag mapping
cannot reproduce honestly; a faithful fix must run the real esbuild JS API.

Spike (2026-07-02, /tmp preserved in PR notes) measured the two real-API routes:

- **WASI service mode** (vendored `@esbuild/wasi-preview1` + real esbuild JS lib,
  `--service` protocol over spawned stdio): handshake, plugins, and `vite dev`
  work — but a payload/concurrency stdio deadlock is 100 % reproducible
  (single 512 KB transform 4/4, 2×64 KB concurrent 3/3, `vite build` 2/2 hang
  at chunk minify). Upstream calls the WASI binary "not tested and won't be
  officially supported" (esbuild v0.22.0 changelog, issue #3300). A time bomb at
  real app sizes.
- **`esbuild-wasm`** (official gojs browser build): `build()`/`context()` with
  plugins pass every probe including the WASI killers (512 KB, 1 MB, 8×64 KB
  concurrent); vite@7.3.6 dev AND build run green end-to-end against react@19 +
  `@vitejs/plugin-react` with `node_modules/esbuild` re-exporting it. Runtime is
  self-contained (embedded wasm_exec; needs only crypto/performance/TextEncoder —
  all present in workers); `initialize({wasmModule|wasmURL, worker})` supports a
  nested worker or inline pump. Asset: `esbuild.wasm` 13.5 MB.

`esbuild-wasm@0.28.0` satisfies vite@7 (7.3.6 declares `esbuild: ^0.27.0 ||
^0.28.0`) and matches the `@esbuild/wasi-preview1@0.28.0` trigger pin — guest
JS API version claim, host instance, and CLI binary move in lockstep (coupling
pinned by esbuild-host.test.ts + the shadow-registry exact-pin range).

## Decision

- Back the guest-visible `esbuild` package with **real `esbuild-wasm`, pinned
  exactly 0.28.0**, initialized once per owner worker in the HOST realm (guest
  and host share the realm — plugin callbacks cross untouched). The overlay shim
  becomes a delegation to the host instance: `transform`, `build`, `context`
  (rebuild/dispose/cancel), `version` — the real surface, no fakes, no invented
  version strings. API members esbuild-wasm itself does not provide in browsers
  (`transformSync`, `buildSync`) keep loud `NotImplementedError` throws.
- **One esbuild per guest**: the vite transform path moves off the per-call WASI
  CLI bridge onto the same esbuild-wasm instance — no version skew between
  `transform` (was the 0.28.0 WASI binary behind a transform-only facade) and `build`/`context`.
- **Ship the wasm from the host bundle**: `esbuild-wasm` is an exact-pinned
  playground devDependency (lockfile-hermetic — unlike the guest-served WASI
  binary, no repo vendoring needed); its `esbuild.wasm` is emitted as a bundled
  asset (`?url` import), so no runtime external URL exists (D-004), loaded
  lazily on first esbuild API use (never on preset boot path).
- **ADR-0047 scope**: vendoring `@esbuild/wasi-preview1` and its role as the
  WASI-infra forcing consumer (CLI conformance, shell `esbuild` binary) stay.
  Only its consequence "dep-prebundle bundling must run through `runWasi` too or
  throw" is superseded — the WASI route is upstream-unsupported for the service
  protocol and demonstrably deadlocks.

## Consequences

- Vite 7 dep pre-bundling (CJS interop, browser fields, metafile-driven
  `needsInterop`) and user `vite.config.ts` bundling behave as on real Node —
  react/@vitejs/plugin-react apps become runnable; the honesty specs pinning the
  old loud throws must be updated to pin the new REAL behavior.
- +13.5 MB vendored binary (precedent: 19.2 MB WASI esbuild) and a second
  vendored esbuild version to bump in lockstep with vite majors.
- Per-call WASI process spawn disappears from the vite transform path
  (esbuild-wasm keeps a persistent service); the WASI esbuild binary remains
  exercised by its own conformance surface, not by vite.
- If a future guest tool pins a different esbuild version with breaking API
  drift, the single-host-instance model needs revisiting (per-version
  instances) — record then, not now.
