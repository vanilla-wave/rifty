# esbuild JS API compatibility

Public claim surface for the guest-visible `esbuild` package after ADR-0192: the
install-time shadow-registry shim delegates the whole JS API to a real
`esbuild-wasm` instance (exact-pinned 0.28.0) in the host worker realm. Guest and
host share the realm, so options, results, and JS plugin callbacks cross
untouched. The ADR-0047 WASI binary remains the CLI-conformance surface
(`.bin/esbuild`), not the JS API backend.

Legend: ✅ implemented and tested · ⚠️ routed honestly but not exhaustively covered ·
❌ not implemented (throws `NotImplementedError` or a loud upstream error).

| Surface | Status | Notes / tests |
|---|---:|---|
| `transform` | ✅ | Real esbuild-wasm service; Vite's transform path uses the same instance as `build`/`context` (no version skew). `apps/playground/src/workers/esbuild-host.test.ts`. |
| `build` (incl. JS plugins) | ✅ | `write: true` builds: outputs written to the VFS by the host bridge (esbuild-wasm rejects `write: true` in browsers) — plugin-invisible: `initialOptions.write` reads as the caller passed it, user `onEnd` hooks run with files already on the VFS and a native result shape (no `outputFiles`); no-outfile builds write nothing, matching native; relative `outdir`/`outfile` resolve against the guest cwd. `esbuild-host.test.ts` plugin suite, `tests/browser-unit/esbuild-host-real-wasm.spec.ts`, `tests/e2e/vite7-build-preview.spec.ts`. |
| `context` — `rebuild` / `cancel` / `dispose` | ✅ | `rebuild` outputs written to the VFS same as `build`. |
| `formatMessages` / `analyzeMetafile` | ✅ | Delegated to the host instance. |
| `initialize` | ✅ | Node-parity guards: browser-only options (`wasmURL` / `wasmModule` / `worker`) rejected; second call throws. |
| `stop` | ✅ | Next API call re-initializes (service-restart parity). |
| `version` | ✅ | Reports the host esbuild-wasm version (0.28.0) — never an invented string. |
| `transformSync` / `buildSync` / `formatMessagesSync` / `analyzeMetafileSync` | ❌ | `NotImplementedError` — esbuild-wasm exposes no synchronous API in a browser realm. |
| `context(...).watch()` | ❌ | Default/`write: true` contexts throw `NotImplementedError('esbuild.context.watch.write')` — watched-rebuild output writes are not normalized to the VFS yet (`docs/backlog/playground/esbuild-context-watch-write-normalization.md`). Explicit `write: false` contexts hit esbuild-wasm's own loud browser ceiling. |
| `context(...).serve()` | ❌ | Delegated raw; esbuild-wasm's browser build throws `Cannot use the "serve" API in this environment`. |
