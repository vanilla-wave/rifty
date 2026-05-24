import { dispatchToPort } from '@rifty/net';
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
import { RegistryClient, install } from '@rifty/npm-client';
import '@rifty/net/register-builtins';
// The four `./builtins/*` subpath imports below are part of @rifty/runtime-js's
// public surface (see ADR 0018).
import { Buffer } from '@rifty/runtime-js/builtins/buffer';
import { __setCreateRequireImpl } from '@rifty/runtime-js/builtins/module';
import { installProcessGlobals } from '@rifty/runtime-js/builtins/process';
import { installTimerGlobals } from '@rifty/runtime-js/builtins/timers';
import { createModuleLoader } from '@rifty/runtime-js/loader';
import type { SyncVfs } from '@rifty/runtime-js/loader';
import { type SerializedRequest, setupPreviewBridge } from '@rifty/service-worker';
import { dirname, normalizePath, syncMirror } from '@rifty/vfs';
import { esbuildShimFiles, rollupShimFiles } from './esbuild-shim.ts';
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
const dec = new TextDecoder();

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

function makeSyncVfs(): SyncVfs {
  const m = syncMirror();
  return {
    existsSync: (p: string) => m.existsSync(p),
    readFileSync: (p: string) => dec.decode(m.readFileBytesSync(p)),
    readFileBytesSync: (p: string) => m.readFileBytesSync(p),
    statSync: (p: string) => {
      const st = m.statSync(p);
      return { isFile: st.isFile, isDirectory: st.isDirectory };
    },
    readdirSync: (p: string) => m.readdirSync(p),
  };
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
  const syncVfs = makeSyncVfs();
  const loader = createModuleLoader(syncVfs, { cwd: root });
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

  log(`[real-vite] starting dev server on port ${port}…\n`);
  const server = await viteNs.createServer({
    root,
    server: {
      port,
      strictPort: true,
      middlewareMode: false,
      hmr: false,
      // Requests come in via the SW preview-bridge with `Host: preview.local`
      // (or undefined). Disable Vite's host allow-list so it serves them.
      host: true,
      allowedHosts: true,
    } as unknown as ViteUserConfig['server'],
    appType: 'spa',
    clearScreen: false,
    optimizeDeps: { disabled: true } as unknown as ViteUserConfig['optimizeDeps'],
    plugins: [],
  });
  await server.listen();
  log(`[real-vite] vite is listening — preview at /preview/${port}/\n`);

  const tearBridge = setupPreviewBridge(async (req: SerializedRequest) => {
    const headers = new Headers(req.headers);
    const init: RequestInit = { method: req.method, headers };
    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      const copy = new ArrayBuffer(req.body.byteLength);
      new Uint8Array(copy).set(req.body);
      init.body = copy;
    }
    const response = await dispatchToPort(req.port, new Request(req.url, init));
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body,
    };
  });

  return {
    port,
    async close() {
      tearBridge();
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

interface ViteDevServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
}
