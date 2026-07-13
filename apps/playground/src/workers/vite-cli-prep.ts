import { trackKeepalivePromise } from '@riftydev/runtime-js';
import type { CommandContext } from '@riftydev/shell';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { prepareViteEsbuildRuntime } from './vite-esbuild-runtime.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const VITE_CLI_KEEPALIVE_NEEDLE = 'this.runMatchedCommand();';
const VITE_CLI_KEEPALIVE_PATCH = `var __riftyAction = this.runMatchedCommand();
      if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.__riftyTrackCliPromise) {
        globalThis.__riftyTrackCliPromise(__riftyAction);
      }`;
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

// NOT shadow-registry shims (those apply at install time, ADR-0188): these
// patch vite's OWN dist/node/cli.js for rifty's runtime lifecycle. CAC never
// awaits async actions, so the keepalive pin is the sole patch.
function installCliActionPatch(vitePackageRoot: string): void {
  globalThis.__riftyTrackCliPromise = (promise) => trackKeepalivePromise(promise);
  const fs = syncMirror();
  const path = normalizePath(`${vitePackageRoot}/dist/node/cli.js`);
  if (!fs.existsSync(path)) return;
  let source = dec.decode(fs.readFileBytesSync(path));
  let changed = false;
  if (!source.includes('__riftyTrackCliPromise')) {
    if (!source.includes(VITE_CLI_KEEPALIVE_NEEDLE)) {
      throw new Error('vite CLI keepalive patch failed: runMatchedCommand call shape not found');
    }
    source = source.replace(VITE_CLI_KEEPALIVE_NEEDLE, VITE_CLI_KEEPALIVE_PATCH);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, enc.encode(source));
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

export async function prepareViteCliFiles(root: string, executedBinPath?: string): Promise<void> {
  installCliActionPatch(vitePackageRoot(root, executedBinPath));
}

export async function prepareViteCli(
  root: string,
  mode: ViteCliMode,
  executedBinPath: string,
): Promise<void> {
  await prepareViteCliFiles(root, executedBinPath);
  if (mode === 'info') return;
  const fs = syncMirror();
  await prepareViteEsbuildRuntime({
    fs,
    cwd: root,
    packageRoot: vitePackageRoot(root, executedBinPath),
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
