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
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import { setNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { type CommandContext, Shell } from '@riftydev/shell';
import { dirname, initBackend, normalizePath, syncMirror } from '@riftydev/vfs';
import { serveNodeModulesReads } from '../glue/node-modules-port.ts';
import { createNpmShellCommand } from '../glue/npm-shell-command.ts';
import {
  type OwnerToPageFrame,
  PTY_IPC_TYPE,
  isPageToOwner,
  isPtyIpcMessage,
} from '../glue/pty-protocol.ts';
import { reachableCwd } from '../glue/reachable-cwd.ts';
import { createProxiedRegistryClient } from '../glue/registry-fetch.ts';
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
  type ProjectSpec,
  isDevScriptName,
  resolveBootstrapConfig,
} from '../templates/project-spec.ts';
import { DEFAULT_TEMPLATE_ID, resolveProjectSpec } from '../templates/registry.ts';
import { flushSyncMirror } from './dev-server-boot.ts';
import { createDevServerController } from './dev-server-controller.ts';
import { resolveNodeEntry } from './node-entry-resolve.ts';
import { createOwnerChildBinExecutor } from './owner-child-bin-executor.ts';
import { createOwnerChildDevServer } from './owner-child-dev-server.ts';
import { createOwnerChildNodeExecutor } from './owner-child-node-executor.ts';
import { type PreviewRegistry, createPreviewRegistry } from './preview-registry.ts';
import { createPtyServer } from './pty-server.ts';
import { type KernelIpc, installRuntimeGlobals } from './worker-runtime-globals.ts';

const enc = new TextEncoder();

registerNetBuiltins();
registerSqliteBuiltin();

function log(line: string): void {
  // Kernel pre-entry hook wired process.stdout.write -> stdout MessagePort;
  // page-side WorkerProcessHandle.stdout() emits each chunk, realVite.ts -> onLog.
  globalThis.process.stdout.write(line);
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

/** Apply the optional `RIFTY_RFV_ENTRY` override. */
function withEntryOverride(spec: ProjectSpec, entryRel: string): ProjectSpec {
  if (entryRel === spec.entry.relativePath) return spec;
  return { ...spec, entry: { ...spec.entry, relativePath: entryRel } };
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
  /** kernel worker URL — threaded to the dev-server child so Rolldown's WASI worker pool can spawn worker_threads children (Vite 8). */
  readonly kernelWorkerUrl: string;
  /** node-entry bootstrap worker URL — the supervised child each CLI runs in (ADR-0150). */
  readonly nodeEntryWorkerUrl: string;
  /** dev-server child bootstrap worker URL — the supervised serve:true child the owner spawns (ADR-0150 P6b). */
  readonly devServerWorkerUrl: string;
}): Promise<void> {
  const { cfg, port, kernelIpc, publishSnapshot, spec, slug, fromScratch } = opts;

  seedProject(cfg);
  publishSnapshot();
  // Readiness handshake (ADR-0146, explorer reflects the owner tree): the page
  // replies-via-request rather than a blind retry-storm. Startup publish covers a
  // subscribed page; this covers a page that subscribes/reloads after us.
  const tearSnapReq = serveSnapshotRequests(port, publishSnapshot);

  // Owner→page frames (pty + dev-server status). republish on `pty:exit` since a
  // finished command may have mutated the tree (ADR-0146: owner republishes its
  // snapshot on command exit so the explorer reflects the owner tree). Mirror the
  // dev-server preview slot by observing the dev-server status frames flowing
  // through here (ADR-0155 — the registry's dev slot tracks the SAME `pty:dev-server`
  // running/stopped frames the page pill already consumes; this ADDS the mirror, it
  // does not replace the status path).
  //
  // A hoisted function declaration (not a const arrow) so it can reference the
  // `const previews` below without a use-before-init: `send` is visible at the
  // `createPreviewRegistry({ send })` call site (hoisting), and `previews` is
  // initialized before `send` ever runs — both stay `const`-clean (no `let`).
  function send(frame: OwnerToPageFrame): void {
    kernelIpc.send?.({ type: PTY_IPC_TYPE, frame });
    if (frame.type === 'pty:exit') publishSnapshot();
    if (frame.type === 'pty:dev-server') {
      if (frame.status === 'running' && frame.port !== undefined) previews.setDevServer(frame.port);
      else if (frame.status === 'stopped') previews.clearDevServer();
    }
  }

  // Multi-port preview registry (ADR-0155): one set of previewable ports — the
  // co-resident dev server's slot (mirrored in `send` above) + each running
  // `node <file>` server.
  const previews: PreviewRegistry = createPreviewRegistry({ send });

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
    boot: (signal, devLog) => {
      if (lastDevTemplateId !== null && lastDevTemplateId !== devSpec.id) {
        // Template switched: a fresh worker per preset used to keep node_modules
        // clean; the ONE persistent owner accumulates the prior preset's deps,
        // which trips the new template's lockfile coverage (EBROKENLOCK). Clear
        // node_modules + the lockfile + package.json so the new template seeds its
        // own package.json (the child seeds it back if-absent) and installs
        // cleanly. A same-template reload skips this — preserving the user's
        // package.json + installed tree. Owner-realm stateful across runs: the
        // clean runs HERE on the owner store the child reads over fs.* RPC.
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
      // ADR-0150 P6b: spawn the dev server in a supervised serve:true child that
      // reads the owner store over fs.* RPC. The owner stays a free async
      // supervisor. The driver resolves when the child reports listening; stop()
      // kills the child (re-listen-on-restart via a fresh child per run). `signal`
      // is forwarded for the contract; v1 boot runs to completion (a Ctrl-C
      // mid-boot takes effect right after, via the controller's stop()).
      return devServerChild.boot({
        signal,
        log: devLog,
        params: {
          templateId: devSpec.id,
          slug: devSlug,
          setup: devFromScratch ? 'from-scratch' : 'instant',
          // The dev server listens on the template port (devCfg.port), distinct
          // from `port` (the owner's snapshot/nm/vfs-write bridge key).
          root: devCfg.root,
          devPort: devCfg.port,
        },
        onSnapshotDirty: publishSnapshot,
        // Owner realm → real OWNER OPFS drain. The child's install writes land in
        // THIS realm's write-through queue over fs.* RPC; the child's own flush is
        // a no-op (remote SyncRpcFsSync has none). Drain here on dev-ready so the
        // queue is empty for later shell writes (they then persist before a reload
        // terminates the owner). Replaces the pre-P6b in-owner install flush.
        flush: flushSyncMirror,
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
  const registry = createProxiedRegistryClient();
  // ADR-0150: each foreground CLI runs in a supervised child worker-process
  // (RIFTY_REMOTE_FS=1) reading the owner store over fs.* sync-RPC — the owner
  // stays a free async supervisor (blocking work left it). The in-realm
  // createOwnerBinExecutor stays as a documented fallback (owner-bin-executor.ts).
  const ownerBinExecutor = createOwnerChildBinExecutor(opts.nodeEntryWorkerUrl);
  // ADR-0150 P6b: the dev server also runs in a supervised serve:true child that
  // reads the owner store over fs.* RPC. Built once; the boot closure spawns a
  // fresh child per run (re-listen-on-restart), the controller's stop() kills it.
  const devServerChild = createOwnerChildDevServer(opts.devServerWorkerUrl, {
    // Thread the recursive worker URLs so the dev-server child can spawn
    // Rolldown's WASI worker_threads pool (Vite 8).
    kernelWorkerUrl: opts.kernelWorkerUrl,
    nodeEntryWorkerUrl: opts.nodeEntryWorkerUrl,
  });
  // ADR-0155: `node <file>` runs in a supervised child like the bin executor, but
  // a server entry (it called `listen()`) posts its ports back so the owner adds a
  // preview slot. A monotonic run-seq keys each run's registry entries (teardown
  // correlation): node-1, node-2, …
  const ownerNodeExecutor = createOwnerChildNodeExecutor(opts.nodeEntryWorkerUrl);
  let nodeRunSeq = 0;

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
    // `node <file> [args]` (ADR-0155): resolve the entry against the owner store,
    // then run it in a supervised child. A long-running server child registers a
    // preview slot via `onListening`; the slot is dropped on exit. A clean Node
    // diagnostic (exit 1) on a missing/absent entry — never a silent stub.
    shell.registerCommand('node', (args, ctx) => {
      const r = resolveNodeEntry(ctx.cwd, args[0]);
      if (!r.ok) {
        ctx.stderr.write(r.message);
        return Promise.resolve(1);
      }
      const sid = `node-${++nodeRunSeq}`;
      return ownerNodeExecutor(r.path, args.slice(1), ctx, {
        sid,
        onListening: (id, ports) => previews.addNode(id, ports),
        onExit: (id) => previews.removeBySid(id),
      });
    });
    return shell;
  };

  const server = createPtyServer({
    send,
    makeShell,
    onDevServerReq: () => devServer.publish(),
    // ADR-0155: answer a page subscribe by re-emitting the full preview-port set.
    onPreviewReq: () => previews.publish(),
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
  // `globalThis.process.env`. Historically a stray top-level `installProcessGlobals()`
  // (runtime-js/worker-entry, pulled into the owner chunk + evaluated at module-eval)
  // could swap `globalThis.process` for a fresh EMPTY-env one, blanking process.env.
  // ADR-0157 made `installProcessGlobals` idempotent (it no-ops when globalThis.process
  // is already a NodeProcess — which the pre-entry seam installed BEFORE this entry is
  // imported), so the clobber can no longer happen. These reads + the re-assert after
  // `initBackend` are RETAINED as belt-and-suspenders only because the chunk-graph leak
  // ROOT is still open; the kernel spec is the canonical source on a non-enumerable
  // global the swap could never touch.
  // TODO(backlog: runtime-js/worker-entry-process-globals-side-effect)
  const env = { ...(readKernelProcessSpec()?.env ?? globalThis.process.env) };
  const port = Number.parseInt(env.RIFTY_RFV_PORT ?? '5174', 10);
  const root = env.RIFTY_RFV_ROOT ?? '/workspace';
  // ADR-0148/0150: ONE owner — the unified shell + the dev server it spawns as a
  // supervised child. The legacy per-run 'preview' worker is gone (no spawner sets
  // RIFTY_OWNER_MODE anymore). The preview SW route is keyed page-side
  // (mountPlaygroundPreviewBridge); the owner no longer threads a preview token.
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
  const devServerWorkerUrl = env.RIFTY_DEV_SERVER_WORKER_URL;
  if (!kernelWorkerUrl || !nodeEntryWorkerUrl || !devServerWorkerUrl) {
    throw new Error(
      'workspace-owner: missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL / RIFTY_DEV_SERVER_WORKER_URL — cannot spawn child CLIs or the dev server',
    );
  }
  setKernelWorkerUrl(kernelWorkerUrl);
  setNodeEntryWorkerUrl(nodeEntryWorkerUrl);
  installRuntimeJsFsHandlers(getKernelDispatcher(), syncMirror);

  // ADR-0148/0150: ONE unified owner — shell sessions + the dev server it spawns
  // on demand (`vite` / `npm run <script>`) as a supervised serve:true child that
  // reads this realm's installed tree over fs.* RPC. The legacy per-run preview
  // tail is gone; the owner stays a free async supervisor.
  await bootShellOwner({
    cfg,
    port,
    kernelIpc,
    publishSnapshot,
    spec,
    slug,
    fromScratch,
    kernelWorkerUrl,
    nodeEntryWorkerUrl,
    devServerWorkerUrl,
  });
}

await bootstrap();
