# ADR 0352: Realm-wide QuickJS preload uses host-published WASM

Status: Accepted
Date: 2026-08

> TL;DR: Browser hosts publish the QuickJS WASM URL before Node pre-entry;
> every runtime-js copy in that realm shares one retryable preload authority.

## Context

The release-sync QuickJS variant resolves its own WASM beside its JS module.
Native Node preserves that layout. Vite rewrites the browser module into a
chunk, so the inferred sibling URL reached the host SPA fallback and Emscripten
tried to compile HTML. The URL resolver existed but was not wired to upstream.

Production Worker URL entries can also carry duplicate runtime-js module copies
into one realm. A kernel-entry module-local preload does not make the engine
visible to the later dev-server or Node-entry copy.

## Decision

1. `QUICKJS_WASM_URL_ENV` is the public host-bootstrap key exported by
   `@riftydev/runtime-js/install-process`. Vite hosts wrap the sealed Workbench
   kernel entry: publish the bundler-emitted
   `@jitl/quickjs-wasmfile-release-sync/wasm?url`, then import the sealed entry.
   Bundler queries and the upstream asset dependency remain at the host boundary;
   Workbench stays bundler-agnostic.
2. A configured URL customizes the upstream variant with `wasmLocation`.
   Unconfigured native Node keeps upstream package resolution; browser workers
   retain `/quickjs.wasm` as the explicit host fallback.
3. The in-flight promise and ready module live under runtime-js's realm-owned
   `globalThis.__rifty` table, not module scope. Duplicate bundle copies join
   the same promise and read the same module identity.
4. A rejected preload removes only the in-flight promise; no ready module is
   published, so a later boot can retry. Hook rejection remains loud per
   ADR-0351.
5. WASI and rewrite-selected workers still do not call the QuickJS loader. An
   emitted asset URL is inert until QuickJS readiness fetches it.

> **Corrected (2026-08-11):** an awaited dynamic sealed-entry import has two
> invalid bootstrap orders. Packed Rollup can hoist the QuickJS namespace back
> onto the unfinished host entry. Even without that back-edge, Worker message
> queues enable while module evaluation is suspended; the one-shot `init` can
> dispatch before the kernel listener exists. Both hosts statically import the
> side-effectful sealed entry and synchronously publish the URL in the wrapper
> body. Source and published kernel entries are marked side-effectful. Initial
> graph evaluation therefore installs the listener and publishes the URL before
> queues enable; pre-entry reads that URL later. `QUICKJS_WASM_URL_ENV` remains
> on `install-process`; no second public key surface is needed.

> **Corrected (2026-08-11):** browser preload pairs `wasmLocation` with an
> upstream `wasmBinary` loader. The loader uses the current realm fetch, cancels
> HTTP fault bodies, and returns `arrayBuffer()` bytes. Native Node retains the
> release variant's package resolution or its prior explicit location-only
> override; neither Node path owner-fetches. QuickJS therefore stays on the
> tracked fetch Body path despite the realm-wide WebAssembly streaming ceiling.

## Proof contract

- Loader unit: configured URL reaches `wasmLocation` plus owner-fetched
  `wasmBinary`; HTTP bodies cancel before exact failure; downstream compile
  failures retain provenance; native Node default and explicit-location paths
  do not fetch; duplicate module copies share identity; rejected load retries.
- Host/build: the static sealed entry survives tree-shaking; listener install
  and URL publication both finish before the Worker admits `init`; playground
  and packed-consumer builds preserve a bundler-resolved WASM asset.
- Chromium: Workbench boot crosses QuickJS preload into the Webpack server
  lifecycle without an HTML-as-WASM compile failure.

## Fault matrix

| Fault class | Required proof |
|---|---|
| corrupt-input | transformed chunk cannot infer bytes; host-published `.wasm` URL compiles |
| sibling-drift | duplicate runtime-js copies share one realm authority; App and packed host wrappers use the same synchronous bootstrap order |
| poisoned-cache | rejected preload is removed and a second attempt succeeds |
| provenance-lie | emitted URL and fetched artifact are bundler-owned, not an inferred sibling |
| observable-order | static graph installs listener + URL before `init`; HTTP body cancel settles before status failure, but its fault cannot replace that primary failure or poison retry |

## Consequences

- (+) Browser and native Node each use an asset path their host can prove.
- (+) Preload identity follows the Worker realm, matching VM consumers.
- (-) Bundler hosts must provide a tiny kernel-entry wrapper or serve the
  explicit `/quickjs.wasm` fallback.
