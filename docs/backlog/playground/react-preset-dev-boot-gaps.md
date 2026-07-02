---
area: playground
status: ready
title: react-vite preset dev boot — real esbuild JS API (config bundling + dep pre-bundling)
created: 2026-07-02
why: the react-vite preset (first template with its own vite.config.ts + CJS browser deps) cannot reach LIVE — the esbuild shim fakes build() and throws on context(); ADR-0192 ratifies the real fix
user_story: As a playground user picking the React issue tracker, I want the preview LIVE like other presets, but today the vite CLI child fails config loading, and even past that the dep optimizer cannot pre-bundle CJS react
epic: ai-mode-mvp
blocked_by: []
sources: [ADR-0192, docs/adr/runtime-wasi/0047-revert-to-esbuild-wasi-forcing-consumer.md, docs/backlog/playground/react-vite-preset.md]
code: [tools/shadow-registry/src/index.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/esbuild-wasi-transform.ts, tests/e2e/react-vite-preset.spec.ts]
---

## Context

Gap chain verified 2026-07-02 (e2e + local shim-sim), design spiked and ratified
in ADR-0192 (esbuild-wasm in the host realm; WASI service mode measured and
rejected — payload/concurrency stdio deadlock, upstream-unsupported):

- **Gap A**: `vite` dev runs with `--config .rifty/vite-cli.config.mjs`; Vite's
  `bundleConfigFile` → shim `build()` transforms only the entry (no-traverse),
  so the wrapper's RELATIVE user-config import survives into
  `node_modules/.vite-temp/…` and dies: `Cannot find module '../vite.config.ts'`.
- **Gap B**: `@vitejs/plugin-react` injects `optimizeDeps.include`; the Vite 7
  optimizer calls `esbuild.context` → shim loud-throws. Independently
  react/react-dom are CJS-only — unservable without real pre-bundling
  (`esbuildDepPlugin` flat-id/browser-field/interop semantics live in JS
  plugins; no CLI mapping is honest).

## Acceptance

- Overlay shim delegates the guest-visible `esbuild` package to a host-realm
  `esbuild-wasm@0.27.7` instance per ADR-0192: real `version` (`0.27.7`), real
  `transform`/`build`/`context` (rebuild/dispose/cancel) with JS plugins
  crossing untouched; `transformSync`/`buildSync` keep loud
  `NotImplementedError`.
- `esbuild.wasm` (13.5 MB) vendored via a SHA-512-pinned fetch script (pattern:
  `fetch-esbuild-wasi.mjs`), served as a playground asset behind an
  env-configurable URL (D-004), loaded lazily on first esbuild API call — no
  cost on presets that never touch esbuild.
- Vite's transform path runs through the same esbuild-wasm instance (one
  esbuild per guest, no version skew); the per-call WASI transform bridge is
  removed from the vite path — deleted if nothing else consumes it, never left
  as dead code. The vendored `@esbuild/wasi-preview1` binary and its
  conformance surface stay (ADR-0047).
- `tests/e2e/react-vite-preset.spec.ts` un-fixme'd and green in the
  chromium-heavy lane: `pickStarter('react-vite')` → vite dev ready marker →
  preview renders the dashboard from `src/data/issues.ts` → HMR edit updates
  the preview.
- Vite honesty/regression specs updated to pin the NEW real behavior (never
  deleted, never weakened): what threw `NotImplementedError` and now works must
  assert the working behavior.
- Existing preset boots stay green (vite, typescript, vite8, node-server
  presets — the affected e2e suite passes).

## Parity cases

Same observable dev-boot behavior as real Node Vite 7 on the identical project
(local reference runs exist from the spike):

- Dep optimizer completes: guest `node_modules/.vite/deps/_metadata.json`
  exists; the react chunk is ESM with `needsInterop: true` — same metadata
  shape as the local Node run.
- User `vite.config.ts` (TypeScript, `@vitejs/plugin-react`) loads: transformed
  `src/main.tsx` served to the preview contains the react-refresh preamble,
  as locally.
- `npm run build` of the react-vite template inside rifty exits 0 (esbuild
  minify + config path; extends the existing vite build honesty coverage).

## Out of scope

- Routing the esbuild JS API through `runWasi`/service mode — measured
  deadlock, upstream-unsupported (ADR-0192); any such attempt is a regression.
- BrowserRouter deep links under the path-prefixed preview
  (`/preview/<port>/issues/3`) — a preview-model question, NOT an esbuild one;
  the e2e here asserts in-app navigation. If direct-URL sub-route entry fails
  once boot works, that is a separate finding item against the preview model.
- Guest tools pinning other esbuild versions — single-host-instance model per
  ADR-0192; revisit only when a real consumer breaks.

## Decisions

- Mechanism, pin (0.27.7), vendoring, lazy init, ADR-0047 scope: ADR-0192.
- esbuild-wasm initialization uses a nested worker (`worker: true`) so guest
  code keeps the owner event loop free during bundling; `wasmModule`/URL choice
  is implementation detail.
- The shim exposes the host instance through one `globalThis` bridge installed
  by `vite-cli-prep` alongside the existing overlay machinery — same wiring
  seam as today's `__riftyEsbuildTransform`.
