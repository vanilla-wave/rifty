# rifty

Browser-based, Node-compatible runtime + WASI runner — a WebContainers-like system
built from scratch. Run `Express`, `npm install`, a dev server, even WASI binaries,
**inside a browser tab**. Pet project; the goal is deep understanding of how these
systems work, plus a practical "Express + npm install in the browser".

> **Status:** active milestone M10 (Real Tooling). Pet project — APIs are `0.x` and
> may move. See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md), [`TASKS.md`](./TASKS.md),
> [`docs/adr/`](./docs/adr/), [`docs/compat/`](./docs/compat/).

## Packages

Want everything in one install? **`npm i rifty`** — the umbrella front door
([`packages/rifty`](./packages/rifty)): a framework-free `createSandbox()` plus every
layer below on a subpath (`rifty/vfs`, `rifty/runtime`, `rifty/net`, …). Or take just
the part you need: every layer is also its own package. All are ESM, ship `.d.ts`, and
are released in lockstep under the `@rifty` scope.

| Package | What it is | Runs in |
|---|---|---|
| [`rifty`](./packages/rifty) | **Umbrella**: one-install front door + `createSandbox()` | browser + Worker |
| [`@rifty/io`](./packages/io) | EventEmitter, Buffer, node-compatible streams | anywhere |
| [`@rifty/vfs`](./packages/vfs) | Virtual FS: in-memory + OPFS, with a sync mirror | anywhere |
| [`@rifty/kernel`](./packages/kernel) | Processes / scheduling / IPC (Worker-as-process, SAB) | browser + Worker |
| [`@rifty/net`](./packages/net) | `node:net`/`http`/`https`/`ws` + `node:sqlite` (sql.js) | anywhere |
| [`@rifty/runtime-js`](./packages/runtime-js) | Node-compatible JS runtime: CJS/ESM loader + builtins | browser + Worker |
| [`@rifty/runtime-wasi`](./packages/runtime-wasi) | WASI (preview1) runner for `.wasm` guests | browser + Worker |
| [`@rifty/npm-client`](./packages/npm-client) | In-browser npm: semver, registry, unpack, link, install | anywhere |
| [`@rifty/shell`](./packages/shell) | Tiny bash-flavoured shell over `@rifty/vfs` | anywhere |
| [`@rifty/terminal`](./packages/terminal) | xterm.js terminal wrapper | browser |
| [`@rifty/service-worker`](./packages/service-worker) | Service Worker preview/HMR routing bridge | browser |
| [`@rifty/shadow-registry`](./tools/shadow-registry) | Data tables of in-browser npm substitutions | anywhere |

```bash
npm install rifty                 # everything + createSandbox() (the front door)
npm install @rifty/vfs            # just the VFS
npm install @rifty/npm-client     # just the npm resolver/installer
# …or any combination — they share singletons when installed at the same version
```

## Quick start (use a part)

```ts
import { MemoryVfs, joinPath } from '@rifty/vfs';

const vfs = new MemoryVfs();
await vfs.mkdir('/proj', { recursive: true });
await vfs.writeFile('/proj/hello.txt', 'hi from rifty');
console.log(await vfs.readFileText(joinPath('/proj', 'hello.txt'))); // "hi from rifty"
```

```ts
import { parse, matchesRange, pickBestVersion } from '@rifty/npm-client';

matchesRange('1.4.2', '^1.2.0');                              // true
pickBestVersion(['1.0.0', '1.4.2', '2.0.0'], '^1.2.0');       // "1.4.2"
```

More, runnable, in [`examples/standalone-usage`](./examples/standalone-usage)
(`pnpm --filter @rifty-examples/standalone start`). The full product demo is the
[playground](./apps/playground) (`pnpm dev`).

## Consuming rifty in your own app — read this first

The leaf packages (`@rifty/io`, `@rifty/vfs`, `@rifty/npm-client`, `@rifty/shell`,
`@rifty/shadow-registry`) are plain isomorphic JS and need nothing special. But the
**runtime** (`runtime-js`, `runtime-wasi`, `kernel`, `service-worker`) has hard
browser prerequisites — without them it will not boot:

1. **Cross-origin isolation is mandatory** (for `SharedArrayBuffer` + `Atomics.wait`,
   used by synchronous IPC and sync fs). Serve your page with:

   ```
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Embedder-Policy: credentialless
   Cross-Origin-Resource-Policy: cross-origin
   ```

   Then `globalThis.crossOriginIsolated === true`. Header-less static hosts (e.g.
   **GitHub Pages) do not work**; Vercel / Netlify / Cloudflare Pages do. Copy-paste
   configs: [`vercel.json`](./vercel.json),
   [`apps/playground/public/_headers`](./apps/playground/public/_headers), and the
   dev-server `headers` in [`apps/playground/vite.config.ts`](./apps/playground/vite.config.ts).

2. **A bundler with module Workers** + `new URL('…', import.meta.url)` worker
   resolution (Vite `worker: { format: 'es' }`). `runtime-js`/`runtime-wasi` spawn
   their worker entry by URL (`@rifty/runtime-js/worker`,
   `@rifty/runtime-wasi/worker-entry`).

3. **A service worker** for preview/HMR routing — build one from
   `@rifty/service-worker/sw` and register it via `registerServiceWorker(url)`. There
   is no prebuilt `sw.js`; it must be bundled (the playground does this with
   `apps/playground/build/sw-plugin.ts`).

4. **Same-origin WASM assets** when you use them: `node:sqlite` needs
   `sql.js/dist/sql-wasm.wasm` reachable (inject a `locateFile` via
   `initSqliteEngine({ locateFile })`, awaited once before any `DatabaseSync`); the
   real-tooling WASI path needs its `esbuild.wasm`.

Given those, the umbrella's **`createSandbox()`** does the rest of the boot wiring
(capability probe → COI guard → VFS backend with memory fallback → service-worker
registration → runtime worker) and hands you a live `RuntimeController`:

```ts
import { checkCapabilities, createSandbox } from 'rifty';

if (!checkCapabilities().sufficient) return showUnsupportedNotice();
const sandbox = await createSandbox({
  workerUrl: new URL('@rifty/runtime-js/worker', import.meta.url), // your bundler resolves it
  serviceWorkerUrl: '/sw.js',
});
await sandbox.runtime.eval('console.log("hello from a Worker")');
```

Target `es2022`; **Chrome-first** (cross-browser e2e infra exists, see
[`docs/compat/`](./docs/compat/)).

## Develop (monorepo)

```bash
pnpm install
pnpm dev                  # playground at http://localhost:5273

pnpm typecheck            # workspace-wide
pnpm lint                 # biome
pnpm build:libs           # build all publishable packages to dist/
pnpm test:run             # unit
pnpm test:parity          # node parity runner
pnpm test:e2e             # playwright (chromium)
```

The in-repo `exports` point at raw TypeScript `src/` (so dev/HMR needs no build);
the **published** packages point at the built `dist/` via `publishConfig`. See
[`docs/PUBLISHING.md`](./docs/PUBLISHING.md) and ADR-0070.

## Architecture

Five layers, top-down only — **no reverse imports**:

```
apps/playground          (UI: Monaco editor + xterm terminal — SolidJS, isolated)
shell · terminal · npm-client
runtime-js (Node API) · runtime-wasi (WASI)
kernel (processes, scheduling, IPC)
vfs · io · net   (+ service-worker, shadow-registry)
```

UI framework (SolidJS) is confined to `apps/playground/**` (D-002).

## Contributing

The rules live in [`CLAUDE.md`](./CLAUDE.md): TDD (tests/parity-case first), no `any`,
no silent stubs (throw `NotImplementedError`), one change per PR. Decisions are
recorded as [ADRs](./docs/adr/).

## License

[MIT](./LICENSE).
