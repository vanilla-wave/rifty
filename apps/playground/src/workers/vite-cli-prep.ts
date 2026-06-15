import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import { trackKeepalivePromise } from '@riftydev/runtime-js';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import { viteBrowserShimFiles, viteBuildShimFiles } from '../glue/esbuild-shim.ts';
import { viteHmrClientScript } from '../glue/hmr-bridge.ts';
import { installEsbuildTransformBridge } from './esbuild-wasi-transform.ts';
import { findUserViteConfig } from './vite-config-guard.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SHIM_ROOT_PREFIX = '/workspace';
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
				allowedHosts: true,
				// TODO(backlog: playground/vite-preview-cors-middleware-parity)
				cors: false
			}`;
const VITE_CLI_PREVIEW_PATCH_MARKER = 'configFile: false,';

export type ViteCliMode = 'dev' | 'build' | 'preview' | 'run';

export interface ViteCliPrepareOptions {
  readonly hmr?: {
    readonly enabled: boolean;
    readonly port: number;
  };
  readonly userConfigPath?: string;
}

declare global {
  // Pins detached async CLI actions (Vite's bundled CAC parse() does not await them).
  // eslint-disable-next-line no-var
  var __riftyTrackCliPromise: ((promise: PromiseLike<unknown>) => void) | undefined;
}

function reRootShimPath(shimPath: string, root: string): string {
  return shimPath.startsWith(`${SHIM_ROOT_PREFIX}/`)
    ? `${root}${shimPath.slice(SHIM_ROOT_PREFIX.length)}`
    : shimPath;
}

function overlayShims(root: string, mode: ViteCliMode): void {
  const fs = syncMirror();
  const files = mode === 'build' || mode === 'dev' ? viteBuildShimFiles : viteBrowserShimFiles;
  for (const [path, content] of Object.entries(files)) {
    const np = normalizePath(reRootShimPath(path, root));
    fs.mkdirSync(dirname(np), { recursive: true });
    fs.writeFileSync(np, enc.encode(content));
  }
}

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

function pluginSource(port: number, token: string): string {
  const script = viteHmrClientScript(port, token);
  return `function riftyHmrBridgePlugin() {
  const marker = 'data-rifty-hmr-bridge';
  const script = ${JSON.stringify(script)};
  return {
    name: 'rifty:hmr-bridge',
    configureServer(server) {
      globalThis.__riftyActiveViteServer = server;
    },
    transformIndexHtml(html) {
      if (html.includes(marker)) return html;
      return {
        html,
        tags: [{ tag: 'script', attrs: { [marker]: '' }, children: script, injectTo: 'head-prepend' }],
      };
    },
  };
}`;
}

function wrapperSource(opts: {
  readonly userConfigPath: string | null;
  readonly wrapperDir: string;
  readonly hmrEnabled: boolean;
  readonly port: number;
  readonly token: string;
}): string {
  const userImport =
    opts.userConfigPath === null
      ? 'const __riftyUserConfig = {};'
      : `import __riftyUserConfig from ${JSON.stringify(
          relativeImportSpecifier(opts.wrapperDir, opts.userConfigPath),
        )};`;
  const hmrConfig = opts.hmrEnabled
    ? `{
        protocol: 'ws',
        host: ${JSON.stringify(PREVIEW_LOCAL_HOST)},
        clientPort: ${opts.port},
        path: ${JSON.stringify(`__hmr/${encodeURIComponent(opts.token)}`)},
      }`
    : 'false';
  const plugins = opts.hmrEnabled ? '[riftyHmrBridgePlugin()]' : '[]';
  const mergedHmr = opts.hmrEnabled
    ? `userHmr === false ? false : { ...${hmrConfig}, ...objectOrEmpty(userHmr) }`
    : 'false';
  return `${userImport}

${pluginSource(opts.port, opts.token)}

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
  const userHmr = userServer.hmr;
  return {
    ...user,
    base: user.base ?? './',
    appType: user.appType ?? 'spa',
    optimizeDeps: {
      ...userOptimizeDeps,
      noDiscovery: true,
      include: Array.isArray(userOptimizeDeps.include) ? userOptimizeDeps.include : [],
    },
    server: {
      ...userServer,
      strictPort: userServer.strictPort ?? true,
      host: userServer.host ?? true,
      allowedHosts: userServer.allowedHosts ?? true,
      hmr: ${mergedHmr},
    },
    plugins: [...pluginArray(user.plugins), ...${plugins}],
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
        hmrEnabled: opts.hmr?.enabled ?? false,
        port: opts.hmr?.port ?? 5173,
        token: globalThis.crypto?.randomUUID?.() ?? `hmr-${Date.now().toString(36)}`,
      }),
    ),
  );
}

export async function prepareViteCli(
  root: string,
  mode: ViteCliMode,
  opts: ViteCliPrepareOptions = {},
): Promise<void> {
  installCliActionPatches(root, mode);
  overlayShims(root, mode);
  if (mode === 'dev') writeViteCliConfigWrapper(root, opts);
  if (mode === 'build' || mode === 'dev') installEsbuildTransformBridge(root);
}
