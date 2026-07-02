import { trackKeepalivePromise } from '@riftydev/runtime-js';
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
