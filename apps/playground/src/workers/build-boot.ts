import { dispatchToPort, serveCrossRealmPreview } from '@riftydev/net';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { installEsbuildBridge } from './esbuild-host.ts';
import { assertNoUserViteConfig } from './vite-config-guard.ts';

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

// No shim glue here (ADR-0188): internals shims are applied at install time.

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
  assertNoUserViteConfig(root);
  installEsbuildBridge();
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
  readonly previewScope?: string;
  readonly log: (chunk: string) => void;
}): Promise<{ readonly port: number; stop(): Promise<void> }> {
  const { root, port, previewScope, log } = opts;
  assertNoUserViteConfig(root);
  assertBuiltDist(root);
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
    // TODO(backlog: playground/vite-curated-boot-residual-forces): align or
    // delete this curated preview path; shell/.bin `vite preview` keeps user
    // host/strictPort options instead of forcing them here.
    preview: { port, strictPort: true, host: true },
  });
  const tearPreviewBridge = serveCrossRealmPreview(
    port,
    async (request) => dispatchToPort(port, request),
    previewScope === undefined ? {} : { scope: previewScope },
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
