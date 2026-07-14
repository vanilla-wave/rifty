import { trackKeepalivePromise } from '@riftydev/runtime-js';
import type { CommandContext } from '@riftydev/shell';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { applyViteCliActionPatch, viteCliActionPatchApplied } from './vite-cli-install-policy.ts';
import { prepareViteEsbuildRuntime } from './vite-esbuild-runtime.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
export type ViteCliMode = 'dev' | 'build' | 'preview' | 'optimize' | 'info';

declare global {
  // Pins detached async CLI actions (Vite's bundled CAC parse() does not await them).
  // eslint-disable-next-line no-var
  var __riftyTrackCliPromise: ((promise: PromiseLike<unknown>) => void) | undefined;
}

// Env → CLI-prep decoding: the owner sets RIFTY_VITE_CLI_* on the child;
// node-entry-bootstrap threads proc.env through these (moved here for node
// testability — the bootstrap is a worker-only entry).
export function viteCliModeFromEnv(value: string | undefined): ViteCliMode | null {
  return value === 'dev' ||
    value === 'build' ||
    value === 'preview' ||
    value === 'optimize' ||
    value === 'info'
    ? value
    : null;
}

export interface ViteCliPreparation {
  readonly root: string;
  readonly mode: ViteCliMode;
  readonly executedBinPath: string;
  readonly esbuildWasmUrl: string;
}

/** Decode one complete bootstrap-owned Vite preparation or no preparation. */
export function viteCliPreparationFromEnv(options: {
  readonly root: string;
  readonly mode: string | undefined;
  readonly executedBinPath: string;
  readonly esbuildWasmUrl: string;
}): ViteCliPreparation | null {
  const mode = viteCliModeFromEnv(options.mode);
  return mode === null
    ? null
    : {
        root: options.root,
        mode,
        executedBinPath: options.executedBinPath,
        esbuildWasmUrl: options.esbuildWasmUrl,
      };
}

// NOT shadow-registry shims (those apply at install time, ADR-0188): this
// patches Vite's own CLI before package promotion. Trusted child startup only
// validates the exact bytes below; it never repairs node_modules.
function installCliActionPatch(vitePackageRoot: string): void {
  const fs = syncMirror();
  const path = normalizePath(`${vitePackageRoot}/dist/node/cli.js`);
  if (!fs.existsSync(path)) return;
  const source = dec.decode(fs.readFileBytesSync(path));
  const prepared = applyViteCliActionPatch(source);
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

const VITE_BIN_SUFFIX = '/.bin/vite';
function vitePackageRoot(root: string, executedBinPath?: string): string {
  if (executedBinPath === undefined) return normalizePath(`${root}/node_modules/vite`);
  const binPath = normalizePath(executedBinPath);
  if (!binPath.endsWith(VITE_BIN_SUFFIX)) {
    throw new Error(`vite CLI preparation expected an executed .bin/vite; got ${executedBinPath}`);
  }
  const nodeModules = binPath.slice(0, -VITE_BIN_SUFFIX.length);
  if (!nodeModules.endsWith('/node_modules')) {
    throw new Error(`vite CLI preparation cannot resolve package from ${executedBinPath}`);
  }
  return `${nodeModules}/vite`;
}

/** Acquisition-adapter step: patch installed Vite before its stamp promotion. */
export async function prepareViteCliAcquisitionFiles(
  root: string,
  executedBinPath?: string,
): Promise<void> {
  installCliActionPatch(vitePackageRoot(root, executedBinPath));
}

export async function prepareViteCli(options: ViteCliPreparation): Promise<void> {
  const packageRoot = vitePackageRoot(options.root, options.executedBinPath);
  validateCliActionPatch(packageRoot);
  globalThis.__riftyTrackCliPromise = (promise) => trackKeepalivePromise(promise);
  if (options.mode === 'info') return;
  const fs = syncMirror();
  await prepareViteEsbuildRuntime({
    fs,
    cwd: options.root,
    packageRoot,
    esbuildWasmUrl: options.esbuildWasmUrl,
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

export function withViteCliEnv(
  binPath: string,
  args: readonly string[],
  ctx: CommandContext,
): CommandContext {
  if (binNameOf(binPath) !== 'vite') return ctx;
  const mode = viteCliMode(args);
  const previewMode = mode === 'dev' || mode === 'preview';
  return {
    ...ctx,
    env: {
      ...ctx.env,
      RIFTY_VITE_CLI_MODE: mode,
      ...(previewMode
        ? { RIFTY_PREVIEW_SCOPE: ctx.env.RIFTY_PREVIEW_SCOPE ?? createPreviewScope() }
        : {}),
    },
  };
}
