import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createHmrBridgeToken, hmrBridgeUrl } from '../../apps/playground/src/glue/hmr-bridge.ts';
import { PREVIEW_LOCAL_HOST } from '../../packages/io/src/index.ts';
import { createServer as createHttpServer } from '../../packages/net/src/http/server.ts';
import { BridgedWebSocket } from '../../packages/net/src/ws/bridge.ts';
import { webSocketBridgeClientScript } from '../../packages/net/src/ws/browser-client-script.ts';

interface ViteModule {
  createServer(config: ViteInlineConfig): Promise<ViteDevServer>;
}

interface ViteInlineConfig {
  root: string;
  base: string;
  logLevel: 'silent';
  server: {
    port: number;
    strictPort: boolean;
    hmr: {
      protocol?: 'ws';
      host?: string;
      clientPort?: number;
      path?: string;
      server: unknown;
    };
    host: string;
    allowedHosts: true;
    watch: { ignored: string[] };
  };
  appType: 'spa';
  clearScreen: false;
  optimizeDeps: { disabled: true };
}

interface ViteDevServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
  transformRequest(url: string): Promise<unknown>;
  watcher: {
    emit(event: 'change', file: string): boolean;
  };
}

interface HmrPayload {
  readonly type?: string;
  readonly updates?: readonly {
    readonly type?: string;
    readonly path?: string;
    readonly acceptedPath?: string;
  }[];
}

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('real Vite HMR over rifty HTTP WebSocket upgrade', () => {
  it('sends Vite-generated js-update payloads over Vite native server.ws', async () => {
    const vite = await loadPlaygroundVite();
    const root = await mkdtemp(join(await realpath(tmpdir()), 'rifty-vite-hmr-'));
    tmpRoots.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    const entry = join(root, 'src/main.js');
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><script type="module" src="/src/main.js"></script>',
      'utf8',
    );
    await writeFile(entry, selfAcceptingModule('one'), 'utf8');

    const port = await getEphemeralPort();
    const token = createHmrBridgeToken();
    const hmrHttpServer = createHttpServer();
    await new Promise<void>((resolve) => hmrHttpServer.listen({ port }, () => resolve()));
    const seen: HmrPayload[] = [];
    let client: BridgedWebSocket | null = null;
    let server: ViteDevServer | null = null;

    try {
      server = await vite.createServer({
        root,
        base: './',
        logLevel: 'silent',
        server: {
          port,
          strictPort: true,
          hmr: {
            protocol: 'ws',
            host: PREVIEW_LOCAL_HOST,
            clientPort: port,
            path: `__hmr/${encodeURIComponent(token)}`,
            server: hmrHttpServer,
          },
          host: '127.0.0.1',
          allowedHosts: true,
          watch: { ignored: ['**/node_modules/**'] },
        },
        appType: 'spa',
        clearScreen: false,
        optimizeDeps: { disabled: true },
      });
      await server.listen();

      client = new BridgedWebSocket(hmrBridgeUrl(port, token), {
        connectTimeoutMs: 250,
        protocols: 'vite-hmr',
      });
      client.addEventListener('message', (e) => {
        seen.push(JSON.parse(String((e as MessageEvent).data)) as HmrPayload);
      });
      await new Promise<void>((resolve) =>
        client?.addEventListener('open', () => resolve(), { once: true }),
      );
      await waitForPayload(seen, (payload) => payload.type === 'connected', 'connected');

      await server.transformRequest('/src/main.js');
      await writeFile(entry, selfAcceptingModule('two'), 'utf8');
      server.watcher.emit('change', entry);

      const update = await waitForPayload(
        seen,
        (payload) => payload.type === 'update',
        'Vite update payload',
      );
      expect(update.updates).toEqual([
        expect.objectContaining({
          type: 'js-update',
          path: '/src/main.js',
          acceptedPath: '/src/main.js',
        }),
      ]);
      expect(seen.some((payload) => payload.type === 'full-reload')).toBe(false);
    } finally {
      client?.close();
      await server?.close();
      hmrHttpServer.close();
    }
  });

  it('stock hmr config: the injected preview client reaches native server.ws on the default path (ADR-0189)', async () => {
    // The browser-flow shape with NO wrapper rewrite: vite keeps its default
    // hmr path (base '/') and the client is the generic injected
    // `window.WebSocket` patch — it aims at the HOST PAGE origin (foreign
    // port) like a stock `@vite/client` and remaps discovery to the guest
    // port from the /preview/<port>/ prefix. `hmr.server` only pins vite's ws
    // to the rifty HttpServer (in the browser require('node:http') IS rifty;
    // this Node test must opt in).
    const vite = await loadPlaygroundVite();
    const root = await mkdtemp(join(await realpath(tmpdir()), 'rifty-vite-stock-hmr-'));
    tmpRoots.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    const entry = join(root, 'src/main.js');
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><script type="module" src="/src/main.js"></script>',
      'utf8',
    );
    await writeFile(entry, selfAcceptingModule('one'), 'utf8');

    const port = await getEphemeralPort();
    const hmrHttpServer = createHttpServer();
    hmrHttpServer.listen({ port });
    const seen: HmrPayload[] = [];
    let server: ViteDevServer | null = null;
    const restoreWindow = installPreviewWindow(port);
    let client: PreviewWindowWebSocket | null = null;

    try {
      server = await vite.createServer({
        root,
        base: './',
        logLevel: 'silent',
        server: {
          port,
          strictPort: true,
          hmr: { server: hmrHttpServer },
          host: '127.0.0.1',
          allowedHosts: true,
          watch: { ignored: ['**/node_modules/**'] },
        },
        appType: 'spa',
        clearScreen: false,
        optimizeDeps: { disabled: true },
      });
      await server.listen();

      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      // eslint-disable-next-line no-new-func
      new Function(script)();
      const PreviewWebSocket = (
        globalThis as unknown as {
          window: { WebSocket: new (url: string, protocols?: string) => PreviewWindowWebSocket };
        }
      ).window.WebSocket;
      // Stock @vite/client shape: `${location.hostname}:${location.port}${base}`.
      client = new PreviewWebSocket('ws://localhost:5273/', 'vite-hmr');
      client.addEventListener('message', (e) => {
        seen.push(JSON.parse(String((e as MessageEvent).data)) as HmrPayload);
      });
      await new Promise<void>((resolve, reject) => {
        client?.addEventListener('open', () => resolve(), { once: true });
        client?.addEventListener(
          'close',
          () => reject(new Error('stock hmr bridge connection refused')),
          { once: true },
        );
      });
      await waitForPayload(seen, (payload) => payload.type === 'connected', 'connected');

      await server.transformRequest('/src/main.js');
      await writeFile(entry, selfAcceptingModule('two'), 'utf8');
      server.watcher.emit('change', entry);

      const update = await waitForPayload(
        seen,
        (payload) => payload.type === 'update',
        'Vite update payload',
      );
      expect(update.updates).toEqual([
        expect.objectContaining({
          type: 'js-update',
          path: '/src/main.js',
          acceptedPath: '/src/main.js',
        }),
      ]);
    } finally {
      client?.close();
      await server?.close();
      hmrHttpServer.close();
      restoreWindow();
    }
  });
});

interface PreviewWindowWebSocket extends EventTarget {
  close(): void;
}

/** Minimal preview-iframe `window` for the injected bridge script (Node realm). */
function installPreviewWindow(guestPort: number): () => void {
  const globalWithWindow = globalThis as unknown as { window: unknown };
  const previous = globalWithWindow.window;
  const events = new EventTarget();
  globalWithWindow.window = {
    location: {
      href: `http://localhost:5273/preview/${guestPort}/`,
      hostname: 'localhost',
      pathname: `/preview/${guestPort}/`,
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  return () => {
    globalWithWindow.window = previous;
  };
}

async function loadPlaygroundVite(): Promise<ViteModule> {
  const playgroundRequire = createRequire(
    fileURLToPath(new URL('../../apps/playground/package.json', import.meta.url)),
  );
  const viteEntry = playgroundRequire.resolve('vite');
  const viteNs = (await import(pathToFileURL(viteEntry).href)) as unknown;
  return viteNs as ViteModule;
}

async function getEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (typeof address === 'object' && address !== null) {
          resolve(address.port);
          return;
        }
        reject(new Error(`Unexpected TCP address: ${String(address)}`));
      });
    });
  });
}

function selfAcceptingModule(value: string): string {
  return [
    `export const marker = ${JSON.stringify(value)};`,
    'if (import.meta.hot) import.meta.hot.accept();',
    '',
  ].join('\n');
}

async function waitForPayload(
  payloads: readonly HmrPayload[],
  predicate: (payload: HmrPayload) => boolean,
  label: string,
): Promise<HmrPayload> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const found = payloads.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}. Seen: ${JSON.stringify(payloads)}`);
}
