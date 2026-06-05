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
import { serveNodeModulesReads } from '../glue/node-modules-port.ts';
import { proxiedRegistryFetch } from '../glue/registry-fetch.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { collectSnapshot, publishVfsSnapshot } from '../glue/vfs-snapshot-port.ts';
import { serveVfsWrites } from '../glue/vfs-write-port.ts';
import { type BootstrapConfig, resolveBootstrapConfig } from '../templates/project-spec.ts';
import { DEFAULT_TEMPLATE_ID, resolveProjectSpec } from '../templates/registry.ts';

const enc = new TextEncoder();

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

interface ProcStdio {
  stdout?: { write?: unknown };
  stderr?: { write?: unknown };
  env?: Record<string, string | undefined>;
}

function installRuntimeGlobals(): void {
  // The kernel's pre-entry hook already installed a `process` whose stdout/
  // stderr post to the page over the stdio MessagePorts (that wiring is why the
  // playground terminal sees worker output at all). `installProcessGlobals`
  // swaps in runtime-js's richer process shim (nextTick patch, full Node
  // surface Vite reaches for) but its stdout/stderr default to `console.*` —
  // the worker console, NOT the page terminal — and its env is empty. Clobbering
  // the wiring made every worker log (install/boot progress AND error stacks)
  // vanish, so a stalled boot looked frozen. Preserve the kernel stdio + env
  // across the swap.
  const prev = globalThis.process as unknown as ProcStdio | undefined;
  const kStdout = prev?.stdout;
  const kStderr = prev?.stderr;
  const kEnv = prev?.env;
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  const proc = globalThis.process as unknown as ProcStdio;
  if (kStdout && typeof kStdout.write === 'function') proc.stdout = kStdout;
  if (kStderr && typeof kStderr.write === 'function') proc.stderr = kStderr;
  if (kEnv) proc.env = kEnv;
}

function seedProject(cfg: BootstrapConfig): void {
  const fs = syncMirror();
  fs.mkdirSync(cfg.root, { recursive: true });
  // Seed each template file idempotently — the editor source overwrites the
  // entry afterwards; an existing file (a returning session) is left alone.
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

async function bootstrap(): Promise<void> {
  // Pull config from env (the page-realm adapter set these on the
  // WorkerSpawnSpec). Defaults match the page-realm path so callers
  // who don't override get the same behaviour.
  const env = globalThis.process.env;
  const port = Number.parseInt(env.RIFTY_RFV_PORT ?? '5174', 10);
  const root = env.RIFTY_RFV_ROOT ?? '/workspace';
  const spec = resolveProjectSpec(env.RIFTY_RFV_TEMPLATE ?? DEFAULT_TEMPLATE_ID);
  // Honour an explicit entry override on the spawn spec (the orchestrator
  // defaults it to the template's own entry, so this is usually a no-op).
  const entryRel = env.RIFTY_RFV_ENTRY ?? spec.entry.relativePath;
  const effectiveSpec =
    entryRel === spec.entry.relativePath
      ? spec
      : { ...spec, entry: { ...spec.entry, relativePath: entryRel } };
  const cfg = resolveBootstrapConfig(effectiveSpec, port, root);

  installRuntimeGlobals();

  // VFS write port opens BEFORE seeding so an edit racing the install
  // (rare but possible) lands in the right realm. The watcher Vite
  // installs later sees the actual file change either way.
  const tearVfsBridge = serveVfsWrites(port);

  // Reverse mirror (ADR-0076): publish the project tree (sans node_modules)
  // to the page so its file explorer reflects this worker's real Vite project.
  const publishSnapshot = (): void => {
    publishVfsSnapshot(port, collectSnapshot(syncMirror(), root));
  };

  seedProject(cfg);
  // Publish the skeleton now, then retry a few times — the page may not have
  // subscribed yet when this first fires (one-way BroadcastChannel, no buffer).
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

  // HMR bridge in THIS realm. Iframe-side BroadcastChannel client
  // unchanged — it reaches the server regardless of which realm hosts it.
  const hmrBridge: HmrBridgeHandle = setupHmrBridge({ port });
  log(`[real-vite/worker] hmr bridge ready at ${hmrBridge.url}\n`);

  log(`[real-vite/worker] starting dev server on port ${port}…\n`);
  const server = await viteNs.createServer({
    root,
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
    hmrBridge.broadcast(JSON.stringify({ type: 'update', path: file }));
    publishSnapshot(); // keep the page's explorer in sync with edits
  });

  // Cross-realm preview port. The page-realm `bridgeCrossRealmPreview`
  // posts every incoming SW preview request over BroadcastChannel and
  // awaits our reply. We dispatch through the WORKER-LOCAL `@riftydev/net`
  // registry (Vite registered `port` when its dev server `listen`'d).
  const tearPreviewBridge = serveCrossRealmPreview(port, async (request) =>
    dispatchToPort(port, request),
  );
  log('[real-vite/worker] cross-realm preview port bridge ready\n');

  // Lazy node_modules read bridge (ADR-0080). Answers the page explorer's
  // request/response reads against this realm's syncMirror (which holds the
  // installed tree — the snapshot exclusion never touched the mirror). Relies on
  // the keep-alive below to stay alive long enough to answer reads.
  const tearNodeModulesBridge = serveNodeModulesReads(port);
  log('[real-vite/worker] node_modules read bridge ready\n');

  // Keep the worker realm alive (ADR-0077). The kernel's `worker-entry`
  // (`installWorkerEntry`) terminates the realm — `closePorts()` + `self.close()`
  // — the instant the entry module's top-level `await` resolves. That is correct
  // for a run-to-completion program (REPL/CLI), but THIS entry is a long-running
  // **dev server**: returning here would kill Vite the moment it started
  // listening, so every cross-realm preview request lands on a dead worker
  // (502 bridge-timeout) and the iframe never renders. Suspend forever instead;
  // the realm stays live (event loop, Vite server, HMR + preview bridges all
  // keep running) until the page-side handle `.kill()`s it (`worker.terminate()`
  // from the parent), which doesn't depend on this promise.
  void tearVfsBridge;
  void tearPreviewBridge;
  void tearNodeModulesBridge;
  void server;
  await new Promise<never>(() => {});
}

await bootstrap();
