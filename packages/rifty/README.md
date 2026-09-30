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

Browser versions per mode and persistence, with executed evidence: the
[browser support matrix](https://github.com/vanilla-wave/rifty/blob/main/docs/public/compat/browsers.md).

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
templates should own that host wiring. `checkCapabilities()` only reports current-realm
API presence; it cannot prove permission, CSP, Worker storage or successful boot.

Cross-origin isolation enables the browser capabilities rifty needs; it does not
turn guest code into safely hostile code. Current host controls are lifecycle
controls such as `sandbox.dispose()` and Worker kill/terminate paths, not hard
CPU, memory, spawn, or egress quotas. See the
[trust model](https://github.com/vanilla-wave/rifty/blob/main/docs/public/trust-model.md)
for the current boundary.

For active checks of COI Workbench and the non-COI Workbench toolchain, see
[`checkSandboxSupport`](https://github.com/vanilla-wave/rifty/blob/main/docs/public/sandbox-support.md).
The generic SDK sandbox is a different composition; `checkCapabilities()` stays synchronous.

## Agent in an existing no-COI app

Copy the [reference host](https://github.com/vanilla-wave/rifty/blob/main/tests/integration/fixtures/workbench-vite-consumer/src/host.ts)
and connect your copied Workbench assets, namespace/root, model catalog/endpoint,
optional registry, policy values and render callbacks. It uses the public
SDK/agent APIs, built-in transport and transcript reducer; no bundler plugin or
runtime service worker. This private application recipe is also the benchmark's
no-COI composition, not a published SDK entrypoint.

`prepare({snapshot, files})` applies before writing first-open sources. The app
stores applied snapshotId under its namespace/root key; reopen supplies only the
snapshot descriptor and calls ordinary saved open without a fetch. On a changed
ID the recipe forces the payload, then writes explicitly supplied app-owned
sources. Preserve the actual post-agent manifest in your application storage;
pass those desired bytes as `files['package.json']` plus `install:{registryUrl}`
to reconcile dependencies after deploy. The app decides the desired manifest;
there is no SDK merge. See the [complete recipe and proof](https://github.com/vanilla-wave/rifty/blob/main/tests/integration/fixtures/workbench-vite-consumer/README.md).

The recorded ID means apply succeeded, not installation completed. Supplied
files/install still execute on a same-ID retry. Errors stay visible; interrupted
apply may need an explicit force, and this recipe adds no rollback guarantee.
Agent turns use `host.agent`; `host.call` serializes only the app's own calls.
An app action overlapping the agent may receive typed busy; retry after the turn.

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
  // Passive presence only; createSandbox still reports actual startup failures.
  const caps = checkCapabilities();
  if (!caps.sufficient) {
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

On the same origin as Workbench, give the SDK toolchain sandbox and Workbench
distinct `storage.namespace` values. Omitting both selects the same origin root;
the exclusive replica writer rejects the second with `OpfsPreloadError`
(`writer is unavailable or already occupied`), even under `preferred` (ADR-0425).

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

Update SDK and copied Worker together (protocol v6). Older Workers reject during
handshake. Errors retain ordinary Error receipts; `sandboxErrorKind(error)` from
the SDK root discriminates known outcomes across Worker/package boundaries.
Unknown failures return undefined; preserve their original name/message/cause.

| Kind | Retry condition |
| --- | --- |
| busy | Active toolchain operation has settled; no automatic queue. |
| resident-busy | Stop the resident before the incompatible operation. |
| occupied | Native namespace holder closes; recreate sandbox. Both existing startup/guard deadlines retain native contention cause; guard expiry stays OpfsPreloadError. |
| snapshot-conflict | Host resolves conflicting payload targets or explicitly chooses force; same bytes and unrelated files are allowed. |
| snapshot-mismatch | Correct snapshot bytes/id/template/runtime compatibility before retry. |
| restart-busy | Active restart has settled. |
| registry-missing | Configure toolchain.registryUrl when creating the sandbox; a per-call host override does not connect shell installs. |
| persistence | Clear native storage fault and inspect effects/live data before recovery; a failed receipt can already have applied writes. |

Unreadable OPFS preload rejects: clear the native fault and recreate the sandbox.
A permission/import timeout or hydration stall after admission is not occupied.

### Opening and application progress

```ts
import { createSandbox, sandboxErrorKind } from '@riftydev/sdk';
const opening = createSandbox({
  requireCrossOriginIsolation: false,
  toolchain: { workerUrl },
});
const unsubscribe = opening.runtime.on(event => {
  if (event.type === 'progress') console.log(event);
});
const sandbox = await opening; // Still waits for actual readiness.
// Subscription survives resolution and sandbox.restart().
// Later: unsubscribe(); sandbox.dispose();
```

`SandboxOpening<T>` is a Promise with an early runtime.on view. No replay; attach
before await. Boot phases: worker-spawned → storage-admitted → toolchain-ready.
Native contention adds waiting-for-storage-writer with its cause before admission.
Generic mode has no toolchain handshake phase.

Snapshot progress uses operation=snapshot and its existing request id (scoped to
one Worker generation; reset at replacement). Phases: fetch(bytes,total?),
entries(written,total), flush-cache(persisted,total), flush-payload(persisted,total).
Entries count changed payload files/directories, excluding root/cache; same bytes
write zero. Flush counts native pending watermark operations, not archive entries.
Missing, content-encoded or CORS-hidden-encoding byte totals stay absent. No pending native writes
means no flush-count event; failures never synthesize completion. These are separate
operation counts, not a percentage of the whole opening. Dispose/restart cancels
old requests; their late frames cannot update the replacement operation.

### Registry connection for shell installs

Set `toolchain: { workerUrl, registryUrl }` when creating the sandbox to allow
project/agent `npm install [<pkg>…]`. The captured endpoint survives restart;
`toolchain.registryConnected` is a readonly configuration fact, not a probe.
The command uses the same installer/claims/activation as host toolchain.install.
It needs the opened project's package.json; registry semver/tag specs and
`-D`/`--save-dev`, `-E`/`--save-exact`, `-S`/`--save`, `--prefer-online` are supported.
Manifest/lock dependency maps save resolved npm ranges; failed acquisition restores
our manifest edit. Concurrent edits remain intact and cannot certify an install.

Omitting the connection is valid: shell install fails before install writes/fetch
with `sandboxErrorKind(outcome.error) === 'registry-missing'`. Existing dependencies
remain usable. Per-call host `install({ registryUrl })` does not connect later shell
calls. Install shares command busy/Stop and project readonly policy; no queue.
Unsupported specs, flags and lifecycle scripts retain their existing loud errors.

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
installed-tool writes, not hostile JS. `npm install`/`add` inside `run` throws
`NotImplementedError('sandbox.project.npm-install')`: install through
`toolchain.install`; `npm run` reuses the installed tree.

Completion reports exited/cancelled/failed, captured stdout/stderr, exitCode
(null when unavailable), effects and Worker state. Output subscriptions do not
replay: attach immediately. Stop emits SIGINT into the guest and retains
ownership through handler, event-loop drain and checked flush settlement; a
program without a SIGINT handler keeps draining its pending work (real Node
exits 130 at once). After one second without settlement, an admitted stopped
command's Worker is terminated/replaced before completion, with unknown effects.
A never-admitted invocation (busy Worker, invalid input) reports `failed` even
after Stop. Failed or unknown persistence of a settled command is also reported
as `unflushedWrites` by the next `restart`.
Recovery never replays a command or promises rollback. Memory recovery uses the
retained image; unknown effects can be lost. Concurrent finite operations reject
busy. Project methods alongside a resident bin reject resident-concurrency.

To return from preview to project commands, call `await sandbox.stopResident()`.
It replaces the Worker using the same recovery owner as restart, clears resident
replay and returns `{unflushedWrites, resident: null}`. The host clears its iframe.
It is an explicit realm replacement even without a current resident; acknowledged
files follow existing recovery guarantees. Ordinary `restart({preview})` still
relaunches the resident. Both reject overlapping replacement.

Raw sandbox.fs also provides readdir/stat/mkdir/rename/rm/flush; relative paths
remain VFS-rooted. Stat/dirent results are plain VFS metadata records. New
mutations/flush return applied/persistence receipts (memory/flushed); writeFile
preserves its void result. Failed operations carry error.effects for application
and persistence uncertainty. Console runtime.eval prints expression values and
resolves success with value undefined; file/command methods supply structured
results. Eval success never certifies persistence: `sandbox.fs.flush()` receipts
and the next `restart().unflushedWrites` are the durability report.

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
