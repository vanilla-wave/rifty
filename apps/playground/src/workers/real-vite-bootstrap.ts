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
 * - `'vite'` — run the installed `.bin/vite` CLI in a child (UI mirrors ports).
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

import { makeGit, vfsToGitFs } from '@riftydev/git';
import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import {
  type SpawnWorkerSpec,
  type WorkerProcessHandle,
  getKernelDispatcher,
  globalProcessManager,
  readKernelProcessSpec,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { NODE_PROCESS_IDENTITY, installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import { setNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { type BinExecutor, type CommandContext, Shell } from '@riftydev/shell';
import { isTsRequestMessage, isTsResponseMessage } from '@riftydev/ts-language-service/protocol';
import { dirname, initBackend, normalizePath, syncMirror } from '@riftydev/vfs';
import type { BinWorkerHandle } from '../glue/bin-executor.ts';
import { serveGitOwnerRpc } from '../glue/git-owner-port.ts';
import { serveGitStatusFeed } from '../glue/git-status-feed.ts';
import {
  effectiveDepsFromPackageJsonText,
  installStampSatisfiedForPackageJson,
} from '../glue/install-stamp.ts';
import { isNodeChildMessage } from '../glue/node-child-ipc.ts';
import { serveNodeModulesReads } from '../glue/node-modules-port.ts';
import { createNpmShellCommand } from '../glue/npm-shell-command.ts';
import type { OwnerBridgeKey } from '../glue/owner-bridge-key.ts';
import { clearProjectTree, ensureProjectDependencies } from '../glue/project-deps.ts';
import { serveProjectIndex } from '../glue/project-index-port.ts';
import { reconcileOwnerIndexAtBoot, recoverIndex } from '../glue/project-index.ts';
import {
  type OwnerToPageFrame,
  PTY_IPC_TYPE,
  isPageToOwner,
  isPtyIpcMessage,
} from '../glue/pty-protocol.ts';
import { reachableCwd } from '../glue/reachable-cwd.ts';
import { createProxiedRegistryClient } from '../glue/registry-fetch.ts';
import { getResolverUrl } from '../glue/resolver-config.ts';
import { scopeActiveVfsToWorkspace } from '../glue/scoped-vfs.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import {
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
  seedFilesForStarter,
  starterById,
} from '../glue/starter.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { stampTsLspOwner, tsLspOwnerMatches } from '../glue/ts-lsp-owner-scope.ts';
import {
  collectSnapshot,
  publishVfsSnapshot,
  serveSnapshotRequests,
} from '../glue/vfs-snapshot-port.ts';
import {
  type VfsWriteIpcMessage,
  applyVfsWriteFrame,
  serveVfsWrites,
} from '../glue/vfs-write-port.ts';
import { serveWorkspaceArchive } from '../glue/workspace-archive-port.ts';
import { serveWorkspaceFileReads } from '../glue/workspace-file-read-port.ts';
import { DEFAULT_PRESET } from '../presets.ts';
import {
  type BootstrapConfig,
  type ProjectSpec,
  isDevScriptName,
  resolveBootstrapConfig,
} from '../templates/project-spec.ts';
import { DEFAULT_TEMPLATE_ID, resolveProjectSpec } from '../templates/registry.ts';
import { shouldCleanForDevBootWithInstallState } from './dev-boot-clean.ts';
import { flushSyncMirror } from './dev-server-boot.ts';
import { createDevServerController } from './dev-server-controller.ts';
import {
  type NodeInvocation,
  buildNodeEvalSource,
  classifyNodeInvocation,
  resolveNodeEntry,
} from './node-entry-resolve.ts';
import { createOwnerChildBinExecutor } from './owner-child-bin-executor.ts';
import { createOwnerChildDevServer } from './owner-child-dev-server.ts';
import { createOwnerChildNodeExecutor } from './owner-child-node-executor.ts';
import { type PreviewRegistry, createPreviewRegistry } from './preview-registry.ts';
import { createPtyServer } from './pty-server.ts';
import type { ViteCliMode } from './vite-cli-prep.ts';
import {
  type KernelIpc,
  installBundleLocalBuffer,
  installRuntimeGlobals,
} from './worker-runtime-globals.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const VITE_CLI_CONFIG_WRAPPER_RELATIVE_PATH = '.rifty/vite-cli.config.mjs';
const TS_LSP_TYPESCRIPT_READY_TIMEOUT_MS = 60_000;
const TS_LSP_TYPESCRIPT_READY_POLL_MS = 50;
const TS_LSP_TYPESCRIPT_ENTRY_RELATIVE_PATH = 'node_modules/typescript/lib/typescript.js';
const PTY_SESSION_ENV = 'RIFTY_INTERNAL_PTY_SID';

function ptySidFromContext(ctx: CommandContext): string | undefined {
  const sid = ctx.env[PTY_SESSION_ENV];
  return sid && sid.length > 0 ? sid : undefined;
}

registerNetBuiltins();
registerSqliteBuiltin();
// node:sqlite self-initializes at first require.
installSqliteWasmSyncProvider();

function log(line: string): void {
  // Kernel pre-entry hook wired process.stdout.write -> stdout MessagePort;
  // page-side WorkerProcessHandle.stdout() emits each chunk, realVite.ts -> onLog.
  globalThis.process.stdout.write(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Decode an LS-child stdout/stderr chunk for the owner log (tolerant, like realVite). */
function decodeLsChunk(chunk: unknown): string {
  if (chunk instanceof Uint8Array) return dec.decode(chunk);
  if (chunk instanceof ArrayBuffer) return dec.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return dec.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return typeof chunk === 'string' ? chunk : '';
}

function isVfsWriteIpcMessage(message: unknown): message is VfsWriteIpcMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as { readonly type?: unknown; readonly frame?: unknown };
  return candidate.type === 'rifty:vfs-write' && !!candidate.frame;
}

function seedProject(cfg: BootstrapConfig): void {
  const fs = syncMirror();
  fs.mkdirSync(cfg.root, { recursive: true });
  // Idempotent: preset files can overwrite template defaults later; an existing
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
        '# workspace\n\nThis is the in-browser virtual filesystem.\n\n- Edit any seeded project file from the file tree or open tabs.\n- Run `npm install <pkg>` in any terminal; installs land in `node_modules`.\n',
      ),
    );
  }
}

function seedStarterBaseline(starter: string, root: string): void {
  const fs = syncMirror();
  for (const [path, content] of Object.entries(seedFilesForStarter(starterById(starter), root))) {
    const np = normalizePath(path);
    fs.mkdirSync(dirname(np), { recursive: true });
    fs.writeFileSync(np, enc.encode(content));
  }
}

function ownerGitVfs(): SyncMirrorVfs {
  return new SyncMirrorVfs();
}

/**
 * INSTANT preset deps: restore the baked snapshot into the owner store — a
 * RESTORE, never a network install (the dev line stays faithful: `vite` /
 * `npm run dev` runs the program, it does not fetch deps). Idempotent via the slug
 * install-stamp: a reload / an already-restored tree is a no-op (so a user's edits
 * survive). On a STAMPLESS boot (fresh project / preset switch) it cleans any prior
 * preset's dependency-owned files and re-seeds THIS preset's package.json so the
 * snapshot matches, then restores it. User files in the root are never removed by
 * dependency restore. A missing/drifted snapshot leaves deps absent (vite fails
 * loudly — re-bake needed), never a silent boot-time install. from-scratch deps do
 * NOT come here: the explicit `npm install` boot step is their only source.
 */
async function restoreInstantDeps(
  cfg: BootstrapConfig,
  templateId: string,
  slug: string,
): Promise<void> {
  if (!cfg.bakedNodeModulesUrl) return;
  const vfs = new SyncMirrorVfs();
  if (await installStampSatisfiedForPackageJson(vfs, cfg.root, slug, cfg.packageJson)) return;
  const fs = syncMirror();
  fs.rmSync(`${cfg.root}/node_modules`, { recursive: true, force: true });
  fs.rmSync(`${cfg.root}/package-lock.json`, { force: true });
  fs.rmSync(`${cfg.root}/package.json`, { force: true });
  fs.writeFileSync(normalizePath(`${cfg.root}/package.json`), enc.encode(cfg.packageJson));
  const result = await ensureProjectDependencies({
    vfs,
    fsSync: fs,
    root: cfg.root,
    templateId,
    snapshotTemplateId: cfg.bakedNodeModulesTemplateId,
    slug,
    snapshotUrl: cfg.bakedNodeModulesUrl,
    // No `install`: RESTORE-ONLY. Deps never arrive via a boot-time install.
    flush: flushSyncMirror,
    log: (line) => console.log(line.trimEnd()),
  });
  if (result.source === 'none') {
    console.warn(
      `[shell-owner/worker] instant snapshot unavailable/stale for ${templateId} — node_modules absent (re-run \`pnpm snapshots:bake\`)`,
    );
  }
}

/** `npm install` / `npm i` with NO package specs (install-all from package.json) —
 *  the from-scratch boot's cold-install trigger. `npm install <pkg>` (an add) is not. */
function isFullInstall(args: readonly string[]): boolean {
  const sub = args[0];
  if (sub !== 'install' && sub !== 'i') return false;
  return args.slice(1).every((a) => a.startsWith('-'));
}

function seedTemplateNodeModulesFiles(cfg: BootstrapConfig): void {
  const fs = syncMirror();
  const nodeModulesRoot = `${cfg.root}/node_modules/`;
  for (const [path, content] of Object.entries(cfg.seedFiles)) {
    const np = normalizePath(path);
    if (!np.startsWith(nodeModulesRoot)) continue;
    fs.mkdirSync(dirname(np), { recursive: true });
    if (!fs.existsSync(np)) fs.writeFileSync(np, enc.encode(content));
  }
}

function binNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function viteCliMode(args: readonly string[]): ViteCliMode {
  if (args.some((arg) => arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v')) {
    return 'run';
  }
  const sub = args.find((arg) => !arg.startsWith('-'));
  if (sub === 'build') return 'build';
  if (sub === 'preview') return 'preview';
  if (sub === 'optimize') return 'run';
  return 'dev';
}

function createPreviewScope(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`;
}

function previewScopeFromEnv(env: Record<string, string | undefined>): string | undefined {
  return env.RIFTY_PREVIEW_SCOPE || undefined;
}

function withPreviewScope(ctx: CommandContext, previewScope?: string): CommandContext {
  return {
    ...ctx,
    env: {
      ...ctx.env,
      // An already-minted scope (e.g. the vite CLI env prep) is preserved so the
      // child's serveCrossRealmPreview and the page bridge key on the same value.
      RIFTY_PREVIEW_SCOPE: previewScope ?? ctx.env.RIFTY_PREVIEW_SCOPE ?? createPreviewScope(),
    },
  };
}

function viteConfigArg(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--config' || arg === '-c') return args[i + 1] ?? null;
    if (arg.startsWith('--config=')) return arg.slice('--config='.length);
  }
  return null;
}

function withoutViteConfigArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--config' || arg === '-c') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--config=')) continue;
    out.push(arg);
  }
  return out;
}

function resolveCliPath(cwd: string, path: string): string {
  return normalizePath(path.startsWith('/') ? path : `${cwd}/${path}`);
}

function withViteCliArgs(binPath: string, args: readonly string[], ctx: CommandContext): string[] {
  if (binNameOf(binPath) !== 'vite') return [...args];
  const mode = viteCliMode(args);
  if (mode === 'preview') {
    return [...args, '--host', PREVIEW_LOCAL_HOST];
  }
  if (mode !== 'dev') return [...args];
  return [
    ...withoutViteConfigArgs(args),
    '--config',
    normalizePath(`${ctx.cwd}/${VITE_CLI_CONFIG_WRAPPER_RELATIVE_PATH}`),
  ];
}

function withViteCliEnv(
  binPath: string,
  args: readonly string[],
  ctx: CommandContext,
  opts?: {
    /** ADR-0161: the active template pins Vite 8 server.hmr:false. */
    readonly hmrOff: boolean;
  },
): CommandContext {
  if (binNameOf(binPath) !== 'vite') return ctx;
  const mode = viteCliMode(args);
  const userConfigPath = viteConfigArg(args);
  const previewMode = mode === 'dev' || mode === 'preview';
  const userConfigEnv: Record<string, string> = {};
  if (userConfigPath !== null) {
    userConfigEnv.RIFTY_VITE_CLI_USER_CONFIG = resolveCliPath(ctx.cwd, userConfigPath);
  }
  return {
    ...ctx,
    env: {
      ...ctx.env,
      RIFTY_VITE_CLI_MODE: mode,
      ...(previewMode
        ? { RIFTY_PREVIEW_SCOPE: ctx.env.RIFTY_PREVIEW_SCOPE ?? createPreviewScope() }
        : {}),
      // Stock HMR needs no env (ADR-0189 — the generic preview bridge carries
      // vite's own server.ws); only the ADR-0161 hmr-off pin is threaded.
      ...(mode === 'dev' && opts?.hmrOff ? { RIFTY_VITE_CLI_HMR_OFF: '1' } : {}),
      ...(previewMode ? userConfigEnv : {}),
    },
  };
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
  readonly port: OwnerBridgeKey;
  readonly kernelIpc: KernelIpc;
  readonly publishSnapshot: () => void;
  readonly spec: ProjectSpec;
  readonly slug: string;
  /** Active STARTER id (preset id) for the spawn — keys a synthesized scratch entry (ADR-0165 §4). */
  readonly starter: string;
  /** True when the page picked a fresh starter before this full owner existed. */
  readonly starterGeneratedBaselinePending: boolean;
  /** Hidden first-run owner: real shell/root, but no chosen starter/index scratch. */
  readonly hiddenEmptyBoot: boolean;
  readonly fromScratch: boolean;
  /** kernel worker URL — threaded to the dev-server child so Rolldown's WASI worker pool can spawn worker_threads children (Vite 8). */
  readonly kernelWorkerUrl: string;
  /** node-entry bootstrap worker URL — the supervised child each CLI runs in (ADR-0150). */
  readonly nodeEntryWorkerUrl: string;
  /** dev-server child bootstrap worker URL — the supervised serve:true child the owner spawns (ADR-0150 P6b). */
  readonly devServerWorkerUrl: string;
  /** ts-lsp child bootstrap worker URL — the supervised serve:true LS child the owner spawns (ADR-0166 P1.9a). */
  readonly tsLspWorkerUrl: string;
}): Promise<void> {
  const {
    cfg,
    port,
    kernelIpc,
    publishSnapshot,
    spec,
    slug,
    starter,
    starterGeneratedBaselinePending,
    hiddenEmptyBoot,
    fromScratch,
  } = opts;
  const pendingStarterGeneratedBaseline = new Set<string>();
  const markStarterGeneratedBaselinePending = (root: string): void => {
    pendingStarterGeneratedBaseline.add(root);
  };
  const absorbPendingStarterGeneratedBaseline = async (root: string): Promise<void> => {
    if (!pendingStarterGeneratedBaseline.has(root)) return;
    await amendStarterGeneratedBaseline(ownerGitVfs(), root);
    await flushSyncMirror();
    pendingStarterGeneratedBaseline.delete(root);
  };

  const freshRoot = !syncMirror().existsSync(cfg.root);
  if (!hiddenEmptyBoot && (freshRoot || starterGeneratedBaselinePending)) {
    markStarterGeneratedBaselinePending(cfg.root);
  }
  if (hiddenEmptyBoot) {
    syncMirror().mkdirSync(cfg.root, { recursive: true });
  } else {
    seedProject(cfg);
    if (freshRoot) seedStarterBaseline(starter, cfg.root);
    await ensureStarterInitialCommit(ownerGitVfs(), cfg.root);
  }
  // Instant presets: pre-seed node_modules from the baked snapshot into the owner
  // store NOW, before any dev line (the full fs is already present). from-scratch
  // deps come from the explicit `npm install` boot step — nothing to do here.
  if (!fromScratch && !hiddenEmptyBoot) {
    await restoreInstantDeps(cfg, spec.id, slug);
    await absorbPendingStarterGeneratedBaseline(cfg.root);
  }
  if (!hiddenEmptyBoot) seedTemplateNodeModulesFiles(cfg);
  const ownerGit = makeGit({ fs: vfsToGitFs(ownerGitVfs()), dir: cfg.root });
  const gitStatusFeed = serveGitStatusFeed(port, ownerGit);
  const publishOwnerState = (): void => {
    publishSnapshot();
    gitStatusFeed.schedule();
  };
  const publishOwnerStateNow = (): void => {
    publishSnapshot();
    void gitStatusFeed.publishNow({ force: true });
  };
  publishOwnerState();
  // Readiness handshake (ADR-0146, explorer reflects the owner tree): the page
  // replies-via-request rather than a blind retry-storm. Startup publish covers a
  // subscribed page; this covers a page that subscribes/reloads after us.
  const tearSnapReq = serveSnapshotRequests(port, publishOwnerStateNow);

  // Owner→page frames (pty + dev-server status). republish on `pty:exit` since a
  // finished command may have mutated the tree (ADR-0146: owner republishes its
  // snapshot on command exit so the explorer reflects the owner tree). Mirror the
  // dev-server preview slot by observing the dev-server status frames flowing
  // through here (ADR-0155 — the registry's dev slot tracks the SAME `pty:dev-server`
  // running/stopped frames the page pill already consumes; this ADDS the mirror, it
  // does not replace the status path).
  //
  function send(frame: OwnerToPageFrame): void {
    kernelIpc.send?.({ type: PTY_IPC_TYPE, frame });
    if (frame.type === 'pty:exit') publishOwnerState();
  }

  // Multi-port preview registry (ADR-0155/0174) + the SINGLE `pty:dev-server`
  // authority: the LIVE pill derives from the listening-port set — any guest
  // server (vite, webpack-dev-server, bare node:http) flips it; no bin-name
  // keying.
  const previews: PreviewRegistry = createPreviewRegistry({ send });

  // The persistent owner is spawned once with the default template; a preset
  // switch updates which template/runtime the NEXT co-resident dev server boots
  // (ADR-0148 — the page sends `pty:dev-config` before re-running the dev line).
  let devSpec = spec;
  let devCfg = cfg;
  let devSlug = slug;
  let devFromScratch = fromScratch;
  let lastDevTemplateId: string | null = null;
  let lastDevRoot: string | null = null;
  let devConfigReady: Promise<void> = Promise.resolve();

  function devConfigRequestsWorkspaceTypeScript(): boolean {
    return effectiveDepsFromPackageJsonText(devCfg.packageJson)?.typescript !== undefined;
  }

  async function waitForWorkspaceTypeScript(root: string): Promise<void> {
    const path = normalizePath(`${root}/${TS_LSP_TYPESCRIPT_ENTRY_RELATIVE_PATH}`);
    const started = performance.now();
    while (!syncMirror().existsSync(path)) {
      if (performance.now() - started >= TS_LSP_TYPESCRIPT_READY_TIMEOUT_MS) {
        throw new Error(`workspace TypeScript not ready at ${path}`);
      }
      await sleep(TS_LSP_TYPESCRIPT_READY_POLL_MS);
    }
  }

  async function waitForTsLspDependencies(): Promise<void> {
    await devConfigReady;
    if (devConfigRequestsWorkspaceTypeScript()) await waitForWorkspaceTypeScript(devCfg.root);
  }

  async function prepareActiveDevConfigDeps(): Promise<void> {
    try {
      if (!devFromScratch) {
        await restoreInstantDeps(devCfg, devSpec.id, devSlug);
        await absorbPendingStarterGeneratedBaseline(devCfg.root);
      }
      seedTemplateNodeModulesFiles(devCfg);
      publishOwnerState();
    } catch (err) {
      log(
        `[shell-owner/worker] dev config dependency restore failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }

  // Co-resident dev server (ADR-0148): the vite/node tail runs in THIS realm,
  // on demand, reading the realm's installed tree → it sees terminal-installed deps.
  const devServer = createDevServerController({
    lifecycle: previews,
    // v1: boot runs to completion; a Ctrl-C mid-boot takes effect right after
    // (the controller stops the server once `signal` aborts) — not mid-install.
    boot: async (signal, devLog, devSid) => {
      const cleanForSwitch = shouldCleanForDevBootWithInstallState({
        lastTemplateId: lastDevTemplateId,
        lastRoot: lastDevRoot,
        nextTemplateId: devSpec.id,
        nextRoot: devCfg.root,
        fromScratch: devFromScratch,
        installStampSatisfied:
          devFromScratch &&
          (await installStampSatisfiedForPackageJson(
            new SyncMirrorVfs(),
            devCfg.root,
            devSlug,
            devCfg.packageJson,
          )) !== null,
      });
      if (cleanForSwitch) {
        // Root OR template switched (ADR-0165 §5): a fresh worker per preset used
        // to keep node_modules clean; the ONE persistent owner accumulates the
        // prior project's deps, which trips the new template's lockfile coverage
        // (EBROKENLOCK). Two projects from the SAME starter share templateId but
        // must NOT share node_modules, so a root change also cleans. Clear
        // node_modules + the lockfile + package.json so the new template seeds its
        // own package.json (the child seeds it back if-absent) and installs
        // cleanly. A same-template + same-root reload skips this — preserving the
        // user's package.json + installed tree. Owner-realm stateful across runs:
        // the clean runs HERE on the owner store the child reads over fs.* RPC.
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
      lastDevRoot = devCfg.root;
      // instant: restore the baked snapshot before booting (stamp-checked, no-op if
      // the owner pre-seed / a prior boot already did it; after a root/template
      // clean it re-seeds package.json + node_modules for the active root). from-scratch
      // deps come SOLELY from the explicit `npm install` boot step.
      if (!devFromScratch) {
        await restoreInstantDeps(devCfg, devSpec.id, devSlug);
        await absorbPendingStarterGeneratedBaseline(devCfg.root);
      }
      // The owner store is what the shell and TS LS read. Restore/clean may replace
      // node_modules, so re-assert template-owned declaration packages last.
      seedTemplateNodeModulesFiles(devCfg);
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
          previewScope: createPreviewScope(),
        },
        onSnapshotDirty: publishOwnerState,
        // Post-ready port changes (the entry called server.close() / re-listened):
        // update the dev slot so the pill tracks the child's REAL port set.
        onPortsChanged: (ports, previewScope) => {
          const next = ports[0];
          if (next === undefined) previews.clearDevServer();
          else previews.setDevServer(next, previewScope, devSid);
        },
        // Owner realm → real OWNER OPFS drain. The child's install writes land in
        // THIS realm's write-through queue over fs.* RPC; the child's own flush is
        // a no-op (remote SyncRpcFsSync has none). Drain here on dev-ready so the
        // queue is empty for later shell writes (they then persist before a reload
        // terminates the owner). Replaces the pre-P6b in-owner install flush.
        flush: flushSyncMirror,
      });
    },
  });

  // Live foreground bin children — editor writes are forwarded to EVERY one so
  // HMR invalidation is not keyed on a bin name; a child without an active vite
  // server ignores the frame (node-entry-bootstrap's isViteFileChangeMessage
  // handler no-ops). HMR itself is stock (ADR-0189 generic preview WS bridge);
  // the vite-NAMED remainder is the wrapper's forced options in
  // withViteCliArgs/withViteCliEnv below — owned by backlog:
  // net/preview-websocket-bridge (acceptance: per-option retirement).
  const liveBinChildren = new Set<BinWorkerHandle>();
  // Editor writes land via the vfs-write bridge; forward them to the running dev
  // server's HMR (the virtual FS fires no real watcher events) + republish.
  const onVfsWrite = (paths: readonly string[]): void => {
    publishOwnerState();
    for (const path of paths) {
      devServer.notifyFileChanged(path);
      for (const child of liveBinChildren) {
        child.send?.({ type: 'rifty:vite-file-change', path });
      }
    }
  };
  const tearVfsBridge = serveVfsWrites(port, { onWrite: onVfsWrite });
  const tearGitBridge = serveGitOwnerRpc(port, ownerGit);

  const vfs = new SyncMirrorVfs();
  const registry = createProxiedRegistryClient();
  let binRunSeq = 0;
  const binPreviewSids = new WeakMap<object, string>();
  const binChildHandles = new WeakMap<object, BinWorkerHandle>();
  // ADR-0174: each foreground CLI runs as a server-capable supervised child over
  // the real `.bin` shim. Lifecycle is UNIFORM — the child posts its listening
  // port set (`rifty:node-listening`, sourced from the net registry's
  // register/unregister events); the preview registry derives the LIVE pill from
  // it. No bin-name dispatch: webpack-dev-server or a bare server CLI gets the
  // same preview + pill wiring vite does.
  const childBinExecutor = createOwnerChildBinExecutor(opts.nodeEntryWorkerUrl, {
    onStart: (req) => {
      binPreviewSids.set(req, `bin-${++binRunSeq}`);
    },
    onSpawn: (req, handle) => {
      binChildHandles.set(req, handle);
      liveBinChildren.add(handle);
    },
    onMessage: (req, message, ctx) => {
      if (!isNodeChildMessage(message)) return;
      const sid = binPreviewSids.get(req);
      if (sid === undefined) return;
      previews.addNode(sid, message.ports, message.previewScope ?? previewScopeFromEnv(req.env), {
        ptySid: ptySidFromContext(ctx),
        cwd: ctx.cwd,
        labelBase: binNameOf(req.shimPath),
      });
    },
    onExit: (req) => {
      const handle = binChildHandles.get(req);
      if (handle) liveBinChildren.delete(handle);
      const sid = binPreviewSids.get(req);
      if (sid !== undefined) previews.removeBySid(sid);
    },
  });
  const ownerBinExecutor: BinExecutor = (binPath, args, ctx) => {
    const viteArgs = withViteCliArgs(binPath, args, ctx);
    const viteCtx = withViteCliEnv(
      binPath,
      args,
      ctx,
      devCfg.runtime === 'vite' && !devCfg.hmrEnabled ? { hmrOff: true } : undefined,
    );
    return childBinExecutor(binPath, viteArgs, withPreviewScope(viteCtx));
  };
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
      await devServer.run(
        signal,
        (chunk) => ctx.stdout.write(chunk),
        ptySidFromContext(ctx),
        ctx.cwd,
      );
      return 130; // resolves only when `signal` aborts (Ctrl-C)
    } catch (err) {
      if (signal.aborted) return 130;
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  };

  const makeShell = (
    seed?: { cwd?: string; env?: Record<string, string> },
    ptySid?: string,
  ): Shell => {
    // Seed restores persisted terminal cwd/env on reload (ADR-0146); falls back
    // to the workspace root + empty env for a fresh session. The cwd is validated
    // HERE against the owner's tree (single-store-owner: the page holds no
    // authoritative store to check), resetting to root if the persisted dir was
    // deleted since.
    const shell = new Shell({
      cwd: reachableCwd(syncMirror(), seed?.cwd, cfg.root),
      env: {
        ...(seed?.env ?? {}),
        ...(ptySid === undefined ? {} : { [PTY_SESSION_ENV]: ptySid }),
      },
      execBin: ownerBinExecutor,
    });
    const runPackageScript = async (
      name: string,
      command: string,
      ctx: CommandContext,
    ): Promise<number> => {
      const runScriptCommand = async (
        scriptCommand: string,
        scriptCtx: CommandContext,
      ): Promise<number> => {
        const scriptShell = makeShell(
          { cwd: scriptCtx.cwd, env: scriptCtx.env },
          ptySidFromContext(scriptCtx),
        );
        try {
          const result = await scriptShell.run(scriptCommand, {
            onChunk: (chunk, stream) => {
              if (stream === 'stdout') scriptCtx.stdout.write(chunk);
              else scriptCtx.stderr.write(chunk);
            },
            signal: scriptCtx.signal,
            isTTY: scriptCtx.isTTY,
            cols: scriptCtx.cols,
            rows: scriptCtx.rows,
            stdin: scriptCtx.stdin,
          });
          return result.exitCode;
        } finally {
          scriptShell.dispose();
        }
      };
      const runNodeCliTemplate = async (
        scriptCommand: string,
        scriptCtx: CommandContext,
      ): Promise<number> => {
        scriptCtx.stdout.write(`cli: running ${devSpec.displayName}\n`);
        const code = await runScriptCommand(scriptCommand, scriptCtx);
        scriptCtx.stdout.write(`[cli] completed with exit code ${code}\n`);
        return code;
      };
      // Node-server dev aliases still drive the lifecycle-owned preview state.
      // Vite scripts run through the real shell/bin path so `npm run vite` is as
      // honest as typing `vite` directly.
      if (devSpec.runtime === 'node-cli' && isDevScriptName(devSpec, name)) {
        return runNodeCliTemplate(command, ctx);
      }
      if (devSpec.runtime === 'node-server' && isDevScriptName(devSpec, name)) {
        return runDevServer(ctx);
      }
      return runScriptCommand(command, ctx);
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
      runScript: runPackageScript,
      // ADR-0182 opt-in fast install — env-config only (default OFF). When a
      // resolver URL is configured the visible `npm install` uses eddy's bundle
      // + auto-fallback; inert (byte-identical) when unset.
      resolverUrl: getResolverUrl(),
    });
    shell.registerCommand('npm', async (args, ctx) => {
      const absorbGeneratedBaseline =
        devFromScratch && isFullInstall(args) && pendingStarterGeneratedBaseline.has(devCfg.root);
      // Faithful from-scratch: the FIRST `npm install` of a from-scratch preset (no
      // slug stamp yet) starts CLEAN — clear any prior preset's node_modules +
      // lockfile and re-seed THIS preset's package.json — so it is a real COLD
      // install, not an EBROKENLOCK over a foreign (e.g. instant-snapshot) tree. A
      // reload (slug stamped) installs over the existing tree (npm-faithful no-op),
      // preserving the user's edits. Runs in the owner, ATOMIC with the install (the
      // `npm install && <dev>` boot line never races it).
      if (devFromScratch && isFullInstall(args)) {
        const stamped = await installStampSatisfiedForPackageJson(
          new SyncMirrorVfs(),
          devCfg.root,
          devSlug,
          devCfg.packageJson,
        );
        if (!stamped) {
          const fs = syncMirror();
          clearProjectTree(fs, devCfg.root);
          fs.writeFileSync(
            normalizePath(`${devCfg.root}/package.json`),
            enc.encode(devCfg.packageJson),
          );
        }
      }
      const code = await npmCommand(args, ctx);
      if (code === 0 && absorbGeneratedBaseline) {
        await absorbPendingStarterGeneratedBaseline(devCfg.root);
      }
      publishOwnerState(); // node_modules may have changed — refresh the page's view
      return code;
    });
    // `node <file> [args]` (ADR-0155): resolve the entry against the owner store,
    // then run it in a supervised child. A long-running server child registers a
    // preview slot via `onListening`; the slot is dropped on exit. A clean Node
    // diagnostic (exit 1) on a missing/absent entry — never a silent stub.
    const spawnNodeEntry = (
      entryPath: string,
      scriptArgs: readonly string[],
      ctx: CommandContext,
    ): Promise<number> => {
      const sid = `node-${++nodeRunSeq}`;
      const previewScope = createPreviewScope();
      return ownerNodeExecutor(entryPath, [...scriptArgs], withPreviewScope(ctx, previewScope), {
        sid,
        onListening: (id, ports, scope) =>
          previews.addNode(id, ports, scope ?? previewScope, {
            ptySid: ptySidFromContext(ctx),
            cwd: ctx.cwd,
          }),
        onExit: (id) => previews.removeBySid(id),
      });
    };
    // `-e`/`-p`: write the source to a temp `.cjs` in cwd (so `require` resolves
    // like real `node -e`, faithful CJS), run it through the loader realm, then
    // clean up regardless of outcome — never `new Function` (require/import stay real).
    const runNodeEval = async (
      inv: Extract<NodeInvocation, { kind: 'eval' }>,
      ctx: CommandContext,
    ): Promise<number> => {
      const fs = syncMirror();
      const evalPath = normalizePath(`${ctx.cwd}/.rifty-eval-${++nodeRunSeq}.cjs`);
      fs.writeFileSync(evalPath, enc.encode(buildNodeEvalSource(inv.source, inv.print)));
      try {
        return await spawnNodeEntry(evalPath, inv.scriptArgs, ctx);
      } finally {
        try {
          fs.rmSync(evalPath, { force: true });
        } catch {
          /* best-effort cleanup of the transient eval file */
        }
      }
    };
    shell.registerCommand('node', (args, ctx) => {
      const inv = classifyNodeInvocation(args);
      switch (inv.kind) {
        case 'missing': {
          // Single source of the usage message; bare REPL stays the ADR-0155 ceiling.
          const r = resolveNodeEntry(ctx.cwd, undefined);
          if (!r.ok) ctx.stderr.write(r.message);
          return Promise.resolve(1);
        }
        case 'version':
          ctx.stdout.write(`${NODE_PROCESS_IDENTITY.version}\n`);
          return Promise.resolve(0);
        case 'badOption':
          // Node's shape for an unknown option — never a MODULE_NOT_FOUND on /<flag>.
          ctx.stderr.write(`node: bad option: ${inv.flag}\n`);
          return Promise.resolve(9);
        case 'eval':
          return runNodeEval(inv, ctx);
        case 'entry': {
          const r = resolveNodeEntry(ctx.cwd, inv.arg);
          if (!r.ok) {
            ctx.stderr.write(r.message);
            return Promise.resolve(1);
          }
          return spawnNodeEntry(r.path, inv.scriptArgs, ctx);
        }
      }
    });
    return shell;
  };

  const server = createPtyServer({
    send,
    makeShell,
    onDevServerReq: () => previews.publishDev(),
    // ADR-0155: answer a page subscribe by re-emitting the full preview-port set.
    onPreviewReq: () => previews.publish(),
    // Re-resolve the dev-server config for the current preset (ADR-0148) so a
    // node-server preset boots its OWN runtime/port, not the spawn-time default.
    onDevConfig: (config) => {
      devSpec = resolveProjectSpec(config.templateId);
      devCfg = resolveBootstrapConfig(devSpec, devSpec.defaultPort, cfg.root);
      devSlug = config.slug;
      devFromScratch = config.setup === 'from-scratch';
      devConfigReady = prepareActiveDevConfigDeps();
      return devConfigReady;
    },
  });

  // ADR-0166 P1.9a — TS language-service child + page↔LS relay. There is no
  // direct page→grandchild channel, so page↔LS `rifty:ts-lsp` frames flow:
  //   page →(page↔owner fork-IPC)→ owner → lsChild.send →(owner↔LS fork-IPC)→ LS
  //   LS →process.send→ owner → kernelIpc.send →(owner↔page fork-IPC)→ page
  // The LS child is spawned lazily on the FIRST inbound request (the page only
  // talks to it once the editor opens a file), reading the owner store over fs.*
  // sync-RPC (RIFTY_REMOTE_FS=1) — exactly the dev-server child's spawn shape.
  // It is serve:true (a long-lived service); the owner stays a free supervisor.
  let lsChild: WorkerProcessHandle | null = null;
  function spawnTsLspChild(): WorkerProcessHandle {
    const tsSpec: SpawnWorkerSpec = {
      entry: { kind: 'url', url: opts.tsLspWorkerUrl },
      argv: ['rifty', 'ts-lsp'],
      env: {
        RIFTY_REMOTE_FS: '1',
        RIFTY_RFV_ROOT: cfg.root,
      },
      cwd: cfg.root,
      serve: true,
    };
    const h = globalProcessManager.spawnWorker('ts-lsp', tsSpec, 1);
    if (h.kind !== 'worker') {
      throw new Error(`ts-lsp child: expected worker handle, got ${h.kind}`);
    }
    // LS child → owner → page: forward only RESPONSE envelopes back to the page.
    h.on('message', (response: unknown) => {
      if (isTsResponseMessage(response)) kernelIpc.send?.(stampTsLspOwner(response, port));
    });
    // A crashed LS child must not leave the page hanging: drop the handle so the
    // next request respawns. In-flight page requests reject on their own timeout
    // (the page LS client arms one) — never a silent hang (Fidelity: loud gaps).
    h.on('exit', (code?: unknown) => {
      log(`[shell-owner/worker] ts-lsp child exited (code ${String(code)})\n`);
      if (lsChild === h) lsChild = null;
    });
    // Surface LS-child stdout/stderr into the owner log (e2e debugging: a worker
    // console is not captured, so the package routes its logs through stdout).
    h.stdout().on('data', (chunk: unknown) => log(decodeLsChunk(chunk)));
    h.stderr().on('data', (chunk: unknown) => log(decodeLsChunk(chunk)));
    return h;
  }
  function relayTsLspRequest(message: unknown): void {
    if (lsChild === null) lsChild = spawnTsLspChild();
    // Pass the envelope through untouched (id preserved end-to-end).
    lsChild.send(message);
  }

  kernelIpc.onMessage?.((message) => {
    if (isPtyIpcMessage(message)) {
      // Only page→owner frames are inbound here; ignore a stray owner→page echo.
      if (isPageToOwner(message.frame)) {
        const frame = message.frame;
        if (frame.type === 'pty:exec') {
          void devConfigReady.then(() => server.handleFrame(frame));
          return;
        }
        void server.handleFrame(frame);
      }
      return;
    }
    if (isVfsWriteIpcMessage(message)) {
      if (!message.opId) {
        applyVfsWriteFrame(message.frame, { onWrite: onVfsWrite });
        return;
      }
      try {
        applyVfsWriteFrame(message.frame, { onWrite: onVfsWrite });
        kernelIpc.send?.({ type: 'rifty:vfs-write-ack', opId: message.opId, ok: true });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        kernelIpc.send?.({
          type: 'rifty:vfs-write-ack',
          opId: message.opId,
          ok: false,
          error: { name: error.name, message: error.message },
        });
      }
      return;
    }
    // ADR-0166 P1.9a: a page→LS request envelope — relay to the LS child (lazy
    // spawn on first frame). Only REQUEST envelopes are inbound from the page.
    // Preset switches restore package.json/node_modules asynchronously; the LS
    // must see the same dependency-ready tree as the dev line before it resolves
    // the workspace `typescript` package.
    if (isTsRequestMessage(message) && tsLspOwnerMatches(message, port)) {
      void (async (): Promise<void> => {
        await waitForTsLspDependencies();
        relayTsLspRequest(message);
      })().catch((err: unknown) => {
        const requestId = message.request.id;
        const error = err instanceof Error ? err : new Error(String(err));
        kernelIpc.send?.(
          stampTsLspOwner(
            {
              type: 'rifty:ts-lsp',
              response: {
                id: requestId,
                ok: false,
                kind: 'error',
                error: { name: error.name, message: error.message },
              },
            },
            port,
          ),
        );
      });
    }
  });

  // Workspace read bridge (ADR-0080 + ADR-0148): the page reads the installed +
  // project tree against this realm's syncMirror. Kept live by the serve:true realm.
  const tearNodeModulesBridge = serveNodeModulesReads(port, cfg.root);
  // Workspace archive export/import (single-store-owner: one authoritative store
  // owner, the page holds no authoritative fs): the owner serializes /
  // applies its own tree so the PAGE keeps no authoritative store of its own.
  const tearArchiveBridge = serveWorkspaceArchive(port, cfg.root);
  // Full-byte single-file downloads read from the owner, not the capped page snapshot.
  const tearFileReadBridge = serveWorkspaceFileReads(port, cfg.root);
  // ADR-0165 §7 boot reconcile + scratch synthesis (BEFORE serving the index):
  // finish/roll back a half-completed Save and synthesize a scratch entry keyed on
  // the spawn STARTER when /scratch exists but the index is a cold-boot empty — so
  // the owner index is the REAL hydrate source AND saveScratchAsProject's
  // `if(!index.scratch) throw` precondition holds. See reconcileOwnerIndexAtBoot.
  if (hiddenEmptyBoot) recoverIndex(syncMirror(), '/');
  else reconcileOwnerIndexAtBoot(syncMirror(), starter);
  // ADR-0165: the OPFS project index is worker-writable only; serve it so the page
  // launcher hydrates an in-memory mirror across owner respawns. Read against THIS
  // realm's syncMirror (the owner owns the index); base '/' = the OPFS root.
  // `publishOwnerState` is the reset-refresh hook (ADR-0165 §6): an in-place
  // re-seed bypasses onVfsWrite, so the index bridge republishes the file snapshot
  // and schedules rifty-git status refresh together.
  const tearIndexBridge = serveProjectIndex(
    port,
    syncMirror(),
    '/',
    flushSyncMirror,
    publishOwnerState,
    async (root) => {
      markStarterGeneratedBaselinePending(root);
      await ensureStarterInitialCommit(ownerGitVfs(), root);
    },
  );
  kernelIpc.send?.({ type: 'rifty:workspace-owner-ready', port });
  log('[shell-owner/worker] pty server ready; workspace read + archive bridges live\n');

  // Referenced so the served bridges + server aren't GC'd while the realm serves.
  void tearVfsBridge;
  void gitStatusFeed;
  void tearGitBridge;
  void tearSnapReq;
  void tearNodeModulesBridge;
  void tearArchiveBridge;
  void tearFileReadBridge;
  void tearIndexBridge;
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
  const port = env.RIFTY_RFV_PORT ?? 'owner:default';
  // ADR-0165 §4: the active root is `/scratch` or `/projects/<id>` — the page
  // always sets RIFTY_RFV_ROOT via rootForId(activeId); the fallback is the
  // default scratch root (the legacy single `/workspace` no longer exists).
  const root = env.RIFTY_RFV_ROOT ?? '/scratch';
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
  // Active STARTER (preset id) for a synthesized scratch entry (ADR-0165 §4): the
  // slug is the active ROOT id ('scratch' or a projectId), not the starter, so the
  // page sends the real starter over RIFTY_RFV_STARTER. Fall back to the default
  // starter id (a fresh boot before the page picks anything).
  const starter = env.RIFTY_RFV_STARTER ?? DEFAULT_PRESET.id;
  const starterGeneratedBaselinePending = env.RIFTY_RFV_STARTER_BASELINE_PENDING === '1';
  const hiddenEmptyBoot = env.RIFTY_RFV_HIDDEN_EMPTY_BOOT === '1';
  // Honour an explicit entry override on the spawn spec (usually a no-op —
  // the orchestrator defaults it to the template's own entry).
  const effectiveSpec = withEntryOverride(spec, env.RIFTY_RFV_ENTRY ?? spec.entry.relativePath);
  // ADR-0148: `port` (RIFTY_RFV_PORT) keys the owner's snapshot/nm/vfs-write
  // bridges. It is a synthetic owner bridge key, not a real network port. The
  // co-resident dev server listens on the template's own port (`cfg.port`).
  const cfg = resolveBootstrapConfig(effectiveSpec, effectiveSpec.defaultPort, root);

  const kernelIpc = installRuntimeGlobals();
  // Same root as the process.env "chunk-graph leak" note above: this self-contained
  // owner bundle carries its OWN `@riftydev/io` Buffer copy, but the pre-entry hook
  // set globalThis.Buffer from the kernel-worker-entry copy. Realign so the owner's
  // module loader (`require('buffer')`) and the global agree. See installBundleLocalBuffer.
  installBundleLocalBuffer();
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
    const prefix = scopeActiveVfsToWorkspace(env.RIFTY_WORKSPACE_ID ?? 'default');
    log(`[shell-owner/worker] VFS backend: ${backend} (${prefix})\n`);
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
  // ADR-0166 P1.9a: child entry for the TS language service (serve:true grandchild).
  const tsLspWorkerUrl = env.RIFTY_TS_LSP_WORKER_URL;
  if (!kernelWorkerUrl || !nodeEntryWorkerUrl || !devServerWorkerUrl || !tsLspWorkerUrl) {
    throw new Error(
      'workspace-owner: missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL / RIFTY_DEV_SERVER_WORKER_URL / RIFTY_TS_LSP_WORKER_URL — cannot spawn child CLIs, the dev server, or the language service',
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
    starter,
    starterGeneratedBaselinePending,
    hiddenEmptyBoot,
    fromScratch,
    kernelWorkerUrl,
    nodeEntryWorkerUrl,
    devServerWorkerUrl,
    tsLspWorkerUrl,
  });
}

await bootstrap();
