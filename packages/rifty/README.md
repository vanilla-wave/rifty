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

`createSandbox()` cannot ship host wiring for you. Consumers still own:

- COOP/COEP headers for cross-origin isolation.
- A bundler-emitted runtime Worker URL. With Vite, import
  `@riftydev/runtime-js/worker?worker&url`, set
  `worker: { format: 'es' }`, and pass the returned URL to `createSandbox()`.
  Because the host imports that entry, list `@riftydev/runtime-js` as a direct
  dependency.
- A direct `@riftydev/service-worker` dependency and a bundled same-origin
  `sw.js` built from its `/sw` entry when preview routing is enabled.
- Same-origin WASM assets when sqlite/WASI guests are used.

Those bits belong in app/template config, not the SDK facade. Future starter
templates should own that host wiring. Gate on `checkCapabilities()` before booting.

Cross-origin isolation enables the browser capabilities rifty needs; it does not
turn guest code into safely hostile code. Current host controls are lifecycle
controls such as `sandbox.dispose()` and Worker kill/terminate paths, not hard
CPU, memory, spawn, or egress quotas. See the
[trust model](https://github.com/vanilla-wave/rifty/blob/main/docs/public/trust-model.md)
for the current boundary.

## Install

```bash
npm i @riftydev/sdk @riftydev/runtime-js @riftydev/service-worker
```

`@riftydev/sdk` remains the API front door; the direct runtime and service-worker
dependencies make the host-owned entry imports explicit and portable across
package managers.

## Boot a sandbox

```ts
import runtimeWorkerUrl from '@riftydev/runtime-js/worker?worker&url';
import { checkCapabilities, createSandbox } from '@riftydev/sdk';

async function main(): Promise<void> {
  const caps = checkCapabilities();
  if (!caps.sufficient || !caps.capabilities.crossOriginIsolated) {
    document.body.textContent = caps.summary;
    return;
  }

  const sandbox = await createSandbox({
    // resolved by YOUR bundler; createSandbox cannot infer host worker assets
    workerUrl: runtimeWorkerUrl,
    // optional; defaults to '/sw.js'. Must be bundled from
    // '@riftydev/service-worker/sw' and served same-origin for preview routing.
    serviceWorkerUrl: '/sw.js',
  });

  try {
    sandbox.runtime.on((e) => {
      if (e.type === 'stdout') console.log(e.chunk);
    });
    await sandbox.runtime.eval('console.log("hello from a Worker")');
    await sandbox.fs.writeFile('/workspace/hello.txt', 'hello');
    console.log(await sandbox.fs.readFile('/workspace/hello.txt', 'utf8'));

    console.log(sandbox.vfs.backend); // 'opfs' | 'memory'
    if (sandbox.swError) console.warn('preview unavailable:', sandbox.swError);
  } finally {
    sandbox.dispose();
  }
}

void main();
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
layer via `@riftydev/sdk/...` and via `@riftydev/...` resolves to the **same**
singleton state — safe to mix.

## License

MIT
