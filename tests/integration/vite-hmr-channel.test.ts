import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import { BridgedWebSocket } from '@riftydev/net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHmrBridgeToken,
  createViteHmrBridgeChannel,
  hmrBridgeUrl,
} from '../../packages/workbench/src/hmr-bridge.ts';

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
      protocol: 'ws';
      host: string;
      clientPort: number;
      path: string;
      channels: unknown[];
    };
    ws: false;
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

describe('real Vite HMR channel integration', () => {
  it('sends Vite-generated js-update payloads over createViteHmrBridgeChannel', async () => {
    const vite = await loadPlaygroundVite();
    const root = await mkdtemp(join(tmpdir(), 'rifty-vite-hmr-'));
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
    const channel = createViteHmrBridgeChannel({ port, token });
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
            channels: [channel],
          },
          ws: false,
          host: '127.0.0.1',
          allowedHosts: true,
          watch: { ignored: ['**/node_modules/**'] },
        },
        appType: 'spa',
        clearScreen: false,
        optimizeDeps: { disabled: true },
      });
      await server.listen();

      client = new BridgedWebSocket(hmrBridgeUrl(port, token), { connectTimeoutMs: 250 });
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
    }
  });
});

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
