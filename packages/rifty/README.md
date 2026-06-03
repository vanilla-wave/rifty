# @riftydev/sdk

The one-install front door to **rifty** — a browser-based, Node-compatible
runtime + WASI runner. `npm i @riftydev/sdk` pulls in the whole `@riftydev/*` stack and
gives you a framework-free `createSandbox()` to boot it in one call.

> rifty is a pet project exploring how WebContainers-like systems work. It runs
> JavaScript and `.wasm` guests inside Web Workers over a virtual filesystem. See
> the [repo root README](https://github.com/vanilla-wave/rifty#readme) for the
> full picture, the runtime model, and current compatibility.

## Requirements (read this first)

rifty needs a **cross-origin isolated** page (so `SharedArrayBuffer` + `Atomics`
are available) and module Workers. Serve your app with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   # or: credentialless
```

`createSandbox()` cannot ship these headers or the bundler-specific worker/SW
asset URLs for you — those are host config (see EPIC E `create-rifty` for a
template). Gate on `checkCapabilities()` before booting.

## Install

```bash
npm i @riftydev/sdk
```

## Boot a sandbox

```ts
import { checkCapabilities, createSandbox } from '@riftydev/sdk';

const caps = checkCapabilities();
if (!caps.sufficient) {
  document.body.textContent = caps.summary; // missing Worker / ServiceWorker / COI
} else {
  const sandbox = await createSandbox({
    // resolved by YOUR bundler (Vite/webpack); the one bit the façade can't hide
    workerUrl: new URL('@riftydev/runtime-js/worker', import.meta.url),
    // optional — defaults to '/sw.js'; needed for live preview routing
    serviceWorkerUrl: '/sw.js',
  });

  sandbox.runtime.on((e) => {
    if (e.type === 'stdout') console.log(e.chunk);
  });
  await sandbox.runtime.eval('console.log("hello from a Worker")');

  console.log(sandbox.vfs.backend); // 'opfs' | 'memory'
  if (sandbox.swError) console.warn('preview unavailable:', sandbox.swError);

  sandbox.dispose();
}
```

`createSandbox` degrades gracefully: OPFS init failure falls back to in-memory
storage (`sandbox.vfs.reason`), and service-worker registration failure only
disables the preview path (`sandbox.swError`) — the REPL keeps working. Pass
`skipServiceWorker: true` for headless eval-only use, or
`requireCrossOriginIsolation: false` to inspect capabilities without throwing.

> **One sandbox per realm (v0.1).** The VFS backend and the service worker are
> realm-global singletons, so call `createSandbox()` **once per page/worker
> realm**. A second call in the same realm gets its own runtime worker but shares
> the filesystem and SW registration; `dispose()` tears down the runtime worker
> only. Register `sandbox.runtime.on(...)` right after the call resolves so you
> don't miss early events.

## Subpaths — reach any layer directly

Each subpath re-exports the matching scoped package, so you never need a second
`npm i`:

| Subpath | Re-exports | Subpath | Re-exports |
|---|---|---|---|
| `@riftydev/sdk/vfs` | `@riftydev/vfs` | `@riftydev/sdk/net` | `@riftydev/net` |
| `@riftydev/sdk/io` | `@riftydev/io` | `@riftydev/sdk/npm-client` | `@riftydev/npm-client` |
| `@riftydev/sdk/kernel` | `@riftydev/kernel` | `@riftydev/sdk/shell` | `@riftydev/shell` |
| `@riftydev/sdk/runtime` | `@riftydev/runtime-js` | `@riftydev/sdk/terminal` | `@riftydev/terminal` |
| `@riftydev/sdk/wasi` | `@riftydev/runtime-wasi` | `@riftydev/sdk/service-worker` | `@riftydev/service-worker` |

```ts
import { MemoryVfs } from '@riftydev/sdk/vfs';
import { runWasi } from '@riftydev/sdk/wasi';
```

The scoped packages stay separate dependencies (never inlined), so importing a
layer via `rifty/...` and via `@riftydev/...` resolves to the **same** singleton
state — safe to mix.

## License

MIT
