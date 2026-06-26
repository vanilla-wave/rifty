import { dispatchToPort, serveCrossRealmPreview } from '@riftydev/net';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { runWasi } from '@riftydev/runtime-wasi';
import { transformWithEsbuild } from '@riftydev/shadow-registry/esbuild-transform';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import esbuildWasmUrl from '../../../../tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm?url';
import { viteBuildShimFiles } from '../glue/esbuild-shim.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

type Loader = ReturnType<typeof createModuleLoader>;

interface ViteUserConfig {
  root?: string;
  base?: string;
  configFile?: false;
  clearScreen?: boolean;
  logLevel?: 'info' | 'warn' | 'error' | 'silent';
  build?: {
    outDir?: string;
    emptyOutDir?: boolean;
  };
  preview?: {
    port?: number;
    strictPort?: boolean;
    host?: boolean;
  };
}

interface VitePreviewServer {
  httpServer?: { close(cb?: (err?: Error) => void): void };
}

interface EsbuildBridgeOptions {
  readonly loader?: string;
  readonly jsx?: string;
  readonly format?: string;
  readonly target?: string | readonly string[];
  readonly minify?: boolean;
  readonly sourcemap?: boolean | string;
}

declare global {
  // Injected for the overlaid node_modules/esbuild/lib/main.js build shim.
  // eslint-disable-next-line no-var
  var __riftyEsbuildTransform:
    | ((
        source: string,
        options: EsbuildBridgeOptions,
      ) => Promise<{
        code: string;
        map?: string;
        warnings: string[];
      }>)
    | undefined;
}

const SHIM_ROOT_PREFIX = '/workspace';

export function reRootBuildShimPath(shimPath: string, root: string): string {
  return shimPath.startsWith(`${SHIM_ROOT_PREFIX}/`)
    ? `${root}${shimPath.slice(SHIM_ROOT_PREFIX.length)}`
    : shimPath;
}

function overlayBuildShims(root: string): void {
  const fs = syncMirror();
  for (const [path, content] of Object.entries(viteBuildShimFiles)) {
    const np = normalizePath(reRootBuildShimPath(path, root));
    fs.mkdirSync(dirname(np), { recursive: true });
    fs.writeFileSync(np, enc.encode(content));
  }
}

function installCreateRequire(loader: Loader, root: string): void {
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
  globalThis.process.env.PWD = root;
}

function loaderFor(v: string | undefined): 'js' | 'jsx' | 'ts' | 'tsx' {
  return v === 'jsx' || v === 'ts' || v === 'tsx' ? v : 'js';
}

function formatFor(v: string | undefined): 'esm' | 'cjs' | 'iife' | undefined {
  return v === 'cjs' || v === 'iife' || v === 'esm' ? v : undefined;
}

function sourcemapFor(v: boolean | string | undefined): 'inline' | 'external' | undefined {
  if (v === 'inline') return 'inline';
  if (v === true || v === 'external' || v === 'both') return 'external';
  return undefined;
}

function targetFor(v: string | readonly string[] | undefined): string | undefined {
  if (typeof v === 'string') return v;
  return Array.isArray(v) ? v.join(',') : undefined;
}

async function installEsbuildBridge(root: string): Promise<void> {
  const response = await fetch(esbuildWasmUrl);
  if (!response.ok) {
    throw new Error(`esbuild WASI binary fetch failed: HTTP ${response.status}`);
  }
  const wasm = await response.arrayBuffer();
  globalThis.__riftyEsbuildTransform = async (source, options) =>
    transformWithEsbuild(runWasi, wasm, {
      source,
      workspace: root,
      loader: loaderFor(options.loader),
      jsx:
        options.jsx === 'transform' || options.jsx === 'preserve' || options.jsx === 'automatic'
          ? options.jsx
          : undefined,
      format: formatFor(options.format),
      target: targetFor(options.target),
      minify: options.minify,
      sourcemap: sourcemapFor(options.sourcemap),
    });
}

export async function flushSyncMirror(): Promise<void> {
  const mirror = syncMirror() as { flush?: () => Promise<void> };
  if (typeof mirror.flush === 'function') await mirror.flush();
}

function assertBuiltDist(root: string): void {
  const fs = syncMirror();
  const indexPath = normalizePath(`${root}/dist/index.html`);
  if (!fs.existsSync(indexPath)) {
    throw new Error('vite build completed but dist/index.html is missing');
  }
  const html = dec.decode(fs.readFileBytesSync(indexPath));
  if (!html.includes('assets/')) {
    throw new Error('vite build completed but dist/index.html does not reference built assets');
  }
  if (html.includes('.assets/')) {
    throw new Error('vite build completed but dist/index.html references malformed .assets/ paths');
  }
}

export async function bootBuild(opts: {
  readonly root: string;
  readonly log: (chunk: string) => void;
}): Promise<void> {
  const { root, log } = opts;
  overlayBuildShims(root);
  await installEsbuildBridge(root);
  const loader = createModuleLoader(syncMirror(), { cwd: root });
  installCreateRequire(loader, root);

  log('[vite] production build starting\n');
  const viteNs = (await loader.import('vite', `${root}/__build__.mjs`)) as {
    build: (config: ViteUserConfig) => Promise<unknown>;
  };
  await viteNs.build({
    root,
    base: '/',
    configFile: false,
    clearScreen: false,
    logLevel: 'info',
    build: { outDir: 'dist', emptyOutDir: true },
  });
  assertBuiltDist(root);
  await flushSyncMirror();
  log('[vite] production build complete\n');
}

export async function bootPreview(opts: {
  readonly root: string;
  readonly port: number;
  readonly log: (chunk: string) => void;
}): Promise<{ readonly port: number; stop(): Promise<void> }> {
  const { root, port, log } = opts;
  assertBuiltDist(root);
  overlayBuildShims(root);
  const loader = createModuleLoader(syncMirror(), { cwd: root });
  installCreateRequire(loader, root);

  log(`[vite] preview starting on port ${port}\n`);
  const viteNs = (await loader.import('vite', `${root}/__preview__.mjs`)) as {
    preview: (config: ViteUserConfig) => Promise<VitePreviewServer>;
  };
  const server = await viteNs.preview({
    root,
    base: '/',
    configFile: false,
    clearScreen: false,
    logLevel: 'info',
    preview: { port, strictPort: true, host: true },
  });
  const tearPreviewBridge = serveCrossRealmPreview(port, async (request) =>
    dispatchToPort(port, request),
  );
  log(`[vite] preview ready on port ${port}\n`);
  return {
    port,
    async stop() {
      tearPreviewBridge();
      await new Promise<void>((resolve) => {
        if (!server.httpServer) {
          resolve();
          return;
        }
        server.httpServer.close(() => resolve());
      });
    },
  };
}
