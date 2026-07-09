---
area: playground
subsystem: playground
status: draft
title: esbuild `context({ write: true }).watch()` — normalize watched-rebuild output writes to the VFS
created: 2026-07-09
why: The host esbuild bridge (ADR-0192) always runs the service `write:false` and writes `outputFiles` to the VFS itself; `build()`/`context().rebuild()` do this, but `context({ write:true }).watch()` cannot intercept esbuild's own watch-loop rebuild results, so it loud-throws `NotImplementedError('esbuild.context.watch.write')` instead of writing each rebuild's output.
user_story: As a user (or a plugin) that calls `esbuild.context({ write:true }).watch()` in the browser, I want each watched rebuild to write its outputs to the VFS like native esbuild, not a NotImplementedError.
sources: [docs/adr/toolchain-build/0192-real-esbuild-js-api-for-in-browser-vite-via-esbuild-wasm.md]
---
## Context
`esbuild-host.ts` runs the service `write:false` in a browser realm (native `write:true` loud-throws on the Go side; watched `rebuild()` silently drops writes). For one-shot `build()` and manual `context().rebuild()` the bridge writes `result.outputFiles` to the VFS and strips them (native `write:true` parity). `watch()` is esbuild's OWN internal rebuild loop — the bridge does not see per-rebuild results, so `context({ write:true }).watch()` throws loudly rather than lying with un-written output. Vite does not use esbuild's watch mode (it drives `rebuild()` itself), so this is not on the vite dev/build path today.
## Options / Next
Intercept the watch-loop rebuild results — either a bridge-side `onEnd`-style plugin injected into the watched context that writes `outputFiles` to the VFS on each rebuild, or drive the watch loop through the bridge's own `rebuild()` wrapper. Verify against native esbuild watch output on disk.
## Reversibility
REVERSIBLE — playground runtime adapter, no public API. Gap is a loud NotImplementedError until then.
