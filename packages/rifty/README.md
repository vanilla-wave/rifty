# @riftydev/sdk

The one-install front door to **rifty** — a browser-based, Node-compatible
runtime + WASI runner. `npm i @riftydev/sdk` pulls in the whole `@riftydev/*` stack and
gives you a framework-free `createSandbox()` to boot it in one call.

> rifty is a pet project exploring how WebContainers-like systems work. It runs
> JavaScript and `.wasm` guests inside Web Workers over a virtual filesystem. See
> the [repo root README](https://github.com/vanilla-wave/rifty#readme) for the
> full picture, the runtime model, and current compatibility.

## Requirements (read this first)

The full rifty runtime needs a **cross-origin isolated** page (so
`SharedArrayBuffer` + `Atomics` are available) and module Workers. Serve your
app with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   # or: credentialless
```

The explicit shared-memory-free toolchain mode below runs in an existing
headerless page; threaded-WASM toolchains remain a loud named gap.

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

### Headerless toolchain

Install `@riftydev/workbench`, bundle its
`@riftydev/workbench/no-coi-toolchain-worker` entry as a module Worker, then:

```ts
const sandbox = await createSandbox({
  requireCrossOriginIsolation: false,
  toolchain: { workerUrl: toolchainWorkerUrl },
  storage: { namespace: 'my-project', persistence: 'required' },
  startupTimeoutMs: 30_000,
});
await sandbox.fs.writeFile('/project/package.json', manifest);
await sandbox.toolchain.install({ cwd: '/project', registryUrl: '/npm-registry' });
await sandbox.toolchain.runBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/vite',
  args: ['build'],
});
const resident = await sandbox.toolchain.startBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/vite',
  args: ['--host', '127.0.0.1', '--port', '5174', '--strictPort'],
  port: 5174,
});
const previewIframe = document.querySelector('iframe[data-rifty-preview]');
if (!(previewIframe instanceof HTMLIFrameElement)) throw new Error('preview iframe missing');
previewIframe.src = resident.previewUrl;

// Your timeout detects a wedged single realm; restart performs the recovery.
await sandbox.restart({
  preview: previewIframe,
  beforeStart: (fs) =>
    fs.writeFile('/project/src/wedge.js', "export const pluginState = 'repaired';\n"),
});
console.log(sandbox.capabilityReport);
```

`storage` defaults to preferred OPFS at the origin root. `namespace` selects one
literal native directory before preload; omission keeps existing origin-root
files. Empty, dot, slash, backslash and NUL components reject before effects.
`required` rejects unavailable OPFS; `preferred` exposes a memory fallback through
`sandbox.vfs.reason`; `ephemeral` selects memory. Unreadable saved preload always
rejects. Required persistence is not browser eviction protection or storage isolation.

`startupTimeoutMs` defaults to 10000; positive integer through 2147483647.
It covers Worker construction/import, native VFS hydration and runtime readiness,
including restart. Expiry or Worker close rejects startup and terminates the
Worker. Service-worker registration, guest execution and snapshot/install work
have separate lifetimes. Startup configuration is captured before effects;
restart retains it.

For CI-baked dependencies, use published `produceDependencySnapshot` from
`@riftydev/workbench`, serve its archive and apply explicitly:

```ts
await sandbox.toolchain.applySnapshot({
  cwd: '/project',
  snapshot: { assetUrl, snapshotId, templateId },
});
// Explicit replacement of conflicting payload targets:
await sandbox.toolchain.applySnapshot({
  cwd: '/project', snapshot: { assetUrl: updatedUrl, snapshotId: updatedId, templateId }, force: true,
});
```

No registry URL is needed. Every application validates the bounded input and
identities, including same-ID/forced calls. Default conflicts reject before
payload/cache writes; force replaces only payload targets, including descendants
of a directory replaced by a file. Other files survive. Success follows actual
persistence; failure rejects and may leave partial dependencies.

On a later page load, recreate the sandbox and call
`await sandbox.toolchain.open({ cwd: '/project' })` before using saved adapters.
Legacy `registryUrl` remains accepted but is unused. Open neither fetches an
artifact nor reinstalls, rewrites files or checks installation completion.
Missing/pending/old proof and missing/corrupt lock do not deny local source.
Only valid lock facts grant adapters; missing/corrupt dependencies or adapter
bytes fail at actual use. Explicit install/apply is optional recovery after
interruption, never an admission requirement or automatic retry.

Update SDK and copied Worker together (protocol v5). Older Workers reject during
handshake. Errors cross the boundary as ordinary `Error` objects; inspect
`name`/`message`, including `SandboxPersistenceError`, rather than class identity.
Unreadable OPFS preload rejects: clear the native fault and recreate the sandbox.

### Agent files and commands without COI

```ts
const project = sandbox.project({ root: '/project', readonlyPaths: ['locked'] });
await project.fs.mkdir('src', { recursive: true });
await project.fs.writeFile('src/input.txt', 'hello');
console.log(await project.fs.readdir('src'));
console.log(await project.fs.stat('src/input.txt'));
await project.fs.rename('src/input.txt', 'src/message.txt');

const run = project.run('npm run build', { cwd: '.', env: { NODE_ENV: 'production' } });
run.onOutput(({ stream, chunk }) => console.log(stream, chunk));
const result = await run.completion; // or await run.stop()
console.log(result.status, result.exitCode, result.effects, result.worker);
await project.fs.rm('src/message.txt');
```

`project` is immutable configuration. Each run gets fresh Shell cwd/env; cd
changes subsequent segments of that call. Files persist. Relative file paths,
cwd and readonly paths resolve from root; absolute paths retain their VFS
meaning. Root is a path origin, not a filesystem jail. Optional allowedCommands
permits only exact names at Shell dispatch, including nested npm scripts.
Background jobs are rejected before launch. Policy covers ordinary Node and
installed-tool writes, not hostile JS.

Completion reports exited/cancelled/failed, captured stdout/stderr, exitCode
(null when unavailable), effects and Worker state. Output subscriptions do not
replay: attach immediately. Stop retains ownership through handler and checked
flush settlement. After one second without settlement, an admitted stopped
command's Worker is terminated/replaced before completion, with unknown effects.
Recovery never replays a command or promises rollback. Memory recovery uses the
retained image; unknown effects can be lost. Concurrent finite operations reject
busy. Project methods alongside a resident bin reject resident-concurrency.

Raw sandbox.fs also provides readdir/stat/mkdir/rename/rm/flush; relative paths
remain VFS-rooted. Stat/dirent results are plain VFS metadata records. New
mutations/flush return applied/persistence receipts (memory/flushed); writeFile
preserves its void result. Failed operations carry error.effects for application
and persistence uncertainty. Console runtime.eval prints expression values and
resolves success with value undefined; file/command methods supply structured
results.

This mode owns runtime, VFS, npm install, installed registry-twin admission, and bin
execution in one Worker. `startBin` is package-generic; the requested port
resolves only after listen and routes through the existing SW HTTP/WebSocket
preview bridge. `restart` is explicit because an alive CPU-wedged Worker cannot
self-report; it visibly reloads the supplied iframe and reports whether a
public write lacked its flush acknowledgement. Threaded WASM still throws by
named feature.

`createSandbox` degrades gracefully: OPFS init failure falls back to in-memory
storage (`sandbox.vfs.reason`), and service-worker registration failure only
disables the preview path (`sandbox.swError`) — the REPL keeps working. Pass
`skipServiceWorker: true` for headless eval-only use, or
`requireCrossOriginIsolation: false` to inspect capabilities without throwing.

> **One sandbox per realm (v0.1).** Generic mode's page VFS and the service
> worker are realm-global. Toolchain mode owns VFS/runtime inside its one Worker;
> service-worker registration remains page-global. Register
> `sandbox.runtime.on(...)` right after boot so you don't miss early events.

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

### No-COI VM selection

Toolchain sandboxes default `node:vm` to `rewrite`, with no QuickJS WASM preload.
This is degraded: direct eval can reach host globals, fresh contexts see host
globals, and cross-realm `instanceof` differs. The capability report discloses it.
Pass top-level `vmEngine: 'quickjs'` to `createSandbox` for the existing real-realm
engine; it loads WASM before the first eval and retains selection on restart.
Generic runtime defaults remain unchanged (ADR-0383).
