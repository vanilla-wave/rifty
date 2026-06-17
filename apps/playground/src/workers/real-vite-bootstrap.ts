/// <reference lib="webworker" />

/**
 * Real project bootstrap (ADR-0043 — Vite-in-Worker, M11 / A-026; extended for
 * the `node-server` template runtime).
 *
 * Loaded by the kernel-worker bootstrap via `import(spec.entry.url)` once the
 * `WorkerInitMessage` lands. By the time this evaluates, `globalThis.process`
 * is the Node-shape shim from the kernel's pre-entry hook and `process.env`
 * carries the env the page-realm adapter put on the `WorkerSpawnSpec`.
 *
 * The common head (runtime globals, VFS bridges, seed, npm install, module
 * loader) is template-agnostic; the tail dispatches on the template's runtime:
 * - `'vite'` — import the dev-server package and boot it (HMR bridge, shims).
 * - `'node-server'` — run the ENTRY itself as a long-running server program
 *   (optionally bringing up the `node:sqlite` WASM engine first).
 *
 * Any throw propagates to the kernel's `worker-entry` → exit code 1 +
 * stack-on-stderr; page-side `realVite.ts` forwards stderr into the terminal.
 *
 * Split from `realVite.ts` because this runs in a *worker realm*: the page-realm
 * adapter only orchestrates the spawn and must not import the heavy install/Vite
 * paths (A-026's whole point is the page realm stops paying for them).
 */

import { getKernelDispatcher, readKernelProcessSpec, setKernelWorkerUrl } from '@riftydev/kernel';
import { dispatchToPort, listPorts, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { initSqliteEngine } from '@riftydev/net/sqlite/engine';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { RegistryClient, install } from '@riftydev/npm-client';
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';
import { Console } from '@riftydev/runtime-js/builtins/console';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { setNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { installProcessGlobals, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import {
  type SerializedRequest,
  type SerializedResponse,
  setupPreviewBridge,
} from '@riftydev/service-worker';
import { type CommandContext, Shell } from '@riftydev/shell';
import { dirname, initBackend, normalizePath, syncMirror } from '@riftydev/vfs';
import type { SqlJsConfig } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { esbuildShimFiles, rollupShimFiles } from '../glue/esbuild-shim.ts';
import {
  type HmrBridgeHandle,
  createHmrBridgeToken,
  createHmrBridgeVitePlugin,
  setupHmrBridge,
} from '../glue/hmr-bridge.ts';
import { serveNodeModulesReads } from '../glue/node-modules-port.ts';
import { createNpmShellCommand } from '../glue/npm-shell-command.ts';
import { ensureProjectDependencies } from '../glue/project-deps.ts';
import {
  type OwnerToPageFrame,
  PTY_IPC_TYPE,
  isPageToOwner,
  isPtyIpcMessage,
} from '../glue/pty-protocol.ts';
import { reachableCwd } from '../glue/reachable-cwd.ts';
import { proxiedRegistryFetch } from '../glue/registry-fetch.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import {
  collectSnapshot,
  publishVfsSnapshot,
  serveSnapshotRequests,
} from '../glue/vfs-snapshot-port.ts';
import { type VfsWriteFrame, applyVfsWriteFrame, serveVfsWrites } from '../glue/vfs-write-port.ts';
import { serveWorkspaceArchive } from '../glue/workspace-archive-port.ts';
import {
  type BootstrapConfig,
  type NodeServerBootstrapConfig,
  type ProjectSpec,
  isDevScriptName,
  resolveBootstrapConfig,
} from '../templates/project-spec.ts';
import { DEFAULT_TEMPLATE_ID, resolveProjectSpec } from '../templates/registry.ts';
import { type DevServerHandle, createDevServerController } from './dev-server-controller.ts';
import { createOwnerChildBinExecutor } from './owner-child-bin-executor.ts';
import { createPtyServer } from './pty-server.ts';
import { type ViteModuleGraph, invalidateViteModule } from './real-vite-invalidation.ts';

const enc = new TextEncoder();

registerNetBuiltins();
registerSqliteBuiltin();

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

function log(line: string): void {
  // Kernel pre-entry hook wired process.stdout.write -> stdout MessagePort;
  // page-side WorkerProcessHandle.stdout() emits each chunk, realVite.ts -> onLog.
  globalThis.process.stdout.write(line);
}

interface ProcStdio {
  stdout?: { write?: unknown };
  stderr?: { write?: unknown };
  env?: Record<string, string | undefined>;
  on?(event: 'message', handler: (message: unknown) => void): unknown;
  send?(message: unknown): unknown;
}

interface KernelIpc {
  onMessage?(handler: (message: unknown) => void): void;
  /** Fork-IPC send back to the page (ADR-0045); absent when no IPC channel. */
  send?(message: unknown): void;
}

interface VfsWriteIpcMessage {
  readonly type: 'rifty:vfs-write';
  readonly frame: VfsWriteFrame;
}

function isVfsWriteIpcMessage(message: unknown): message is VfsWriteIpcMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as { readonly type?: unknown; readonly frame?: unknown };
  return candidate.type === 'rifty:vfs-write' && !!candidate.frame;
}

function installRuntimeGlobals(): KernelIpc {
  // Gotcha: the kernel pre-entry hook's `process` posts stdout/stderr to the
  // page over MessagePorts (the only reason the terminal sees worker output).
  // `installProcessGlobals` swaps in runtime-js's richer shim, but its stdout/
  // stderr default to `console.*` (worker console, NOT page terminal) and env
  // is empty — clobbering the wiring made all worker logs (boot progress AND
  // error stacks) vanish, so a stalled boot looked frozen. Preserve kernel
  // stdio + env across the swap.
  const prev = globalThis.process as unknown as ProcStdio | undefined;
  const kStdout = prev?.stdout;
  const kStderr = prev?.stderr;
  const kEnv = prev?.env;
  const kOnMessage =
    typeof prev?.on === 'function'
      ? (handler: (message: unknown) => void) => {
          prev.on?.('message', handler);
        }
      : undefined;
  // The fork-IPC `send` lives on the kernel pre-entry process shim; the
  // installProcessGlobals swap below drops it, so capture it (bound) BEFORE the
  // swap — the pty server posts owner→page frames through it (ADR-0146).
  const kSend =
    typeof prev?.send === 'function'
      ? (message: unknown) => {
          prev.send?.(message);
        }
      : undefined;
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  const proc = globalThis.process as unknown as ProcStdio;
  if (kStdout && typeof kStdout.write === 'function') proc.stdout = kStdout;
  if (kStderr && typeof kStderr.write === 'function') proc.stderr = kStderr;
  if (kEnv) proc.env = kEnv;
  return { onMessage: kOnMessage, send: kSend };
}

function seedProject(cfg: BootstrapConfig): void {
  const fs = syncMirror();
  fs.mkdirSync(cfg.root, { recursive: true });
  // Idempotent: editor source overwrites the entry afterwards; an existing
  // file (returning session) is left alone.
  for (const [path, content] of Object.entries(cfg.seedFiles)) {
    const np = normalizePath(path);
    fs.mkdirSync(dirname(np), { recursive: true });
    if (!fs.existsSync(np)) {
      fs.writeFileSync(np, enc.encode(content));
    }
  }
  // Default welcome README (single-store-owner: exactly one authoritative store
  // owner, the page holds no authoritative fs): seeded here, idempotently,
  // against the owner's own mirror — moved off the PAGE so the page holds no
  // authoritative store (was App.tsx onMount writing the page `vfs`).
  const readme = normalizePath(`${cfg.root}/README.md`);
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      enc.encode(
        '# workspace\n\nThis is the in-browser virtual filesystem.\n\n- Edit the program in the `src/main.js` tab.\n- Run `npm install <pkg>` in any terminal; installs land in `node_modules`.\n',
      ),
    );
  }
}

/** Drain this realm's OPFS write-through (no-op on the memory backend). */
async function flushSyncMirror(): Promise<void> {
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

/** Apply the optional `RIFTY_RFV_ENTRY` override. */
function withEntryOverride(spec: ProjectSpec, entryRel: string): ProjectSpec {
  if (entryRel === spec.entry.relativePath) return spec;
  return { ...spec, entry: { ...spec.entry, relativePath: entryRel } };
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
async function bootDevServer(opts: {
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

/**
 * Unified workspace owner (ADR-0146 owner-resident shell + ADR-0148 co-resident
 * dev server): this realm hosts the
 * resident `Shell` per session AND the co-resident dev server. npm + the in-realm
 * `.bin` executor + vite/node all run HERE against this realm's `syncMirror()`
 * (the tree the install writes) — one store, no two-owners gap. The dev server
 * starts on demand (`vite` / `npm run <script>`), blocks its run until Ctrl-C,
 * and stops via `server.close()` WITHOUT killing the owner. The realm stays alive
 * on `serve:true` via its IPC channel + served bridges.
 */
async function bootShellOwner(opts: {
  readonly cfg: BootstrapConfig;
  readonly port: number;
  readonly kernelIpc: KernelIpc;
  readonly publishSnapshot: () => void;
  readonly spec: ProjectSpec;
  readonly slug: string;
  readonly fromScratch: boolean;
  readonly ownerToken: string | undefined;
  /** node-entry bootstrap worker URL — the supervised child each CLI runs in (ADR-0150). */
  readonly nodeEntryWorkerUrl: string;
}): Promise<void> {
  const { cfg, port, kernelIpc, publishSnapshot, spec, slug, fromScratch, ownerToken } = opts;

  seedProject(cfg);
  publishSnapshot();
  // Readiness handshake (ADR-0146, explorer reflects the owner tree): the page
  // replies-via-request rather than a blind retry-storm. Startup publish covers a
  // subscribed page; this covers a page that subscribes/reloads after us.
  const tearSnapReq = serveSnapshotRequests(port, publishSnapshot);

  // Owner→page frames (pty + dev-server status). republish on `pty:exit` since a
  // finished command may have mutated the tree (ADR-0146: owner republishes its
  // snapshot on command exit so the explorer reflects the owner tree).
  const send = (frame: OwnerToPageFrame): void => {
    kernelIpc.send?.({ type: PTY_IPC_TYPE, frame });
    if (frame.type === 'pty:exit') publishSnapshot();
  };

  // The persistent owner is spawned once with the default template; a preset
  // switch updates which template/runtime the NEXT co-resident dev server boots
  // (ADR-0148 — the page sends `pty:dev-config` before re-running the dev line).
  let devSpec = spec;
  let devCfg = cfg;
  let devSlug = slug;
  let devFromScratch = fromScratch;
  let lastDevTemplateId: string | null = null;

  // Co-resident dev server (ADR-0148): the vite/node tail runs in THIS realm,
  // on demand, reading the realm's installed tree → it sees terminal-installed deps.
  const devServer = createDevServerController({
    send,
    // v1: boot runs to completion; a Ctrl-C mid-boot takes effect right after
    // (the controller stops the server once `signal` aborts) — not mid-install.
    boot: (_signal, devLog) => {
      if (lastDevTemplateId !== null && lastDevTemplateId !== devSpec.id) {
        // Template switched: a fresh worker per preset used to keep node_modules
        // clean; the ONE persistent owner accumulates the prior preset's deps,
        // which trips the new template's lockfile coverage (EBROKENLOCK). Clear
        // node_modules + the lockfile + package.json so the new template seeds its
        // own package.json (seedProject/bootDevServer seed it back if-absent) and
        // installs cleanly. A same-template reload skips this — preserving the
        // user's package.json + installed tree.
        const fs = syncMirror();
        try {
          fs.rmSync(`${devCfg.root}/node_modules`, { recursive: true, force: true });
          fs.rmSync(`${devCfg.root}/package-lock.json`, { force: true });
          fs.rmSync(`${devCfg.root}/package.json`, { force: true });
        } catch {
          /* best-effort clean */
        }
      }
      lastDevTemplateId = devSpec.id;
      return bootDevServer({
        cfg: devCfg,
        // The dev server listens on the template port (cfg.port), distinct from
        // `port` (the owner's snapshot/nm/vfs-write bridge key).
        port: devCfg.port,
        root: devCfg.root,
        spec: devSpec,
        slug: devSlug,
        fromScratch: devFromScratch,
        ownerToken,
        publishSnapshot,
        log: devLog,
      });
    },
  });

  // Editor writes land via the vfs-write bridge; forward them to the running dev
  // server's HMR (the virtual FS fires no real watcher events) + republish.
  const onVfsWrite = (path: string): void => {
    publishSnapshot();
    devServer.notifyFileChanged(path);
  };
  const tearVfsBridge = serveVfsWrites(port, { onWrite: onVfsWrite });

  const vfs = new SyncMirrorVfs();
  const registry = new RegistryClient({ fetch: proxiedRegistryFetch() });
  // ADR-0150: each foreground CLI runs in a supervised child worker-process
  // (RIFTY_REMOTE_FS=1) reading the owner store over fs.* sync-RPC — the owner
  // stays a free async supervisor (blocking work left it). The in-realm
  // createOwnerBinExecutor stays as a documented fallback (owner-bin-executor.ts).
  const ownerBinExecutor = createOwnerChildBinExecutor(opts.nodeEntryWorkerUrl);

  // Both `vite` (vite templates' dev line) and `npm run <script>` (node templates,
  // via package.json) boot the co-resident dev server and BLOCK the run until
  // Ctrl-C (`ctx.signal` → exit 130). Single active server per owner.
  const runDevServer = async (ctx: CommandContext): Promise<number> => {
    const signal = ctx.signal ?? new AbortController().signal;
    try {
      await devServer.run(signal, (chunk) => ctx.stdout.write(chunk));
      return 130; // resolves only when `signal` aborts (Ctrl-C)
    } catch (err) {
      if (signal.aborted) return 130;
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  };

  const npmCommand = createNpmShellCommand({
    vfs,
    registry,
    flush: flushSyncMirror,
    // Stamp the install for the CURRENT project slug (same key the dev-server
    // dependency arrival uses) so a reload's `installStampSatisfied(slug)` reuses
    // this tree — otherwise the arrival re-runs and replaces node_modules,
    // dropping the user's `npm install` (ADR-0135).
    projectSlug: () => devSlug,
    // Only the spec's lifecycle-owning dev-line NAME (dev/vite/start) boots the
    // co-resident dev server. Arbitrary `npm run <script>` (e.g. `build`/`lint`)
    // is not yet routed through a real node_modules/.bin exec; loud-reject it
    // rather than silently boot dev. Matched by NAME, not command: a preset
    // switch updates `devSpec` before the tree's package.json is re-seeded, so the
    // on-disk `dev` command can be stale (vite on a node preset) while the dev line
    // must still boot the owner's CURRENT runtime. TODO(backlog: shell/node-modules-bin-execution)
    runScript: (name, command, ctx) => {
      if (isDevScriptName(devSpec, name)) return runDevServer(ctx);
      ctx.stderr.write(
        `npm: \`npm run ${name}\` (\`${command}\`) is not supported yet; only the dev line boots the co-resident server\n`,
      );
      return Promise.resolve(1);
    },
  });

  const makeShell = (seed?: { cwd?: string; env?: Record<string, string> }): Shell => {
    // Seed restores persisted terminal cwd/env on reload (ADR-0146); falls back
    // to the workspace root + empty env for a fresh session. The cwd is validated
    // HERE against the owner's tree (single-store-owner: the page holds no
    // authoritative store to check), resetting to root if the persisted dir was
    // deleted since.
    const shell = new Shell({
      cwd: reachableCwd(syncMirror(), seed?.cwd, cfg.root),
      env: seed?.env ?? {},
      execBin: ownerBinExecutor,
    });
    shell.registerCommand('npm', async (args, ctx) => {
      const code = await npmCommand(args, ctx);
      publishSnapshot(); // node_modules may have changed — refresh the page's view
      return code;
    });
    shell.registerCommand('vite', (_args, ctx) => runDevServer(ctx));
    return shell;
  };

  const server = createPtyServer({
    send,
    makeShell,
    onDevServerReq: () => devServer.publish(),
    // Re-resolve the dev-server config for the current preset (ADR-0148) so a
    // node-server preset boots its OWN runtime/port, not the spawn-time default.
    onDevConfig: (config) => {
      devSpec = resolveProjectSpec(config.templateId);
      devCfg = resolveBootstrapConfig(devSpec, devSpec.defaultPort, cfg.root);
      devSlug = config.slug;
      devFromScratch = config.setup === 'from-scratch';
    },
  });

  kernelIpc.onMessage?.((message) => {
    if (isPtyIpcMessage(message)) {
      // Only page→owner frames are inbound here; ignore a stray owner→page echo.
      if (isPageToOwner(message.frame)) void server.handleFrame(message.frame);
      return;
    }
    if (isVfsWriteIpcMessage(message)) {
      applyVfsWriteFrame(message.frame, { onWrite: onVfsWrite });
    }
  });

  // Workspace read bridge (ADR-0080 + ADR-0148): the page reads the installed +
  // project tree against this realm's syncMirror. Kept live by the serve:true realm.
  const tearNodeModulesBridge = serveNodeModulesReads(port, cfg.root);
  // Workspace archive export/import (single-store-owner: one authoritative store
  // owner, the page holds no authoritative fs): the owner serializes /
  // applies its own tree so the PAGE keeps no authoritative store of its own.
  const tearArchiveBridge = serveWorkspaceArchive(port, cfg.root);
  log('[shell-owner/worker] pty server ready; workspace read + archive bridges live\n');

  // Referenced so the served bridges + server aren't GC'd while the realm serves.
  void tearVfsBridge;
  void tearSnapReq;
  void tearNodeModulesBridge;
  void tearArchiveBridge;
  void server;
}

async function bootstrap(): Promise<void> {
  // Defaults match the page-realm path so non-overriding callers behave the same.
  // Read the spawn env from the kernel's PUBLISHED process spec — NOT
  // `globalThis.process.env`. In the PROD bundle a stray top-level
  // `installProcessGlobals()` side-effect (runtime-js/worker-entry, pulled into the
  // owner chunk + evaluated at module-eval) swaps `globalThis.process` for a fresh
  // EMPTY-env one BEFORE this runs, so process.env reads undefined and the worker
  // URLs (no default) make the owner throw — green dev e2e, dead deploy. The kernel
  // spec lives on a dedicated non-enumerable global the swap can't touch (the
  // canonical source `installNodeProcessShim` itself reads). A copy is mutable +
  // re-asserted onto the live process after `initBackend` for downstream readers.
  // TODO(backlog: runtime-js/worker-entry-process-globals-side-effect)
  const env = { ...(readKernelProcessSpec()?.env ?? globalThis.process.env) };
  const port = Number.parseInt(env.RIFTY_RFV_PORT ?? '5174', 10);
  const root = env.RIFTY_RFV_ROOT ?? '/workspace';
  // ADR-0148: ONE owner — the unified shell + co-resident dev server. The
  // legacy per-run 'preview' worker is gone (no spawner sets RIFTY_OWNER_MODE
  // anymore). `ownerToken` keys the preview SW route (page wires its side on the
  // pty:dev-server frame).
  const ownerToken = env.RIFTY_PREVIEW_OWNER_TOKEN;
  const spec = resolveProjectSpec(env.RIFTY_RFV_TEMPLATE ?? DEFAULT_TEMPLATE_ID);
  // Sandbox setup kind (ADR-0135): from-scratch runs the visible, honest install
  // HERE (the OPFS-owning realm), streamed to the terminal; instant stays quiet.
  const fromScratch = env.RIFTY_RFV_SETUP === 'from-scratch';
  // Project slug (preset id) — the install-stamp reuse key, so a from-scratch
  // preset isn't silenced by a stamp an instant preset on the same template left.
  const slug = env.RIFTY_RFV_SLUG ?? spec.id;
  // Honour an explicit entry override on the spawn spec (usually a no-op —
  // the orchestrator defaults it to the template's own entry).
  const effectiveSpec = withEntryOverride(spec, env.RIFTY_RFV_ENTRY ?? spec.entry.relativePath);
  // ADR-0148: `port` (RIFTY_RFV_PORT) keys the owner's snapshot/nm/vfs-write
  // bridges (a dedicated synthetic port, e.g. 59124). The co-resident dev server
  // listens on the template's own port (`cfg.port`) — a DISTINCT key so vite +
  // its preview bridges never collide with the owner serve bridges.
  const cfg = resolveBootstrapConfig(effectiveSpec, effectiveSpec.defaultPort, root);

  const kernelIpc = installRuntimeGlobals();
  // Both runtimes resolve relative paths (express.static('public'), tool cwd
  // probes) against the project root, whatever RIFTY_RFV_ROOT says.
  setProcessCwd(cfg.root);

  // Owner OPFS persistence (ADR-0013/0072): wire the OPFS-or-memory sync mirror
  // BEFORE seeding so the owner's tree survives reload. The owner is the workspace
  // source-of-truth and was the only worker realm not doing this; sibling realms already
  // do (runtime-js/worker-entry.ts, rifty/sandbox.ts). This realm is a Worker →
  // OpfsFsSync is supported, and a non-isolated host never spawns the owner.
  // Degrade to memory on a surprise OPFS failure rather than bricking boot (mirrors
  // boot.ts). seedProject is idempotent (`if !exists`) → the persisted tree stands.
  try {
    const backend = await initBackend();
    log(`[shell-owner/worker] VFS backend: ${backend}\n`);
  } catch (err) {
    log(
      `[shell-owner/worker] OPFS init failed, using in-memory (no persistence): ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
  // Re-assert the spawn env onto the live process: the `await` above is the window
  // where the stray installProcessGlobals() side-effect can have swapped in a
  // fresh empty-env process (see the snapshot note). Downstream `process.env`
  // readers (node-server `process.env.PORT`, programs) must still see it.
  globalThis.process.env = env;

  // Reverse mirror (ADR-0076): publish the project tree (sans node_modules) to
  // the page so its file explorer reflects this worker's real project.
  const publishSnapshot = (): void => {
    publishVfsSnapshot(port, collectSnapshot(syncMirror(), root));
  };

  // ADR-0150: the owner spawns each foreground CLI as a supervised child
  // worker-process; give this realm the kernel + node-entry worker URLs (recursive
  // spawn) and serve the child's fs over the kernel dispatcher (owner = SSoT).
  const kernelWorkerUrl = env.RIFTY_KERNEL_WORKER_URL;
  const nodeEntryWorkerUrl = env.RIFTY_NODE_ENTRY_WORKER_URL;
  if (!kernelWorkerUrl || !nodeEntryWorkerUrl) {
    throw new Error(
      'workspace-owner: missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL — cannot spawn child CLIs',
    );
  }
  setKernelWorkerUrl(kernelWorkerUrl);
  setNodeEntryWorkerUrl(nodeEntryWorkerUrl);
  installRuntimeJsFsHandlers(getKernelDispatcher(), syncMirror);

  // ADR-0148: ONE unified owner — shell sessions + the co-resident dev server
  // (started on demand by `vite` / `npm run <script>`), all against this realm's
  // installed tree. The legacy per-run preview tail is gone (folded into
  // `bootDevServer`, invoked from the owner's dev command).
  await bootShellOwner({
    cfg,
    port,
    kernelIpc,
    publishSnapshot,
    spec,
    slug,
    fromScratch,
    ownerToken,
    nodeEntryWorkerUrl,
  });
}

await bootstrap();
