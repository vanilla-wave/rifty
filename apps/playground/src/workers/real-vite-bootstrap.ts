/// <reference lib="webworker" />

/**
 * Real Vite bootstrap (ADR-0043 — Vite-in-Worker, M11 / A-026).
 *
 * Loaded by the kernel-worker bootstrap (`kernel-worker-entry.ts` →
 * `@riftydev/kernel/worker-entry`) via `import(spec.entry.url)` once the
 * `WorkerInitMessage` has landed. By the time this module evaluates:
 *
 *   - `globalThis.process` is the Node-shape shim installed by
 *     `@riftydev/runtime-js/install-process` (the kernel's pre-entry hook).
 *   - `globalThis.process.env` carries the env the page-realm adapter
 *     stuffed into the `WorkerSpawnSpec`.
 *   - The kernel's SAB sync-RPC client is published on globalThis for
 *     any future `execSync`-shape consumers (not used here yet).
 *
 * Bootstrap steps:
 *
 *   1. Install `Buffer` + timer globals on this realm — Vite reaches for
 *      them via `node:buffer` and `setImmediate`/`setTimeout`.
 *   2. Open the cross-realm VFS write port — editor edits arriving from
 *      the page realm land in our local `syncMirror()` so Vite's
 *      watcher can pick them up.
 *   3. Seed the project tree if absent.
 *   4. Run npm-client `install` against the worker-local VFS to pull
 *      Vite's transitive tree under `/workspace/node_modules`.
 *   5. Overlay the esbuild + rollup-native shims (matches the page-realm
 *      path that ADR-0043 supersedes).
 *   6. Build the module loader, hook `node:module.createRequire`, and
 *      dynamic-`import('vite')` to get `createServer`.
 *   7. Open the cross-realm HMR bridge — the `BridgedWebSocketServer`
 *      now lives in this realm. Iframe-side client unchanged
 *      (BroadcastChannel reaches across realms).
 *   8. Start Vite with `hmr: false` (we own the iframe wire) and the
 *      bridge plugin that injects the inlined client script.
 *   9. Forward Vite's `watcher.change` events into the bridge.
 *  10. Open the cross-realm preview-port bridge — page-realm
 *      `bridgeCrossRealmPreview(port)` posts the SW's `SerializedRequest`
 *      over BroadcastChannel; we dispatch through the worker-local
 *      `@riftydev/net` registry (where Vite registered itself when its
 *      dev server `.listen`'d).
 *
 * Failure modes:
 *   - Any throw propagates back to the kernel's `worker-entry`, which
 *     maps it to exit code 1 + stack-on-stderr. The page-side
 *     `realVite.ts` adapter forwards stderr into the playground
 *     terminal.
 *
 * Why this is split from `realVite.ts`:
 *   - This module runs in a *worker realm*. The page-realm adapter only
 *     orchestrates the spawn — it must not import any of the heavy
 *     install/Vite code paths (the whole point of A-026 is that the
 *     page realm stops paying for them).
 */

import { dispatchToPort, serveCrossRealmPreview } from '@riftydev/net';
import '@riftydev/net/register-builtins';
import { RegistryClient, install } from '@riftydev/npm-client';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { installProcessGlobals } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import { esbuildShimFiles, rollupShimFiles } from '../glue/esbuild-shim.ts';
import {
  type HmrBridgeHandle,
  createHmrBridgeVitePlugin,
  setupHmrBridge,
} from '../glue/hmr-bridge.ts';
import { proxiedRegistryFetch } from '../glue/registry-fetch.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { serveVfsWrites } from '../glue/vfs-write-port.ts';

const enc = new TextEncoder();

const INITIAL_INDEX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>rifty + real Vite (worker)</title></head>
  <body>
    <h1>Hello from rifty</h1>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`;

const INITIAL_MAIN_JS = `document.getElementById('app').textContent =
  'Hello from real Vite running inside a kernel-spawned Worker — edit me, save.';
`;

const INITIAL_PACKAGE_JSON = JSON.stringify(
  {
    name: 'rifty-vite-app',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: { vite: '^5.4.0' },
  },
  null,
  2,
);

interface ViteUserConfig {
  root?: string;
  server?: { port?: number; strictPort?: boolean; middlewareMode?: boolean; hmr?: boolean };
  appType?: string;
  clearScreen?: boolean;
  optimizeDeps?: { disabled?: boolean };
  plugins?: unknown[];
}

interface ViteWatcher {
  on(event: 'change', cb: (file: string) => void): void;
}

interface ViteDevServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
  watcher?: ViteWatcher;
}

function log(line: string): void {
  // The kernel pre-entry hook (install-process) wired
  // `process.stdout.write(chunk)` to post on the stdout MessagePort.
  // Page-side `WorkerProcessHandle.stdout()` returns a Readable that
  // emits each chunk; `realVite.ts` forwards into `onLog`.
  globalThis.process.stdout.write(line);
}

function installRuntimeGlobals(): void {
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

function seedProject(root: string, entryPath: string): void {
  const fs = syncMirror();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(`${root}/src`, { recursive: true });
  if (!fs.existsSync(`${root}/index.html`)) {
    fs.writeFileSync(`${root}/index.html`, enc.encode(INITIAL_INDEX_HTML));
  }
  if (!fs.existsSync(entryPath)) {
    fs.writeFileSync(entryPath, enc.encode(INITIAL_MAIN_JS));
  }
  if (!fs.existsSync(`${root}/package.json`)) {
    fs.writeFileSync(`${root}/package.json`, enc.encode(INITIAL_PACKAGE_JSON));
  }
}

function overlayShims(): void {
  const fs = syncMirror();
  for (const [path, content] of [
    ...Object.entries(esbuildShimFiles),
    ...Object.entries(rollupShimFiles),
  ]) {
    const np = normalizePath(path);
    fs.mkdirSync(dirname(np), { recursive: true });
    fs.writeFileSync(np, enc.encode(content));
  }
}

async function bootstrap(): Promise<void> {
  // Pull config from env (the page-realm adapter set these on the
  // WorkerSpawnSpec). Defaults match the page-realm path so callers
  // who don't override get the same behaviour.
  const env = globalThis.process.env;
  const port = Number.parseInt(env.RIFTY_RFV_PORT ?? '5174', 10);
  const root = env.RIFTY_RFV_ROOT ?? '/workspace';
  const entryRel = env.RIFTY_RFV_ENTRY ?? '/src/main.js';
  const entryPath = `${root}${entryRel}`;

  installRuntimeGlobals();

  // VFS write port opens BEFORE seeding so an edit racing the install
  // (rare but possible) lands in the right realm. The watcher Vite
  // installs later sees the actual file change either way.
  const tearVfsBridge = serveVfsWrites(port);

  seedProject(root, entryPath);

  log(`[real-vite/worker] installing vite into ${root}/node_modules…\n`);
  const registry = new RegistryClient({ fetch: proxiedRegistryFetch() });
  const vfs = new SyncMirrorVfs();
  const result = await install(
    'rifty-vite-app',
    '0.0.0',
    { vite: '^5.4.0' },
    { vfs, cwd: root, registry },
  );
  log(
    `[real-vite/worker] installed ${result.packages.length} packages (${result.conflicts.length} conflicts)\n`,
  );

  overlayShims();
  log('[real-vite/worker] esbuild + rollup-native shims overlaid\n');

  const loader = createModuleLoader(syncMirror(), { cwd: root });
  __setCreateRequireImpl((from: string) => {
    const fromPath = from.startsWith('file://')
      ? decodeURIComponent(from.slice('file://'.length))
      : from;
    const req = ((id: string) => loader.require(id, fromPath)) as ((id: string) => unknown) & {
      resolve: (id: string) => string;
      cache: Record<string, unknown>;
      extensions: Record<string, unknown>;
      main: undefined;
    };
    req.resolve = (id: string) => {
      const resolved = loader.resolver.resolve(id, { fromFile: fromPath, esm: false });
      return resolved.id;
    };
    req.cache = {};
    req.extensions = {};
    req.main = undefined;
    return req;
  });

  log('[real-vite/worker] importing vite…\n');
  const viteNs = (await loader.import('vite', `${root}/__entry__.mjs`)) as unknown as {
    createServer: (cfg: ViteUserConfig) => Promise<ViteDevServer>;
  };

  // HMR bridge in THIS realm. Iframe-side BroadcastChannel client
  // unchanged — it reaches the server regardless of which realm hosts it.
  const hmrBridge: HmrBridgeHandle = setupHmrBridge({ port });
  log(`[real-vite/worker] hmr bridge ready at ${hmrBridge.url}\n`);

  log(`[real-vite/worker] starting dev server on port ${port}…\n`);
  const server = await viteNs.createServer({
    root,
    server: {
      port,
      strictPort: true,
      middlewareMode: false,
      hmr: false,
      host: true,
      allowedHosts: true,
    } as unknown as ViteUserConfig['server'],
    appType: 'spa',
    clearScreen: false,
    optimizeDeps: { disabled: true } as unknown as ViteUserConfig['optimizeDeps'],
    plugins: [createHmrBridgeVitePlugin({ port })],
  });
  await server.listen();
  log(`[real-vite/worker] vite is listening on internal port ${port}\n`);

  server.watcher?.on('change', (file) => {
    hmrBridge.broadcast(JSON.stringify({ type: 'update', path: file }));
  });

  // Cross-realm preview port. The page-realm `bridgeCrossRealmPreview`
  // posts every incoming SW preview request over BroadcastChannel and
  // awaits our reply. We dispatch through the WORKER-LOCAL `@riftydev/net`
  // registry (Vite registered `port` when its dev server `listen`'d).
  const tearPreviewBridge = serveCrossRealmPreview(port, async (request) =>
    dispatchToPort(port, request),
  );
  log('[real-vite/worker] cross-realm preview port bridge ready\n');

  // Hold references so GC doesn't drop them. The kernel terminates the
  // realm when the page-side `.kill()`s; we don't need explicit teardown
  // because every resource above is closed by realm death.
  // (Future ADR-0011 follow-up: an explicit `onShutdown` hook would let
  // us close BroadcastChannels deterministically before exit, which
  // matters for hot-restart cases.)
  void tearVfsBridge;
  void tearPreviewBridge;
  void server;
}

await bootstrap();
