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
import { dispatchToPort, serveCrossRealmPreview } from '@riftydev/net';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { type PersistFailureReport, dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import type { BootstrapConfig, ProjectSpec } from '../templates/project-spec.ts';
import type { DevServerHandle } from './dev-server-controller.ts';
import { installEsbuildTransformBridge } from './esbuild-wasi-transform.ts';
import { createNodeServerRunner } from './node-server-runner.ts';
import { type ViteModuleGraph, invalidateViteModule } from './real-vite-invalidation.ts';
import { assertNoUserViteConfig } from './vite-config-guard.ts';

const enc = new TextEncoder();

interface ViteUserConfig {
  root?: string;
  base?: string;
  server?: {
    port?: number;
    strictPort?: boolean;
    middlewareMode?: boolean;
    /** `undefined` = vite's stock HMR (ADR-0189); `false` = pinned off (ADR-0161, Vite 8). */
    hmr?: false | undefined;
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

/**
 * Drain this realm's OPFS write-through (no-op on the memory backend).
 * Returns the drain's persist-failure report (ADR-0187 Corrected) so a
 * durability-gated caller (the npm install stamp) can see swallowed
 * quota/perm failures; `undefined` on the memory backend (no durability tier
 * to break). Ordering-only callers ignore the result.
 */
export async function flushSyncMirror(): Promise<PersistFailureReport | undefined> {
  const mirror = syncMirror() as { flush?: () => Promise<PersistFailureReport | undefined> };
  if (typeof mirror.flush === 'function') return await mirror.flush();
  return undefined;
}

// No shim glue here (ADR-0188): the esbuild/rollup/lightningcss internals shims
// are written by the npm-client installer into the actual installed dirs.

/**
 * Boot inside the supervised dev-server child: prepare the shared tree, start
 * Vite or the configured node-server command, and register preview/HMR bridges.
 * Direct node-server commands run in this realm; nodemon supervises its app in
 * a nested Worker. The returned handle stops the active server process and its
 * bridges, so Ctrl-C can terminate the whole dev session. `log` streams output.
 */
export async function bootDevServer(opts: {
  readonly cfg: BootstrapConfig;
  readonly port: number;
  readonly root: string;
  readonly spec: ProjectSpec;
  readonly slug: string;
  readonly fromScratch: boolean;
  readonly previewScope?: string;
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
  // TODO(backlog: playground/dev-server-synthetic-watcher-dead-set): remove or differentiate this branch; both paths publish.
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

  if (cfg.runtime === 'node-cli') {
    throw new Error('[real-vite/worker] node-cli templates run through the owner node executor');
  }

  let appChildOwnsPreviewBridge = false;
  if (cfg.runtime === 'node-server') {
    if (opts.spec.runtime !== 'node-server') {
      throw new Error(`[real-vite/worker] config/spec runtime mismatch for ${opts.spec.id}`);
    }
    const run = await createNodeServerRunner({
      importEntry: (entryPath, fromPath) => loader.import(entryPath, fromPath),
    })({ cfg, spec: opts.spec, log });
    appChildOwnsPreviewBridge = run.appChildOwnsPreviewBridge;
    publishSnapshot();
  }

  if (cfg.runtime === 'vite') {
    assertNoUserViteConfig(root);
    installEsbuildTransformBridge(root);
    log(`importing ${cfg.runtimeSpecifier}…\n`);
    const viteNs = (await loader.import(
      cfg.runtimeSpecifier,
      `${root}/__entry__.mjs`,
    )) as unknown as {
      createServer: (config: ViteUserConfig) => Promise<ViteDevServer>;
    };
    log(`[real-vite/worker] starting dev server on port ${port}…\n`);
    // TODO(backlog: playground/vite-curated-boot-residual-forces): delete or
    // narrow this direct Vite boot config; shell/.bin Vite no longer carries
    // these retired wrapper forces.
    const server = await viteNs.createServer({
      root,
      base: './',
      server: {
        port,
        strictPort: cfg.server.strictPort,
        middlewareMode: false,
        // Stock vite HMR (ADR-0189): the generic preview-path WS bridge carries
        // vite's own server.ws — no rifty token/plugin/endpoint rewrite.
        // `false` stays only for templates pinned off (Vite 8, ADR-0161).
        hmr: cfg.hmrEnabled ? undefined : false,
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
      plugins: [],
    });
    await server.listen();
    activeServer = server;
    // No rifty-authored `[vite] … ready` marker: readiness is signaled
    // out-of-band (the child posts its port set; the page pill/e2e read
    // data-state), and the terminal carries only tool-authored output.
    log(`[real-vite/worker] vite is listening on internal port ${port}\n`);
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
  const tearPreviewBridge = appChildOwnsPreviewBridge
    ? () => {}
    : serveCrossRealmPreview(
        port,
        async (request) => dispatchToPort(port, request),
        opts.previewScope === undefined ? {} : { scope: opts.previewScope },
      );
  log(
    appChildOwnsPreviewBridge
      ? '[real-vite/worker] preview bridge owned by nodemon app child\n'
      : '[real-vite/worker] preview bridge ready\n',
  );

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
