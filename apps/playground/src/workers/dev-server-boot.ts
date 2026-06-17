/// <reference lib="webworker" />
/**
 * Co-resident dev-server boot core (ADR-0148 / ADR-0150 P6b). Extracted from
 * real-vite-bootstrap so it runs in EITHER realm: today the owner imports it,
 * P6b spawns a child realm that imports it. Realm-portable by construction — it
 * only touches `syncMirror()` (the remote mirror in the child), the net registry
 * (the child registers net builtins), the npm client (install over RPC), and the
 * injected `publishSnapshot`/`log` callbacks.
 *
 * IMPORTANT: NO top-level side effects (only declarations + `const enc`).
 * `registerNetBuiltins`/`registerSqliteBuiltin` stay in the ENTRY modules, never here.
 */
import { dispatchToPort, listPorts, serveCrossRealmPreview } from '@riftydev/net';
import { initSqliteEngine } from '@riftydev/net/sqlite/engine';
import { RegistryClient, install } from '@riftydev/npm-client';
import { Console } from '@riftydev/runtime-js/builtins/console';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import {
  type SerializedRequest,
  type SerializedResponse,
  setupPreviewBridge,
} from '@riftydev/service-worker';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import type { SqlJsConfig } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { esbuildShimFiles, rollupShimFiles } from '../glue/esbuild-shim.ts';
import {
  type HmrBridgeHandle,
  createHmrBridgeToken,
  createHmrBridgeVitePlugin,
  setupHmrBridge,
} from '../glue/hmr-bridge.ts';
import { ensureProjectDependencies } from '../glue/project-deps.ts';
import { proxiedRegistryFetch } from '../glue/registry-fetch.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type {
  BootstrapConfig,
  NodeServerBootstrapConfig,
  ProjectSpec,
} from '../templates/project-spec.ts';
import type { DevServerHandle } from './dev-server-controller.ts';
import { type ViteModuleGraph, invalidateViteModule } from './real-vite-invalidation.ts';

const enc = new TextEncoder();

interface ViteUserConfig {
  root?: string;
  base?: string;
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
  moduleGraph?: ViteModuleGraph;
}

/** Drain this realm's OPFS write-through (no-op on the memory backend). */
export async function flushSyncMirror(): Promise<void> {
  const mirror = syncMirror() as { flush?: () => Promise<void> };
  if (typeof mirror.flush === 'function') await mirror.flush();
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

async function dispatchSerializedPreview(req: SerializedRequest): Promise<SerializedResponse> {
  const headers = new Headers(req.headers);
  const init: RequestInit = { method: req.method, headers };
  if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
    const copy = new ArrayBuffer(req.body.byteLength);
    new Uint8Array(copy).set(req.body);
    init.body = copy;
  }
  const response = await dispatchToPort(req.port, new Request(req.url, init));
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: response.body,
  };
}

type Loader = ReturnType<typeof createModuleLoader>;

function toRootRelativePath(root: string, path: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) return '/';
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length);
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

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
  // the dev-run's terminal stream (ADR-0148, co-resident dev server in the owner:
  // the server's boot AND async request logs land in the playground terminal,
  // not the worker devtools —
  // the persistent owner's global stdout goes to the owner diagnostic, so wire to
  // `log` = the active `npm run dev` run's `ctx.stdout`, live for the whole run).
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
  readonly ownerToken: string | undefined;
  readonly publishSnapshot: () => void;
  readonly log: (chunk: string) => void;
}): Promise<DevServerHandle> {
  const { cfg, port, root, spec, slug, fromScratch, ownerToken, publishSnapshot, log } = opts;

  // Seed the template's package.json + files IF ABSENT — never overwrite. A
  // force-overwrite here discarded the user's `npm install` additions on every
  // boot (package.json reverted to the template deps → the stamp's dep check
  // failed → the baked snapshot replaced node_modules, dropping the install), so
  // an installed CLI never survived a reload. A genuine preset switch resets
  // package.json in the `boot` closure (alongside the node_modules/lockfile
  // clear); a same-template reload preserves the user's tree.
  const seedFs = syncMirror();
  seedFs.mkdirSync(root, { recursive: true });
  if (!seedFs.existsSync(`${root}/package.json`)) {
    seedFs.writeFileSync(`${root}/package.json`, enc.encode(cfg.packageJson));
  }
  for (const [seedPath, content] of Object.entries(cfg.seedFiles)) {
    const np = normalizePath(seedPath);
    if (np === `${root}/package.json`) continue;
    seedFs.mkdirSync(dirname(np), { recursive: true });
    if (!seedFs.existsSync(np)) seedFs.writeFileSync(np, enc.encode(content));
  }

  // Dependency arrival (ADR-0135): idempotent via the install stamp — a no-op if
  // the user already ran `npm install`. instant reuses the baked snapshot quietly;
  // from-scratch streams a real install to the terminal.
  const vfs = new SyncMirrorVfs();
  await ensureProjectDependencies({
    vfs,
    fsSync: syncMirror(),
    root,
    templateId: spec.id,
    slug,
    snapshotUrl: fromScratch ? undefined : cfg.bakedNodeModulesUrl,
    install: async () => {
      log(`installing ${spec.displayName} into ${root}/node_modules…\n`);
      const registry = new RegistryClient({ fetch: proxiedRegistryFetch() });
      const result = await install({
        vfs,
        cwd: root,
        registry,
        onPackage: fromScratch
          ? (event) =>
              log(`npm: + ${event.name}@${event.version}${event.cacheHit ? ' (cached)' : ''}\n`)
          : undefined,
      });
      log(`installed ${result.packages.length} packages (${result.conflicts.length} conflicts)\n`);
      return { packages: result.packages.length };
    },
    flush: flushSyncMirror,
    log,
  });
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

  const hmrBridgeRef: { current?: HmrBridgeHandle } = {};
  let activeServer: ViteDevServer | null = null;
  function broadcastFileUpdate(path: string): void {
    const modulePath = normalizePath(path);
    if (activeServer) {
      try {
        invalidateViteModule(activeServer, modulePath);
      } catch (err) {
        log(`module invalidation failed for ${modulePath}: ${(err as Error).message}\n`);
      }
    }
    hmrBridgeRef.current?.broadcast(
      JSON.stringify({
        type: 'update',
        event: 'change',
        path: toRootRelativePath(root, modulePath),
      }),
    );
  }

  // The node-server entry binds `process.env.PORT`; the persistent owner's PORT
  // env is its SPAWN-time default (the default template), so a preset switch must
  // point it at the CURRENT template's dev port before the entry listens.
  globalThis.process.env.PORT = String(port);

  if (cfg.runtime === 'node-server') {
    await bootNodeServer(cfg, loader, log);
    publishSnapshot();
  }

  if (cfg.runtime === 'vite') {
    overlayShims();
    log(`importing ${cfg.runtimeSpecifier}…\n`);
    const viteNs = (await loader.import(
      cfg.runtimeSpecifier,
      `${root}/__entry__.mjs`,
    )) as unknown as {
      createServer: (config: ViteUserConfig) => Promise<ViteDevServer>;
    };
    const hmrBridgeToken = createHmrBridgeToken();
    hmrBridgeRef.current = setupHmrBridge({ port, token: hmrBridgeToken });
    log(`starting dev server on port ${port}…\n`);
    const server = await viteNs.createServer({
      root,
      base: './',
      server: {
        port,
        strictPort: cfg.server.strictPort,
        middlewareMode: false,
        hmr: false,
        host: cfg.server.host,
        allowedHosts: cfg.server.allowedHosts,
      } as unknown as ViteUserConfig['server'],
      appType: cfg.server.appType,
      clearScreen: false,
      optimizeDeps: {
        disabled: cfg.server.optimizeDepsDisabled,
      } as unknown as ViteUserConfig['optimizeDeps'],
      plugins: cfg.hmrEnabled ? [createHmrBridgeVitePlugin({ port, token: hmrBridgeToken })] : [],
    });
    await server.listen();
    activeServer = server;
    log(`vite is listening on internal port ${port}\n`);
    publishSnapshot();
    server.watcher?.on('change', (file) => {
      broadcastFileUpdate(file);
      publishSnapshot();
    });
  }

  // Direct SW→Worker preview route (A-023) + cross-realm fallback. The page wires
  // its side on the `pty:dev-server{running,port}` frame (ADR-0148).
  const tearDirectSwBridge = setupPreviewBridge(dispatchSerializedPreview, {
    ports: [port],
    ownerToken,
  });
  const tearPreviewBridge = serveCrossRealmPreview(port, async (request) =>
    dispatchToPort(port, request),
  );
  log('[real-vite/worker] preview bridges ready\n');

  return {
    port,
    onFileChanged: broadcastFileUpdate,
    async stop() {
      try {
        await activeServer?.close();
      } catch {
        /* idempotent: double stop / a server that never listened */
      }
      tearDirectSwBridge();
      tearPreviewBridge();
      hmrBridgeRef.current?.close();
    },
  };
}
