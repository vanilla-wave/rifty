import { trackKeepalivePromise } from '@riftydev/runtime-js';
import type { CommandContext } from '@riftydev/shell';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import { installEsbuildTransformBridge } from './esbuild-wasi-transform.ts';
import { assertNoUserVitePreviewConfig, findUserViteConfig } from './vite-config-guard.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const VITE_CLI_CONFIG_WRAPPER_RELATIVE_PATH = '.rifty/vite-cli.config.mjs';
const VITE_CLI_KEEPALIVE_NEEDLE = 'this.runMatchedCommand();';
const VITE_CLI_KEEPALIVE_PATCH = `var __riftyAction = this.runMatchedCommand();
      if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.__riftyTrackCliPromise) {
        globalThis.__riftyTrackCliPromise(__riftyAction);
      }`;
const VITE_CLI_PREVIEW_NEEDLE = `configFile: options.config,
			configLoader: options.configLoader,
			logLevel: options.logLevel,
			mode: options.mode,
			build: { outDir: options.outDir },
			preview: {
				port: options.port,
				strictPort: options.strictPort,
				host: options.host,
				open: options.open
			}`;
const VITE_CLI_PREVIEW_PATCH = `configFile: false,
			configLoader: options.configLoader,
			logLevel: options.logLevel,
			mode: options.mode,
			build: { outDir: options.outDir },
			preview: {
				port: options.port,
				strictPort: options.strictPort,
				host: options.host,
				open: options.open,
				// Request dispatch hangs without it (same class as the dev wrapper's
				// server.allowedHosts force) — see mergeRiftyConfig.
				allowedHosts: true,
				// TODO(backlog: playground/vite-preview-cors-middleware-parity)
				cors: false
			}`;
const VITE_CLI_PREVIEW_PATCH_MARKER = 'configFile: false,';

export type ViteCliMode = 'dev' | 'build' | 'preview' | 'run';

export interface ViteCliPrepareOptions {
  /** Force `server.hmr: false` — Vite 8 keeps HMR off pending Rolldown socket parity (ADR-0161). */
  readonly hmrOff?: boolean;
  readonly userConfigPath?: string;
}

declare global {
  // Pins detached async CLI actions (Vite's bundled CAC parse() does not await them).
  // eslint-disable-next-line no-var
  var __riftyTrackCliPromise: ((promise: PromiseLike<unknown>) => void) | undefined;
}

// Env → CLI-prep decoding: the owner sets RIFTY_VITE_CLI_* on the child;
// node-entry-bootstrap threads proc.env through these (moved here for node
// testability — the bootstrap is a worker-only entry).
export function viteCliModeFromEnv(value: string | undefined): ViteCliMode | null {
  return value === 'dev' || value === 'build' || value === 'preview' || value === 'run'
    ? value
    : null;
}

export function viteCliPrepareOptionsFromEnv(
  env: Record<string, string | undefined>,
): ViteCliPrepareOptions {
  const userConfigPath = env.RIFTY_VITE_CLI_USER_CONFIG;
  return {
    // ADR-0161: Vite 8 templates pin server.hmr:false; stock HMR otherwise
    // (the generic preview bridge carries vite's own server.ws, ADR-0189).
    ...(env.RIFTY_VITE_CLI_HMR_OFF === '1' ? { hmrOff: true } : {}),
    ...(userConfigPath ? { userConfigPath } : {}),
  };
}

// NOT shadow-registry shims (those apply at install time, ADR-0188): these
// patch vite's OWN dist/node/cli.js for rifty's runtime lifecycle — the
// keepalive pin (CAC never awaits async actions) and the preview inline-config
// (executes only under `vite preview`; needle-guarded, loud on drift).
function installCliActionPatches(root: string, mode: ViteCliMode): void {
  globalThis.__riftyTrackCliPromise = (promise) => trackKeepalivePromise(promise);
  const fs = syncMirror();
  const path = normalizePath(`${root}/node_modules/vite/dist/node/cli.js`);
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
  if (mode === 'preview' && !source.includes(VITE_CLI_PREVIEW_PATCH_MARKER)) {
    if (!source.includes(VITE_CLI_PREVIEW_NEEDLE)) {
      throw new Error('vite CLI preview patch failed: preview inline config shape not found');
    }
    source = source.replace(VITE_CLI_PREVIEW_NEEDLE, VITE_CLI_PREVIEW_PATCH);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, enc.encode(source));
}

function wrapperConfigPath(root: string): string {
  return normalizePath(`${root}/${VITE_CLI_CONFIG_WRAPPER_RELATIVE_PATH}`);
}

function resolveProjectPath(root: string, path: string): string {
  return normalizePath(path.startsWith('/') ? path : `${root}/${path}`);
}

function relativeImportSpecifier(fromDir: string, targetPath: string): string {
  const fromParts = normalizePath(fromDir).split('/').filter(Boolean);
  const targetParts = normalizePath(targetPath).split('/').filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < targetParts.length) {
    if (fromParts[shared] !== targetParts[shared]) break;
    shared += 1;
  }
  const up = fromParts.slice(shared).map(() => '..');
  const down = targetParts.slice(shared);
  const rel = [...up, ...down].join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function wrapperSource(opts: {
  readonly userConfigPath: string | null;
  readonly wrapperDir: string;
  readonly hmrOff: boolean;
}): string {
  const userImport =
    opts.userConfigPath === null
      ? 'const __riftyUserConfig = {};'
      : `import __riftyUserConfig from ${JSON.stringify(
          relativeImportSpecifier(opts.wrapperDir, opts.userConfigPath),
        )};`;
  // Stock HMR (ADR-0189): the user's `server.hmr` flows through untouched —
  // the generic preview WS bridge carries vite's own server.ws. ADR-0161 pins
  // Vite 8 hmr:false until Rolldown socket parity is re-proven.
  const forcedHmr = opts.hmrOff ? 'hmr: false,' : '';
  return `${userImport}

function riftyViteServerHandlePlugin() {
  return {
    name: 'rifty:vite-server-handle',
    configureServer(server) {
      // Editor writes reach the CLI child as rifty:vite-file-change frames; the
      // VFS fires no watcher events, so invalidation needs the live server handle.
      globalThis.__riftyActiveViteServer = server;
    },
  };
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pluginArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function mergeRiftyConfig(userConfig) {
  const user = objectOrEmpty(userConfig);
  const userServer = objectOrEmpty(user.server);
  const userOptimizeDeps = objectOrEmpty(user.optimizeDeps);
  // Retired forces (each with its e2e proof, backlog net/preview-websocket-bridge):
  // base './' (SW port-context routes root-relative requests, ADR-0097),
  // appType 'spa' (vite's own default), server.strictPort (port-derived
  // lifecycle follows any port), server.host (the SW preview path stamps Host
  // localhost:<port>, ADR-0189 D3 — the generic fix any dev server benefits
  // from; fork e2e pins the Host). TWO forces remain:
  // - optimizeDeps.noDiscovery — dep discovery/prebundle needs a real bundling
  //   esbuild; re-tested 2026-07-02 with the force dropped: zero-config
  //   "npm i vite && npm run dev" lights LIVE but the optimizer breaks page
  //   serving (the WASI bridge shim loud-refuses entry-point contexts). Retire
  //   when real esbuild-wasm replaces the shim.
  // - server.allowedHosts — re-tested 2026-07-02 WITH Host localhost:<port>:
  //   guest vite request dispatch HANGS without allowedHosts:true (preview
  //   bridge timeout, not a 403 — vite's host-middleware path stalls under
  //   rifty net; root cause untraced). Keep forced until traced.
  return {
    ...user,
    optimizeDeps: {
      ...userOptimizeDeps,
      noDiscovery: true,
      include: Array.isArray(userOptimizeDeps.include) ? userOptimizeDeps.include : [],
    },
    server: {
      ...userServer,
      allowedHosts: userServer.allowedHosts ?? true,
      ${forcedHmr}
    },
    plugins: [...pluginArray(user.plugins), riftyViteServerHandlePlugin()],
  };
}

export default async function riftyViteCliConfig(env) {
  const user = typeof __riftyUserConfig === 'function'
    ? await __riftyUserConfig(env)
    : await __riftyUserConfig;
  return mergeRiftyConfig(user);
}
`;
}

function writeViteCliConfigWrapper(root: string, opts: ViteCliPrepareOptions): void {
  const fs = syncMirror();
  const wrapperPath = wrapperConfigPath(root);
  const userConfigPath =
    opts.userConfigPath !== undefined
      ? resolveProjectPath(root, opts.userConfigPath)
      : findUserViteConfig(root, (path) => path !== wrapperPath && fs.existsSync(path));
  fs.mkdirSync(dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    enc.encode(
      wrapperSource({
        userConfigPath,
        wrapperDir: dirname(wrapperPath),
        hmrOff: opts.hmrOff === true,
      }),
    ),
  );
}

export async function prepareViteCli(
  root: string,
  mode: ViteCliMode,
  opts: ViteCliPrepareOptions = {},
): Promise<void> {
  if (mode === 'preview') assertNoUserVitePreviewConfig(root, undefined, opts.userConfigPath);
  installCliActionPatches(root, mode);
  if (mode === 'dev') writeViteCliConfigWrapper(root, opts);
  if (mode === 'build' || mode === 'dev') installEsbuildTransformBridge(root);
}

// ——— vite CLI arg/env preparation (relocated from real-vite-bootstrap so the
// behavioral tests can import it in node vitest — the bootstrap module drags
// worker-only deps). Dies with the wrapper (backlog:
// net/preview-websocket-bridge acceptance 4).

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
  { names: ['optimize'], mode: 'run', booleans: ['--force'] },
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
  matched ??= {
    cmd: VITE_DEV_COMMAND,
    tokens: scanViteCliArgs(args, viteCliGrammar(VITE_DEV_COMMAND)),
  };
  const helpOrVersion = matched.tokens.some(
    (t) =>
      t.kind === 'flag' &&
      (t.flag === '--help' || t.flag === '-h' || t.flag === '--version' || t.flag === '-v'),
  );
  return { mode: helpOrVersion ? 'run' : matched.cmd.mode, tokens: matched.tokens };
}

export function viteCliMode(args: readonly string[]): ViteCliMode {
  return parseViteCliArgs(args).mode;
}

export function createPreviewScope(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`;
}

function isConfigFlag(t: ViteCliToken): t is Extract<ViteCliToken, { kind: 'flag' }> {
  return t.kind === 'flag' && (t.flag === '--config' || t.flag === '-c');
}

function viteConfigArg(args: readonly string[]): string | null {
  for (const t of parseViteCliArgs(args).tokens) {
    if (isConfigFlag(t)) return t.value;
  }
  return null;
}

function withoutViteConfigArgs(args: readonly string[]): string[] {
  return parseViteCliArgs(args)
    .tokens.filter((t) => !isConfigFlag(t))
    .flatMap((t) => [...t.raw]);
}

function resolveCliPath(cwd: string, path: string): string {
  return normalizePath(path.startsWith('/') ? path : `${cwd}/${path}`);
}

export function withViteCliArgs(
  binPath: string,
  args: readonly string[],
  ctx: CommandContext,
): string[] {
  if (binNameOf(binPath) !== 'vite') return [...args];
  const mode = viteCliMode(args);
  // No preview-mode '--host': the SW preview path stamps Host localhost:<port>
  // (ADR-0189 D3), which vite's default allowedHosts accepts.
  if (mode !== 'dev') return [...args];
  return [
    ...withoutViteConfigArgs(args),
    '--config',
    normalizePath(`${ctx.cwd}/${VITE_CLI_CONFIG_WRAPPER_RELATIVE_PATH}`),
  ];
}

export function withViteCliEnv(
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
