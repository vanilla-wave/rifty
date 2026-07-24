# ADR 0226: Upstream-derived Vite esbuild runtime over guest VFS

Status: Accepted
Date: 2026-07

> TL;DR: derive one runtime from esbuild-wasm 0.28.0's exact browser CJS client; change only its environment and named capability gates, then publish its exact outer object. No API facade.

> Correction 2026-07-24 (ADR-0316): D6's “vendored WASI CLI remains” clause is
> superseded. The exact preview1 package is an explicit test/showcase guest;
> registry-attested esbuild-wasm is the sole product runtime. D1–D5 stand.

## Context

The current shim runs real WASI `transform`, one single-module `build({write:false})`, and an empty context. Vite config graphs and dependency optimization loud-throw.

PR #125's esbuild-facade production code put `esbuild-wasm` behind copied options/plugins, an injected writer, result normalization, a synthetic `PluginBuild.esbuild`, and another lifecycle. Review found repeated validation, identity, write, result, and stop drift. That production slice is forensic input only; PR #125's Vite CLI, streams, process, persistence, and documentation slices are independent.

Vite 7.3.6 needs upstream async `build`, `context`, `transform`, and `formatMessages`: config bundling with `write:false`; dependency scan with `context().rebuild()` and `write:false`; dependency prebundle with context default-write; context `cancel`/`dispose`. Its dev, build, preview, and optimize action chunks all import `config.js`, which imports `esbuild` at module top level.

## Decision

### D1 — Generate the exact upstream client

The generator consumes tarball members `esbuild-wasm@0.28.0/package/lib/browser.js` CJS (`sha256:b882a5ffb3bf170c0d8f40c0832cc5dca00830400314bb9455dea5d6f58c2a10`) and `esbuild.wasm` (`sha256:9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b`). Source/hash/patch-anchor drift fails generation.

Generated changes are limited to:

- upstream inline `worker:false` gojs/WASM startup in the executing Vite Worker;
- one Node-callback FS over guest `FsSync`: fds 0–2 stay upstream protocol fds, file fds use VFS, callbacks defer;
- `hasFS:true`, runtime `defaultWD` = guest cwd, and transform temp files on that FS;
- named guest capability gates in D4.

Upstream channel, validation, plugin graph/callbacks, results, context rebuild/cancel/dispose, writes, and `PluginBuild.esbuild` remain source-owned. No host `Proxy`, options/plugin clone, injected plugin, sampled writer, result normalizer, or second API object.

### D2 — Initialize, then publish one object

For CLI action modes `dev`, `build`, `preview`, and `optimize`, `prepareViteCli` awaits the generated client's private startup with the realm's wasm, `FsSync`, and cwd. Only success publishes the returned exact CJS outer through a typed `runtime-js` realm slot; failure publishes nothing and fails the child.

`info` means CAC will not run an action: any `--help`/`-h`, or `--version`/`-v` when no named command matched. A named `dev|serve|build|preview|optimize` plus version remains its action mode. `info` may keep existing CLI preparation but never starts or publishes esbuild.

All four action modes route through one mode-independent startup branch; there are no per-mode initializers. `prepareViteCli` is the slot's sole writer; the installed overlay is read-only. Upstream owns service/context state. Worker termination owns teardown: no host stop, disposer, generation, or retry lifecycle. The legacy `__riftyEsbuildTransform` bridge is absent before the first esbuild import.

### D3 — One CJS overlay; common interop owns ESM

The `esbuild` overlay has one CJS body/module id; `main`, `require`, and `import` resolve it. It reads the typed slot and assigns the exact outer to `module.exports`; there is no esbuild-specific ESM wrapper.

The common CJS→ESM loader correction is in scope: ESM `default` is always the CJS outer even when it has a `.default`, and each resolved CJS module caches one stable namespace with its module record. Thus native 0.28.0 relations hold: outer !== `.default`; `.default.default === .default`; ESM default === outer; named methods preserve references; `PluginBuild.esbuild === outer.default`.

### D4 — Guest policy gaps stay inside generated source

The private startup bypass is not guest-visible. Generated gates preserve upstream validation and error priority, including post-setup option validation; only a call that would otherwise enter an unsupported success path throws:

| Guest surface | Named gap |
|---|---|
| direct `initialize` / `stop` | `esbuild.initialize` / `esbuild.stop` |
| `transformSync` / `buildSync` / `formatMessagesSync` / `analyzeMetafileSync` | matching `esbuild.*` name |
| async `analyzeMetafile` | `esbuild.analyzeMetafile` |
| `context.watch` / `context.serve` | `esbuild.context.watch` / `esbuild.context.serve` |
| one-shot `build` whose post-plugin effective write is not `false` | `esbuild.build.write` |

Invalid arguments/plugins still produce native diagnostics before a gap. Context default-write remains supported for Vite prebundle; the write gate applies only to one-shot `build`.

### D5 — Independent slices, joined acceptance

Generated client/environment, startup+slot+overlay, and common CJS interop/cache are separate implementation/review slices with their own RED rows. Final acceptance joins them on one SHA against native `esbuild@0.28.0`, exact Vite 7.3.6, real wasm, Worker, and guest VFS in Chromium. Four fresh action Workers prove publication; one fresh `info` Worker proves no startup. Fakes, source grep, or warnings cannot close it.

### D6 — Correct ADR-0047 only for the Vite JS API

ADR-0047 remains the WASI-preview1 CLI forcing-consumer decision. Its gojs-moot and every-future-JS-build-through-`runWasi` clauses do not apply to this Vite-facing JS API. The vendored WASI CLI remains.

## Alternatives

- **Host facade.** Rejected: repeats PR #125's `sibling-drift` and state owner.
- **WASI service protocol.** Rejected: payload/concurrency deadlocks reproduced; WASI stays CLI-only.
- **Extend the current shim.** Rejected: reimplements graph/plugin/context semantics.
- **Expose browser lifecycle as Node-compatible.** Rejected: direct lifecycle stays loud; Worker owns teardown.

## Consequences

- Config graphs, transforms/formatting, and optimizer contexts use upstream semantics over guest VFS.
- Vite preview receives the same runtime before its top-level esbuild import; no-action CLI invocations do not pay or depend on startup.
- Source, wasm, shadow version, oracle, and fixtures stay exact-pinned at 0.28.0.
- D4 surfaces remain `NotImplementedError` + compat ❌; validation-before-gap is contract.
- No PR #125 esbuild-facade production code is carried forward; independent slices remain separate.
