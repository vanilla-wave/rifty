# ADR 0395: Publish a copyable Workbench runtime-asset closure

Status: Accepted
Date: 2026-09

> TL;DR: Published Workbench ships a `dist/runtime/` file set (bundled workers, SW, WASM) a host copies; the kernel asset publishes a sibling QuickJS WASM URL so the host writes no wrapper.

## Context

Goal self-hosted-snapshot-workbench I2 requires a host to boot Workbench by
copying published files. Today's tsup entries leave `@riftydev/*` external
(ADR-0070). Packed hosts compile Worker/SW entries, alias Node builtins, and
wrap the kernel to publish `QUICKJS_WASM_URL_ENV` (ADR-0352). ADR-0282 seals
source entries; those custom-compile paths stay.

## Decision

Add a published `dist/runtime/` closure, separate from the sealed library
entries that remain external:

- `owner-worker.js`, `kernel-worker.js`, `node-worker.js`,
  `dev-server-worker.js`, `typescript-worker.js`, `no-coi-toolchain-worker.js`
  — fully bundled, no `@riftydev/` imports
- `sw.js` — bundled service worker
- `sqlite.wasm`, `quickjs.wasm`
- `manifest.json` — file list and required host headers (COOP/COEP/CORP,
  `Service-Worker-Allowed`)

The kernel asset sets `QUICKJS_WASM_URL_ENV` from
`new URL('./quickjs.wasm', import.meta.url)` synchronously before the kernel
listener (ADR-0352 order). Hosts that still compile may keep a custom wrapper.

No second runtime, no hardcoded CDN, no consumer Worker/SW compile for this
path. Playground may keep compiling sealed source entries.

Candidates: keep consumer compile + wrapper — violates I2; import-map plus
unbundled package files — host still needs a module resolver; bundled
`dist/runtime/` copy set — ordinary static copy, existing custom entries stay.

## Consequences

Embedders copy one directory and pass those URLs to `openWorkbench`. Snapshot-only
admission and preview-prefix remain sibling units. Custom deployment URLs remain
valid.
