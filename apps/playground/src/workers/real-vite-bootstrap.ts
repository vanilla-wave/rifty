/// <reference lib="webworker" />

/**
 * Real Vite bootstrap (ADR-0043 — Vite-in-Worker, M11 / A-026).
 *
 * Loaded by the kernel-worker bootstrap via `import(spec.entry.url)` once the
 * `WorkerInitMessage` lands. By the time this evaluates, `globalThis.process`
 * is the Node-shape shim from the kernel's pre-entry hook and `process.env`
 * carries the env the page-realm adapter put on the `WorkerSpawnSpec`.
 *
 * Any throw propagates to the kernel's `worker-entry` → exit code 1 +
 * stack-on-stderr; page-side `realVite.ts` forwards stderr into the terminal.
 *
 * Split from `realVite.ts` because this runs in a *worker realm*: the page-realm
 * adapter only orchestrates the spawn and must not import the heavy install/Vite
 * paths (A-026's whole point is the page realm stops paying for them).
 */

import { dispatchToPort, serveCrossRealmPreview } from '@riftydev/net';
import '@riftydev/net/register-builtins';
import { RegistryClient, install } from '@riftydev/npm-client';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { installProcessGlobals } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import {
  type SerializedRequest,
  type SerializedResponse,
  setupPreviewBridge,
} from '@riftydev/service-worker';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import { esbuildShimFiles, rollupShimFiles } from '../glue/esbuild-shim.ts';
import {
  type HmrBridgeHandle,
  createHmrBridgeVitePlugin,
  setupHmrBridge,
} from '../glue/hmr-bridge.ts';
import { serveNodeModulesReads } from '../glue/node-modules-port.ts';
import { proxiedRegistryFetch } from '../glue/registry-fetch.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { collectSnapshot, publishVfsSnapshot } from '../glue/vfs-snapshot-port.ts';
import { type VfsWriteFrame, applyVfsWriteFrame, serveVfsWrites } from '../glue/vfs-write-port.ts';
import { type BootstrapConfig, resolveBootstrapConfig } from '../templates/project-spec.ts';
import { DEFAULT_TEMPLATE_ID, resolveProjectSpec } from '../templates/registry.ts';

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
}

interface KernelIpc {
  onMessage?(handler: (message: unknown) => void): void;
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
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  const proc = globalThis.process as unknown as ProcStdio;
  if (kStdout && typeof kStdout.write === 'function') proc.stdout = kStdout;
  if (kStderr && typeof kStderr.write === 'function') proc.stderr = kStderr;
  if (kEnv) proc.env = kEnv;
  return { onMessage: kOnMessage };
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

async function bootstrap(): Promise<void> {
  // Defaults match the page-realm path so non-overriding callers behave the same.
  const env = globalThis.process.env;
  const port = Number.parseInt(env.RIFTY_RFV_PORT ?? '5174', 10);
  const root = env.RIFTY_RFV_ROOT ?? '/workspace';
  const spec = resolveProjectSpec(env.RIFTY_RFV_TEMPLATE ?? DEFAULT_TEMPLATE_ID);
  // Honour an explicit entry override on the spawn spec (usually a no-op —
  // the orchestrator defaults it to the template's own entry).
  const entryRel = env.RIFTY_RFV_ENTRY ?? spec.entry.relativePath;
  const effectiveSpec =
    entryRel === spec.entry.relativePath
      ? spec
      : { ...spec, entry: { ...spec.entry, relativePath: entryRel } };
  const cfg = resolveBootstrapConfig(effectiveSpec, port, root);

  const kernelIpc = installRuntimeGlobals();

  // Reverse mirror (ADR-0076): publish the project tree (sans node_modules) to
  // the page so its file explorer reflects this worker's real Vite project.
  const publishSnapshot = (): void => {
    publishVfsSnapshot(port, collectSnapshot(syncMirror(), root));
  };

  const hmrBridgeRef: { current?: HmrBridgeHandle } = {};
  function broadcastFileUpdate(path: string): void {
    hmrBridgeRef.current?.broadcast(JSON.stringify({ type: 'update', path }));
  }

  function handleVfsWrite(path: string): void {
    publishSnapshot();
    broadcastFileUpdate(path);
  }

  kernelIpc.onMessage?.((message) => {
    if (!isVfsWriteIpcMessage(message)) return;
    applyVfsWriteFrame(message.frame, { onWrite: handleVfsWrite });
  });

  // Opens BEFORE seeding so an edit racing the install lands in the right realm.
  const tearVfsBridge = serveVfsWrites(port, { onWrite: handleVfsWrite });

  seedProject(cfg);
  // Retry a few times: the page may not have subscribed when this first fires
  // (one-way BroadcastChannel, no buffer).
  publishSnapshot();
  for (const delay of [300, 1200, 3000]) setTimeout(publishSnapshot, delay);

  log(`[real-vite/worker] installing ${spec.displayName} into ${root}/node_modules…\n`);
  const registry = new RegistryClient({ fetch: proxiedRegistryFetch() });
  const vfs = new SyncMirrorVfs();
  const result = await install(cfg.packageName, cfg.packageVersion, cfg.installDeps, {
    vfs,
    cwd: root,
    registry,
  });
  log(
    `[real-vite/worker] installed ${result.packages.length} packages (${result.conflicts.length} conflicts)\n`,
  );
  publishSnapshot(); // node_modules now present — refresh the page's view

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

  log(`[real-vite/worker] importing ${cfg.runtimeSpecifier}…\n`);
  const viteNs = (await loader.import(
    cfg.runtimeSpecifier,
    `${root}/__entry__.mjs`,
  )) as unknown as {
    createServer: (config: ViteUserConfig) => Promise<ViteDevServer>;
  };

  // HMR bridge in THIS realm; iframe-side BroadcastChannel client reaches it
  // regardless of which realm hosts the server.
  hmrBridgeRef.current = setupHmrBridge({ port });
  log(`[real-vite/worker] hmr bridge ready at ${hmrBridgeRef.current.url}\n`);

  log(`[real-vite/worker] starting dev server on port ${port}…\n`);
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
    plugins: cfg.hmrEnabled ? [createHmrBridgeVitePlugin({ port })] : [],
  });
  await server.listen();
  log(`[real-vite/worker] vite is listening on internal port ${port}\n`);
  publishSnapshot(); // vite may have written config/cache during boot

  server.watcher?.on('change', (file) => {
    broadcastFileUpdate(file);
    publishSnapshot(); // keep the page's explorer in sync with edits
  });

  // Direct SW→Worker preview route (A-023): the Worker owns this Vite port, so
  // advertise it to the SW. The page-side bridge below stays as fallback for
  // legacy window-owned paths and for browsers without Worker SW messaging.
  const tearDirectSwBridge = setupPreviewBridge(dispatchSerializedPreview, { ports: [port] });
  log('[real-vite/worker] direct service-worker preview bridge ready\n');

  // Page-realm `bridgeCrossRealmPreview` posts each SW preview request over
  // BroadcastChannel and awaits our reply; we dispatch through the WORKER-LOCAL
  // `@riftydev/net` registry (Vite registered `port` when its dev server listened).
  const tearPreviewBridge = serveCrossRealmPreview(port, async (request) =>
    dispatchToPort(port, request),
  );
  log('[real-vite/worker] cross-realm preview port bridge ready\n');

  // Lazy node_modules read bridge (ADR-0080): answers the page explorer's reads
  // against this realm's syncMirror (holds the installed tree — snapshot exclusion
  // never touched the mirror). Relies on the keep-alive below to answer reads.
  const tearNodeModulesBridge = serveNodeModulesReads(port);
  log('[real-vite/worker] node_modules read bridge ready\n');

  // Keep the worker realm alive (ADR-0077). The kernel's `worker-entry`
  // terminates the realm (`closePorts()` + `self.close()`) the instant the
  // entry's top-level `await` resolves — correct for a run-to-completion program
  // or CLI, but THIS is a long-running dev server: returning would kill Vite
  // the moment it started listening, so every preview request hits a dead worker
  // (502 bridge-timeout) and the iframe never renders. Suspend forever; the realm
  // stays live until the page-side handle `.kill()`s it (`worker.terminate()`),
  // which doesn't depend on this promise.
  void tearVfsBridge;
  void tearDirectSwBridge;
  void tearPreviewBridge;
  void tearNodeModulesBridge;
  void server;
  await new Promise<never>(() => {});
}

await bootstrap();
