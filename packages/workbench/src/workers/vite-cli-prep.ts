import type { ShadowAssetRuntimeReader } from '@riftydev/npm-client';
import { trackKeepalivePromise } from '@riftydev/runtime-js';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import type { BinSpawnRequest } from '../glue/bin-executor.ts';
import {
  applyViteCliActionPatch,
  applyViteRootWatchPatch,
  viteCliActionPatchApplied,
  viteRootWatchPatchApplied,
  viteRootWatchPatchPolicy,
} from './vite-cli-install-policy.ts';
import {
  prepareViteConfigTempSource,
  validatePreparedViteConfigSource,
} from './vite-config-temp-patch.ts';
import {
  type ViteEsbuildRuntimeDecision,
  decideViteEsbuildRuntime,
  prepareViteEsbuildRuntime,
} from './vite-esbuild-runtime.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
export type ViteCliMode = 'dev' | 'build' | 'preview' | 'optimize' | 'info';
const VITE_BIN_SUFFIX = '/.bin/vite';
const VITE_DIRECT_CLI_SUFFIX = '/vite/bin/vite.js';
const VITE_CHUNKS_SUFFIX = '/dist/node/chunks';

declare global {
  // Pins detached async CLI actions (Vite's bundled CAC parse() does not await them).
  // eslint-disable-next-line no-var
  var __riftyTrackCliPromise: ((promise: PromiseLike<unknown>) => void) | undefined;
}

export interface ViteCliPreparation {
  readonly root: string;
  readonly mode: ViteCliMode;
  readonly executedBinPath: string;
}

export interface PlannedViteCliPreparation {
  readonly preparation: ViteCliPreparation;
  readonly packageRoot: string;
  readonly runtimeDecision: ViteEsbuildRuntimeDecision;
}

export interface PlannedViteProgrammaticPreparation {
  readonly root: string;
  readonly packageRoot: string;
  readonly runtimeDecision: ViteEsbuildRuntimeDecision;
}

function vitePackageRootFromExecutedEntry(entryPath: string): string | null {
  const path = normalizePath(entryPath);
  const nodeModules = path.endsWith(VITE_BIN_SUFFIX)
    ? path.slice(0, -VITE_BIN_SUFFIX.length)
    : path.endsWith(VITE_DIRECT_CLI_SUFFIX)
      ? path.slice(0, -VITE_DIRECT_CLI_SUFFIX.length)
      : '';
  return nodeModules.endsWith('/node_modules') ? `${nodeModules}/vite` : null;
}

/** Derive one complete Vite preparation from the executed entry + real argv. */
export function viteCliPreparationFromArgs(options: {
  readonly root: string;
  readonly args: readonly string[];
  readonly executedBinPath: string;
}): ViteCliPreparation | null {
  return vitePackageRootFromExecutedEntry(options.executedBinPath) === null
    ? null
    : {
        root: options.root,
        mode: viteCliMode(options.args),
        executedBinPath: options.executedBinPath,
      };
}

// NOT shadow-registry shims (those apply at install time, ADR-0188): this
// patches Vite's own CLI before package promotion. Trusted child startup only
// validates the exact bytes below; it never repairs node_modules.
function installCliActionPatch(vitePackageRoot: string): boolean {
  const fs = syncMirror();
  const path = normalizePath(`${vitePackageRoot}/dist/node/cli.js`);
  if (!fs.existsSync(path)) return false;
  const source = dec.decode(fs.readFileBytesSync(path));
  const prepared = applyViteCliActionPatch(source);
  if (prepared !== source) fs.writeFileSync(path, enc.encode(prepared));
  return true;
}

interface ViteRootWatchPatchSite {
  readonly path: string;
  readonly source: string;
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function rootWatchPatchSite(vitePackageRoot: string): ViteRootWatchPatchSite {
  const fs = syncMirror();
  const chunks = normalizePath(`${vitePackageRoot}${VITE_CHUNKS_SUFFIX}`);
  if (!fs.existsSync(chunks)) {
    throw new Error(`vite root watcher patch failed: missing chunks directory ${chunks}`);
  }
  const sites: ViteRootWatchPatchSite[] = [];
  let anchors = 0;
  for (const entry of fs.readdirSync(chunks)) {
    if (entry.isDirectory || !entry.name.endsWith('.js')) continue;
    const path = `${chunks}/${entry.name}`;
    const source = dec.decode(fs.readFileBytesSync(path));
    const count =
      occurrences(source, viteRootWatchPatchPolicy.needle) +
      occurrences(source, viteRootWatchPatchPolicy.replacement);
    if (count > 0) sites.push({ path, source });
    anchors += count;
  }
  if (anchors !== 1 || sites.length !== 1) {
    throw new Error(
      `vite root watcher patch failed: expected exactly one Chokidar DirEntry.add anchor; found ${anchors}`,
    );
  }
  const site = sites[0];
  if (!site) throw new Error('vite root watcher patch failed: missing patch site');
  return site;
}

function installRootWatchPatch(vitePackageRoot: string): void {
  const fs = syncMirror();
  const { path, source } = rootWatchPatchSite(vitePackageRoot);
  const prepared = applyViteRootWatchPatch(source);
  if (prepared === source) return;
  fs.writeFileSync(path, enc.encode(prepared));
}

function validateCliActionPatch(vitePackageRoot: string): void {
  const fs = syncMirror();
  const path = normalizePath(`${vitePackageRoot}/dist/node/cli.js`);
  if (!fs.existsSync(path)) {
    throw new Error(`vite CLI trusted tree is missing prepared CLI: ${path}`);
  }
  const source = dec.decode(fs.readFileBytesSync(path));
  if (!viteCliActionPatchApplied(source)) {
    throw new Error(`vite CLI files must be prepared by acquisition before promotion: ${path}`);
  }
}

function validateRootWatchPatch(vitePackageRoot: string): void {
  const { path, source } = rootWatchPatchSite(vitePackageRoot);
  if (!viteRootWatchPatchApplied(source)) {
    throw new Error(`vite root watcher must be prepared by acquisition before promotion: ${path}`);
  }
}

function vitePackageRoot(root: string, executedBinPath?: string): string {
  if (executedBinPath === undefined) return normalizePath(`${root}/node_modules/vite`);
  const packageRoot = vitePackageRootFromExecutedEntry(executedBinPath);
  if (packageRoot === null) {
    throw new Error(
      `vite CLI preparation expected an installed Vite entry; got ${executedBinPath}`,
    );
  }
  return packageRoot;
}

/** Acquisition-adapter step: patch installed Vite before its stamp promotion. */
export async function prepareViteCliAcquisitionFiles(
  root: string,
  executedBinPath?: string,
): Promise<void> {
  const packageRoot = vitePackageRoot(root, executedBinPath);
  if (installCliActionPatch(packageRoot)) {
    installRootWatchPatch(packageRoot);
    prepareViteConfigTempSource(syncMirror(), packageRoot);
  }
}

export function planViteCliPreparation(options: ViteCliPreparation): PlannedViteCliPreparation {
  const preparation = Object.freeze({ ...options });
  const packageRoot = vitePackageRoot(preparation.root, preparation.executedBinPath);
  const runtimeDecision = decideViteEsbuildRuntime({ fs: syncMirror(), packageRoot });
  return Object.freeze({ preparation, packageRoot, runtimeDecision });
}

/** Exact installed Vite runtime used when user code imports the API directly. */
export function planViteProgrammaticPreparation(
  rootValue: string,
  packageRootValue?: string,
): PlannedViteProgrammaticPreparation {
  const root = normalizePath(rootValue);
  const packageRoot =
    packageRootValue === undefined ? vitePackageRoot(root) : normalizePath(packageRootValue);
  return Object.freeze({
    root,
    packageRoot,
    runtimeDecision: decideViteEsbuildRuntime({ fs: syncMirror(), packageRoot }),
  });
}

export async function prepareViteCli(
  plan: PlannedViteCliPreparation,
  shadowAssets?: ShadowAssetRuntimeReader,
): Promise<void> {
  const { packageRoot, preparation: options, runtimeDecision } = plan;
  validateCliActionPatch(packageRoot);
  validateRootWatchPatch(packageRoot);
  validatePreparedViteConfigSource(syncMirror(), packageRoot);
  globalThis.__riftyTrackCliPromise = (promise) => trackKeepalivePromise(promise);
  if (runtimeDecision === 'skip-rolldown' && shadowAssets !== undefined) {
    throw new TypeError('Vite 8 preparation must not receive shadow assets');
  }
  const fs = syncMirror();
  await prepareViteEsbuildRuntime({
    fs,
    cwd: options.root,
    decision: runtimeDecision,
    ...(shadowAssets === undefined ? {} : { shadowAssets }),
  });
}

/** Prepare the same installed runtime for `import('vite')`, without CLI globals. */
export async function prepareViteProgrammaticApi(
  plan: PlannedViteProgrammaticPreparation,
  shadowAssets?: ShadowAssetRuntimeReader,
): Promise<void> {
  validateRootWatchPatch(plan.packageRoot);
  validatePreparedViteConfigSource(syncMirror(), plan.packageRoot);
  if (plan.runtimeDecision === 'skip-rolldown' && shadowAssets !== undefined) {
    throw new TypeError('Vite 8 preparation must not receive shadow assets');
  }
  await prepareViteEsbuildRuntime({
    fs: syncMirror(),
    cwd: plan.root,
    decision: plan.runtimeDecision,
    ...(shadowAssets === undefined ? {} : { shadowAssets }),
  });
}

// ——— vite CLI mode/env preparation (relocated from real-vite-bootstrap so the
// behavioral tests can import it in node vitest — the bootstrap module drags
// worker-only deps). Args remain byte-for-byte user-owned.

export function binNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// vite CLI grammar, copied from vite 7.3.6 dist/node/cli.js declarations and
// probed against the real binary (matrix: vite-cli-prep.test.ts, 2026-07-07).
// cac matches a command by parsing argv PER CANDIDATE with mri: flags the
// candidate declares boolean never consume; EVERY other flag — value-taking,
// [optional], unknown — consumes the next non-dash token; `--` ends matching.
const VITE_GLOBAL_BOOLEAN_FLAGS = ['--clearScreen', '-h', '--help', '-v', '--version'];

interface ViteCliCommand {
  readonly names: readonly string[];
  readonly mode: ViteCliMode;
  readonly booleans: readonly string[];
}

const VITE_DEV_COMMAND: ViteCliCommand = {
  names: ['serve', 'dev'],
  mode: 'dev',
  booleans: ['--cors', '--strictPort', '--force'],
};

// Registration order of dist/node/cli.js; dev `[root]` is the default fallback.
const VITE_CLI_COMMANDS: readonly ViteCliCommand[] = [
  VITE_DEV_COMMAND,
  { names: ['build'], mode: 'build', booleans: ['--emptyOutDir', '-w', '--watch', '--app'] },
  { names: ['optimize'], mode: 'optimize', booleans: ['--force'] },
  { names: ['preview'], mode: 'preview', booleans: ['--strictPort'] },
];

type ViteCliToken =
  | {
      readonly kind: 'flag';
      readonly flag: string;
      readonly value: string | null;
      readonly raw: readonly string[];
    }
  | { readonly kind: 'positional'; readonly value: string; readonly raw: readonly string[] }
  /** `--` and everything after it — excluded from command matching. */
  | { readonly kind: 'rest'; readonly raw: readonly string[] };

function scanViteCliArgs(args: readonly string[], booleans: ReadonlySet<string>): ViteCliToken[] {
  const out: ViteCliToken[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      out.push({ kind: 'rest', raw: args.slice(i) });
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      out.push({ kind: 'positional', value: arg, raw: [arg] });
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out.push({ kind: 'flag', flag: arg.slice(0, eq), value: arg.slice(eq + 1), raw: [arg] });
      continue;
    }
    const next = args[i + 1];
    if (
      booleans.has(arg) ||
      arg.startsWith('--no-') ||
      next === undefined ||
      next.startsWith('-')
    ) {
      out.push({ kind: 'flag', flag: arg, value: null, raw: [arg] });
      continue;
    }
    out.push({ kind: 'flag', flag: arg, value: next, raw: [arg, next] });
    i += 1;
  }
  return out;
}

function viteCliGrammar(cmd: ViteCliCommand): ReadonlySet<string> {
  return new Set([...VITE_GLOBAL_BOOLEAN_FLAGS, ...cmd.booleans]);
}

interface ViteCliParse {
  readonly mode: ViteCliMode;
  readonly tokens: readonly ViteCliToken[];
}

function parseViteCliArgs(args: readonly string[]): ViteCliParse {
  let matched: { cmd: ViteCliCommand; tokens: ViteCliToken[] } | null = null;
  for (const cmd of VITE_CLI_COMMANDS) {
    const tokens = scanViteCliArgs(args, viteCliGrammar(cmd));
    const first = tokens.find((t) => t.kind === 'positional');
    if (first?.kind === 'positional' && cmd.names.includes(first.value)) {
      matched = { cmd, tokens };
      break;
    }
  }
  const namedCommandMatched = matched !== null;
  matched ??= {
    cmd: VITE_DEV_COMMAND,
    tokens: scanViteCliArgs(args, viteCliGrammar(VITE_DEV_COMMAND)),
  };
  const hasHelp = matched.tokens.some(
    (t) => t.kind === 'flag' && (t.flag === '--help' || t.flag === '-h'),
  );
  const hasVersion = matched.tokens.some(
    (t) => t.kind === 'flag' && (t.flag === '--version' || t.flag === '-v'),
  );
  return {
    mode: hasHelp || (hasVersion && !namedCommandMatched) ? 'info' : matched.cmd.mode,
    tokens: matched.tokens,
  };
}

export function viteCliMode(args: readonly string[]): ViteCliMode {
  return parseViteCliArgs(args).mode;
}

export function createPreviewScope(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`;
}

export function prepareViteBinSpawnRequest(request: BinSpawnRequest): BinSpawnRequest {
  if (binNameOf(request.shimPath) !== 'vite') return request;
  const mode = viteCliMode(request.args);
  const previewMode = mode === 'dev' || mode === 'preview';
  return {
    ...request,
    env: {
      ...request.env,
      // Public napi-rs selector: rifty installs WASI bindings and no native
      // platform package. This is guest-visible library configuration, not a
      // host launch-role/control channel (ADR-0051/0162).
      NAPI_RS_FORCE_WASI: '1',
    },
    ...(previewMode && request.previewScope === undefined
      ? { previewScope: createPreviewScope() }
      : {}),
  };
}
