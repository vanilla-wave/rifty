/// <reference lib="webworker" />
/**
 * Dev-server boot core (ADR-0148 / ADR-0150 P6b). Extracted from
 * real-vite-bootstrap so the supervised dev-server CHILD realm can import it
 * (dev-server-child-bootstrap). Runs ONLY in that child today — the owner is a
 * pure async supervisor and no longer imports it. Realm-portable by construction
 * — it only touches `syncMirror()` (the remote mirror in the child), the net
 * registry (the child registers net builtins), the npm client (install over RPC),
 * and the injected `publishSnapshot`/`log` callbacks.
 *
 * IMPORTANT: NO top-level side effects (only declarations + `const enc`).
 * `registerNetBuiltins`/`registerSqliteBuiltin` stay in the ENTRY modules, never here.
 */
import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import { dispatchToPort, listPorts, serveCrossRealmPreview } from '@riftydev/net';
import { initSqliteEngine } from '@riftydev/net/sqlite/engine';
import { Console } from '@riftydev/runtime-js/builtins/console';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import type { SqlJsConfig } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { viteBrowserShimFiles } from '../glue/esbuild-shim.ts';
import {
  createHmrBridgeToken,
  createHmrBridgeVitePlugin,
  hmrBridgeUrl,
} from '../glue/hmr-bridge.ts';
import type {
  BootstrapConfig,
  NodeServerBootstrapConfig,
  ProjectSpec,
} from '../templates/project-spec.ts';
import type { DevServerHandle } from './dev-server-controller.ts';
import { installEsbuildTransformBridge } from './esbuild-wasi-transform.ts';
import { type ViteModuleGraph, invalidateViteModule } from './real-vite-invalidation.ts';

const enc = new TextEncoder();

interface ViteUserConfig {
  root?: string;
  base?: string;
  server?: {
    port?: number;
    strictPort?: boolean;
    middlewareMode?: boolean;
    hmr?:
      | false
      | {
          protocol: 'ws';
          host: string;
          clientPort: number;
          path: string;
        };
    host?: boolean;
    allowedHosts?: boolean;
  };
  appType?: string;
  clearScreen?: boolean;
  optimizeDeps?: { disabled?: boolean };
  plugins?: unknown[];
}

interface ViteWatcher {
  on(event: 'change', cb: (file: string) => void): void;
  emit?(event: 'change', file: string): unknown;
}

interface ViteDevServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
  watcher?: ViteWatcher;
  moduleGraph?: ViteModuleGraph;
}

/** Drain this realm's OPFS write-through (no-op on the memory backend). */
export async function flushSyncMirror(): Promise<void> {
  const mirror = syncMirror() as { flush?: () => Promise<void> };
  if (typeof mirror.flush === 'function') await mirror.flush();
}

// The esbuild/rollup shim files (`@riftydev/shadow-registry`) are keyed on the
// historical `/workspace/node_modules/...` path. The dev server now boots at the
// ACTIVE ROOT (ADR-0165 §4: `/scratch` or `/projects/<id>`), so the shim MUST be
// re-rooted to `<root>/node_modules/...` — else it overlays a dead `/workspace`
// path and the REAL native rollup/esbuild loads (Rollup throws "platform 'rifty'
// arch 'wasm' not supported by the native build"), breaking every Vite dev boot.
const SHIM_ROOT_PREFIX = '/workspace';
/**
 * Re-root a `/workspace/...`-keyed shim path onto the ACTIVE root (ADR-0165 §4).
 * Exported for the unit guard; a path that isn't `/workspace`-prefixed is returned
 * verbatim (defensive — no shim file should escape the prefix).
 */
export function reRootShimPath(shimPath: string, root: string): string {
  return shimPath.startsWith(`${SHIM_ROOT_PREFIX}/`)
    ? `${root}${shimPath.slice(SHIM_ROOT_PREFIX.length)}`
    : shimPath;
}
function overlayShims(root: string): void {
  const fs = syncMirror();
  for (const [path, content] of Object.entries(viteBrowserShimFiles)) {
    const np = normalizePath(reRootShimPath(path, root));
    fs.mkdirSync(dirname(np), { recursive: true });
    fs.writeFileSync(np, enc.encode(content));
  }
}

type Loader = ReturnType<typeof createModuleLoader>;

/**
 * Wait for the entry to register `port` with the net registry (its
 * `listen(port)` call). Polled briefly: a top-level `await` in the entry may
 * defer the listen past the import's resolution.
 */
async function waitForListeningPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listPorts().includes(port)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  // A listen() landing during the final sleep must not read as a dead server.
  if (listPorts().includes(port)) return;
  throw new Error(
    `[real-vite/worker] entry never started listening on port ${port} — a node-server template entry must call listen(process.env.PORT)`,
  );
}

/**
 * Node-server tail: optionally bring up the `node:sqlite` engine, then run the
 * ENTRY as the server program and wait for its `listen(port)`.
 */
async function bootNodeServer(
  cfg: NodeServerBootstrapConfig,
  loader: Loader,
  log: (chunk: string) => void,
): Promise<void> {
  if (cfg.sqlite) {
    // wasmBinary (not locateFile): the bundled same-origin asset is fetched
    // here, so the emscripten glue never walks its Node fs / web fetch
    // environment-detection paths inside the worker realm.
    log('[real-vite/worker] bringing up the node:sqlite WASM engine…\n');
    const wasmResponse = await fetch(sqlWasmUrl);
    if (!wasmResponse.ok) {
      throw new Error(`[real-vite/worker] sql.js wasm fetch failed: HTTP ${wasmResponse.status}`);
    }
    const wasmBinary = await wasmResponse.arrayBuffer();
    log(`[real-vite/worker] sql.js wasm fetched: ${wasmBinary.byteLength} bytes\n`);
    // locateFile must ALSO be pinned: the emscripten glue computes the wasm
    // path eagerly even when wasmBinary is provided, and the engine's default
    // (import.meta.resolve on a bare specifier) throws inside a bundled worker.
    const config: SqlJsConfig & { readonly wasmBinary: ArrayBuffer } = {
      wasmBinary,
      locateFile: () => sqlWasmUrl,
    };
    // Diagnosable failure over a silent stall: surface WHERE the engine died.
    const engineTimeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('[real-vite/worker] node:sqlite engine bring-up timed out (30s)')),
        30_000,
      );
    });
    await Promise.race([initSqliteEngine(config), engineTimeout]);
    log('[real-vite/worker] node:sqlite engine ready\n');
  }

  // Node parity: console.log IS stdout. Route the server program's console into
  // the dev-run's terminal stream (ADR-0148/0150 P6b: the dev server runs in a
  // supervised child; its boot AND async request logs land in the playground
  // terminal via `log` = this child's stdout port → the active `npm run dev`
  // run's `ctx.stdout`, live for the whole run — not the worker devtools).
  const termWriter = {
    write(chunk: string): boolean {
      log(chunk);
      return true;
    },
  };
  (globalThis as { console: unknown }).console = new Console(termWriter, termWriter);

  log(`[real-vite/worker] starting server ${cfg.entryPath} on port ${cfg.port}…\n`);
  await loader.import(cfg.entryPath, `${cfg.root}/__entry__.mjs`);
  await waitForListeningPort(cfg.port, 10_000);
  log(`[real-vite/worker] server is listening on internal port ${cfg.port}\n`);
}

/**
 * Boot the co-resident dev server (ADR-0148) INSIDE the workspace owner: run
 * the idempotent dependency-arrival (against THIS realm's tree — the one the
 * shell installs into, so vite sees terminal-installed deps), build the module
 * loader, start vite / the node server, and register the preview + HMR bridges.
 * Returns a stop handle (`server.close()` + bridge disposal) so Ctrl-C stops the
 * dev server WITHOUT killing the owner. `log` streams progress to the session.
 *
 * node-server stop is best-effort: the entry IS the server (an ESM module,
 * evaluated once), so stop tears the preview bridges but the program keeps
 * running — a graceful server stop is deferred (the ADR-0144 model is hard-kill today).
 */
export async function bootDevServer(opts: {
  readonly cfg: BootstrapConfig;
  readonly port: number;
  readonly root: string;
  readonly spec: ProjectSpec;
  readonly slug: string;
  readonly fromScratch: boolean;
  readonly publishSnapshot: () => void;
  readonly log: (chunk: string) => void;
}): Promise<DevServerHandle> {
  const { cfg, port, root, publishSnapshot, log } = opts;

  // Seed the template's package.json + files IF ABSENT — never overwrite. A
  // force-overwrite here discarded the user's `npm install` additions on every
  // boot (package.json reverted to the template deps → the stamp's dep check
  // failed → the baked snapshot replaced node_modules, dropping the install), so
  // an installed CLI never survived a reload. A genuine preset switch resets
  // package.json in the `boot` closure (alongside the node_modules/lockfile
  // clear); a same-template reload preserves the user's tree.
  const seedFs = syncMirror();
  function seedTemplateFiles(opts: { nodeModulesOnly: boolean }): void {
    seedFs.mkdirSync(root, { recursive: true });
    if (!opts.nodeModulesOnly && !seedFs.existsSync(`${root}/package.json`)) {
      seedFs.writeFileSync(`${root}/package.json`, enc.encode(cfg.packageJson));
    }
    for (const [seedPath, content] of Object.entries(cfg.seedFiles)) {
      const np = normalizePath(seedPath);
      if (np === `${root}/package.json`) continue;
      if (opts.nodeModulesOnly && !np.startsWith(`${root}/node_modules/`)) continue;
      seedFs.mkdirSync(dirname(np), { recursive: true });
      if (!seedFs.existsSync(np)) seedFs.writeFileSync(np, enc.encode(content));
    }
  }
  seedTemplateFiles({ nodeModulesOnly: false });

  // node_modules is a PRECONDITION of the dev line, never a side effect — faithful
  // to real npm (`npm run dev` / `vite` runs the program; it does NOT install). The
  // owner pre-seeds instant deps from the baked snapshot at project-seed; from-scratch
  // deps come from the explicit `npm install` boot step (or the user). A missing tree
  // → vite/node fails loudly with a real "Cannot find module" (the honest gap).
  publishSnapshot();

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
    req.resolve = (id: string) =>
      loader.resolver.resolve(id, { fromFile: fromPath, esm: false }).id;
    req.cache = {};
    req.extensions = {};
    req.main = undefined;
    return req;
  });

  let activeServer: ViteDevServer | null = null;
  const syntheticWatcherChanges = new Set<string>();
  function handleViteFileChange(path: string): void {
    const modulePath = normalizePath(path);
    if (activeServer) {
      try {
        syntheticWatcherChanges.add(modulePath);
        invalidateViteModule(activeServer, modulePath);
      } catch (err) {
        log(`module invalidation failed for ${modulePath}: ${(err as Error).message}\n`);
      } finally {
        syntheticWatcherChanges.delete(modulePath);
      }
    }
  }

  // The node-server entry binds `process.env.PORT`. In the supervised child this
  // already equals the dev port (the spawn env sets PORT=devPort, ADR-0150 P6b);
  // re-assert it defensively so the entry always listens on the routed port.
  globalThis.process.env.PORT = String(port);

  if (cfg.runtime === 'node-server') {
    await bootNodeServer(cfg, loader, log);
    publishSnapshot();
  }

  if (cfg.runtime === 'vite') {
    overlayShims(root);
    installEsbuildTransformBridge(root);
    log(`importing ${cfg.runtimeSpecifier}…\n`);
    const viteNs = (await loader.import(
      cfg.runtimeSpecifier,
      `${root}/__entry__.mjs`,
    )) as unknown as {
      createServer: (config: ViteUserConfig) => Promise<ViteDevServer>;
    };
    // Only wire (and announce) the HMR bridge when HMR is actually enabled. With
    // the Vite 8 template HMR is OFF (ADR-0161), so don't mint a token or log a
    // "bridge ready" line for a bridge that is never installed (no false signal).
    const hmrBridgeToken = cfg.hmrEnabled ? createHmrBridgeToken() : null;
    if (hmrBridgeToken !== null) {
      log(`[real-vite/worker] hmr bridge ready at ${hmrBridgeUrl(port, hmrBridgeToken)}\n`);
    }
    log(`[real-vite/worker] starting dev server on port ${port}…\n`);
    const server = await viteNs.createServer({
      root,
      base: './',
      server: {
        port,
        strictPort: cfg.server.strictPort,
        middlewareMode: false,
        hmr: hmrBridgeToken
          ? {
              protocol: 'ws',
              host: PREVIEW_LOCAL_HOST,
              clientPort: port,
              path: `__hmr/${encodeURIComponent(hmrBridgeToken)}`,
            }
          : false,
        host: cfg.server.host,
        allowedHosts: cfg.server.allowedHosts,
      },
      appType: cfg.server.appType,
      clearScreen: false,
      // Vite 8 REMOVED `optimizeDeps.disabled` (Vite 5.1) — it warns and ignores
      // it, then runs dep discovery on the first request, which drives Rolldown's
      // WASI bundler and hung the preview request past the readiness window. The
      // supported off-switch is `noDiscovery: true` + empty `include`.
      optimizeDeps: (cfg.server.optimizeDepsDisabled
        ? { noDiscovery: true, include: [] }
        : {}) as unknown as ViteUserConfig['optimizeDeps'],
      plugins: hmrBridgeToken ? [createHmrBridgeVitePlugin({ port, token: hmrBridgeToken })] : [],
    });
    await server.listen();
    activeServer = server;
    log(`[real-vite/worker] vite is listening on internal port ${port}\n`);
    // User-facing readiness line (the terminal/e2e wait on it): the server is up
    // and the preview route is about to be served on the public port.
    log(`[vite] dev server ready on port ${port}\n`);
    publishSnapshot();
    server.watcher?.on('change', (file) => {
      const modulePath = normalizePath(file);
      if (syntheticWatcherChanges.has(modulePath)) {
        publishSnapshot();
        return;
      }
      publishSnapshot();
    });
  }

  // Cross-realm preview route (ADR-0150 P6b): the child owns listen() and serves
  // `/preview/<port>/` over BroadcastChannel. The page wires its side on the
  // `pty:dev-server{running,port}` frame (ADR-0148) — the SW-direct route is
  // page-anchored (mountPlaygroundPreviewBridge). `setupPreviewBridge` no-ops in
  // any worker realm, so it is NOT called here (ADR-0150 corrected).
  const tearPreviewBridge = serveCrossRealmPreview(port, async (request) =>
    dispatchToPort(port, request),
  );
  log('[real-vite/worker] preview bridge ready\n');

  return {
    port,
    onFileChanged: handleViteFileChange,
    async stop() {
      try {
        await activeServer?.close();
      } catch {
        /* idempotent: double stop / a server that never listened */
      }
      tearPreviewBridge();
    },
  };
}
