/**
 * Real Vite, running in the playground's main-thread realm.
 *
 * Flow:
 *   1. Configure `@rifty/runtime-js` globals (`process`, `Buffer`) on this
 *      realm so Vite's many `node:*` imports resolve.
 *   2. Seed a minimal project tree (`index.html`, `src/main.js`,
 *      `package.json`) in the shared sync mirror.
 *   3. Drive `@rifty/npm-client` to install Vite from the npm proxy. The
 *      installer drops tarballs into `/workspace/node_modules/*` via our
 *      `SyncMirrorVfs` so the runtime can see them immediately.
 *   4. Overlay an `esbuild` shim — the real package's binary launcher is a
 *      no-go in a browser, so we substitute a passthrough.
 *   5. Build a `runtime-js` module loader rooted at `/workspace`, dynamic-
 *      import `vite`, and call `createServer()`.
 *   6. Bridge the dev server's port into the existing service-worker preview
 *      route so the iframe at `/preview/<port>/` actually serves the app.
 *
 * Failures along the way are surfaced to the caller as plain Error objects
 * (so the UI can show them in the terminal). We intentionally never silently
 * stub or swallow — every gap throws.
 */
import '@rifty/net/register-builtins';
import { RegistryClient, install } from '@rifty/npm-client';
// The four `./builtins/*` subpath imports below are part of @rifty/runtime-js's
// public surface (see ADR 0018).
import { Buffer } from '@rifty/runtime-js/builtins/buffer';
import { __setCreateRequireImpl } from '@rifty/runtime-js/builtins/module';
import { installProcessGlobals } from '@rifty/runtime-js/builtins/process';
import { installTimerGlobals } from '@rifty/runtime-js/builtins/timers';
import { createModuleLoader } from '@rifty/runtime-js/loader';
import { dirname, normalizePath, syncMirror } from '@rifty/vfs';
import { esbuildShimFiles, rollupShimFiles } from './esbuild-shim.ts';
import { type HmrBridgeHandle, createHmrBridgeVitePlugin, setupHmrBridge } from './hmr-bridge.ts';
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';
import { proxiedRegistryFetch } from './registry-fetch.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

export interface RealViteHandle {
  readonly port: number;
  close(): Promise<void>;
  updateEntry(content: string): void;
}

export interface RealViteOptions {
  root?: string;
  entry?: string;
  port?: number;
  onLog?(line: string): void;
}

const enc = new TextEncoder();

const INITIAL_INDEX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>rifty + real Vite</title></head>
  <body>
    <h1>Hello from rifty</h1>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`;

const INITIAL_MAIN_JS = `document.getElementById('app').textContent =
  'Hello from real Vite running entirely in the browser — edit me, save.';
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

// alternative is a dedicated Worker + cross-realm `@rifty/net` registry
// bridge; deferred until we hit a concrete UI-freeze issue.
let globalsInstalled = false;
function installRuntimeGlobalsOnce(): void {
  if (globalsInstalled) return;
  globalsInstalled = true;
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

export async function startRealVite(opts: RealViteOptions = {}): Promise<RealViteHandle> {
  const root = opts.root ?? '/workspace';
  const entryRel = opts.entry ?? '/src/main.js';
  const port = opts.port ?? 5174;
  const entryPath = `${root}${entryRel}`;
  const log = opts.onLog ?? (() => {});

  installRuntimeGlobalsOnce();
  seedProject(root, entryPath);

  log(`[real-vite] installing vite into ${root}/node_modules…\n`);
  const registry = new RegistryClient({ fetch: proxiedRegistryFetch() });
  const vfs = new SyncMirrorVfs();
  const result = await install(
    'rifty-vite-app',
    '0.0.0',
    { vite: '^5.4.0' },
    { vfs, cwd: root, registry },
  );
  log(
    `[real-vite] installed ${result.packages.length} packages (${result.conflicts.length} conflicts)\n`,
  );

  // Overlay shims AFTER install — esbuild loader binary and rollup native
  // parser both can't run in-browser.
  overlayShims();
  log('[real-vite] esbuild + rollup-native shims overlaid\n');

  // Build a module loader rooted at /workspace, hook node:module to it.
  // The module loader consumes `@rifty/vfs:FsSync` directly (ADR-0037), so
  // the shared `syncMirror()` is the right thing to pass — no adapter layer.
  const loader = createModuleLoader(syncMirror(), { cwd: root });
  __setCreateRequireImpl((from: string) => {
    // Callers may pass either a plain VFS path or a `file://…` URL string
    // (e.g. `import.meta.url` round-tripped through `pathToFileURL`).
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

  log('[real-vite] importing vite…\n');
  const viteNs = (await loader.import('vite', `${root}/__entry__.mjs`)) as unknown as {
    createServer: (cfg: ViteUserConfig) => Promise<ViteDevServer>;
  };

  // Spin up the cross-realm HMR bridge **before** Vite starts so the
  // plugin's `transformIndexHtml` hook (the only entry point that needs the
  // channel name) sees a stable `port`. The bridge owns the page-realm
  // `BridgedWebSocketServer` that the preview iframe's inlined HMR client
  // connects to over `BroadcastChannel` — see ADR-0017 phase 1 acceptance
  // and `apps/playground/src/glue/hmr-bridge.ts`.
  const hmrBridge: HmrBridgeHandle = setupHmrBridge({ port });
  log(`[real-vite] hmr bridge ready at ${hmrBridge.url}\n`);

  log(`[real-vite] starting dev server on port ${port}…\n`);
  const server = await viteNs.createServer({
    root,
    server: {
      port,
      strictPort: true,
      middlewareMode: false,
      // Vite's native HMR client opens a browser-native `WebSocket`, which
      // can't reach an in-realm server and can't be intercepted by the SW.
      // The cross-realm bridge replaces it (ADR-0017 phase 1): the preview
      // iframe runs a `BroadcastChannel`-backed client injected by our
      // `rifty:hmr-bridge` Vite plugin. The Vite-native HMR machinery stays
      // off — Vite still does its module-graph invalidation work on
      // `watcher.change`, we just deliver the notification ourselves.
      hmr: false,
      // Requests come in via the SW preview-bridge with `Host: preview.local`
      // (or undefined). Disable Vite's host allow-list so it serves them.
      host: true,
      allowedHosts: true,
    } as unknown as ViteUserConfig['server'],
    appType: 'spa',
    clearScreen: false,
    optimizeDeps: { disabled: true } as unknown as ViteUserConfig['optimizeDeps'],
    plugins: [createHmrBridgeVitePlugin({ port })],
  });
  await server.listen();
  log(`[real-vite] vite is listening — preview at /preview/${port}/\n`);

  // Wire Vite's file watcher into the bridge. Vite owns the change-detection
  // primitive (chokidar / fs.watch over `root`); we just forward each event
  // through `BridgedWebSocketServer.broadcast` so every subscribed iframe
  // receives the HMR payload.
  server.watcher?.on('change', (file) => {
    hmrBridge.broadcast(JSON.stringify({ type: 'update', path: file }));
  });

  // Shared adapter wiring — see `preview-bridge-wiring.ts`. ADR-0017 phase 1
  // streaming flows through as a `ReadableStream` when supported, with a
  // buffered fallback for older runtimes.
  const tearBridge = mountPlaygroundPreviewBridge();

  return {
    port,
    async close() {
      tearBridge();
      hmrBridge.close();
      try {
        await server.close();
      } catch (err) {
        log(`[real-vite] close error: ${(err as Error).message}\n`);
      }
    },
    updateEntry(content) {
      syncMirror().writeFileSync(entryPath, enc.encode(content));
    },
  };
}

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
  /** chokidar-shaped watcher exposed by Vite — present in dev mode. */
  watcher?: ViteWatcher;
}
