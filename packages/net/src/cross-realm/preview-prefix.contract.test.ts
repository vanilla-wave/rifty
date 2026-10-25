import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../http/server.ts';
import {
  type WebSocketBridgeClientScriptOptions,
  webSocketBridgeClientScript,
} from '../ws/browser-client-script.ts';
import { channelNameFor, portChannelNameForPort } from '../ws/channel.ts';
import { injectPreviewWebSocketBridge } from './preview-html-inject.ts';
import {
  bridgeCrossRealmPreview,
  previewPortChannelUrl,
  serveCrossRealmPreview,
} from './preview-port.ts';

// Preparation: pass the proposed additive options to the actual implementations.
// No substitute renderer, transport, server or acknowledgement peer.
type PrefixScriptOptions = WebSocketBridgeClientScriptOptions & { readonly previewPrefix?: string };
const injectWithPrefix = injectPreviewWebSocketBridge as (
  html: string,
  previewPrefix?: string,
) => string;

interface RealWsConnection {
  on(event: 'message', listener: (data: unknown) => void): void;
  send(data: string): void;
  terminate(): void;
}
interface RealWsServer {
  on(
    event: 'connection',
    listener: (socket: RealWsConnection, request: { url: string }) => void,
  ): void;
  close(): void;
}
const { WebSocketServer } = createRequire(import.meta.url)('ws') as {
  WebSocketServer: new (options: { server: unknown; path: string }) => RealWsServer;
};

interface BrowserSocket extends EventTarget {
  readonly protocol: string;
  send(data: string): void;
  close(): void;
}

interface BrowserWindow {
  WebSocket: new (url: string, protocols?: string | string[]) => BrowserSocket;
  location: URL;
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
  dispatchEvent: EventTarget['dispatchEvent'];
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
});

function installBrowser(href: string, script: string) {
  const nativeCalls: { url: string; protocols?: string | string[] }[] = [];
  // Native browser egress is the only WebSocket double; rifty's peer is real.
  class NativeSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly protocol = '';
    constructor(url: string, protocols?: string | string[]) {
      super();
      nativeCalls.push({ url, protocols });
    }
    send(): void {}
    close(): void {}
  }
  const globals = globalThis as unknown as { window: BrowserWindow | undefined };
  const previous = globals.window;
  const events = new EventTarget();
  const win: BrowserWindow = {
    WebSocket: NativeSocket,
    location: new URL(href),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  globals.window = win;
  cleanups.push(() => {
    globals.window = previous;
  });
  new Function(script)();
  return { win, nativeCalls, NativeSocket };
}

function observe(channelName: string, type: string): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  const channel = new BroadcastChannel(channelName);
  channel.addEventListener('message', (event) => {
    const frame: unknown = event.data;
    if (typeof frame === 'object' && frame !== null && Reflect.get(frame, 'type') === type) {
      frames.push(frame as Record<string, unknown>);
    }
  });
  cleanups.push(() => channel.close());
  return frames;
}

function injectedScript(html: string): string {
  const match = /<script data-rifty-ws-bridge>([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

async function assertGuestSocket(opts: {
  script: string;
  page: string;
  port: number;
  input: string;
  guestPath: string;
}): Promise<void> {
  const expected = new URL(opts.guestPath, 'ws://guest.local');
  const httpServer = createServer();
  cleanups.push(() => httpServer.close());
  const server = new WebSocketServer({ server: httpServer, path: expected.pathname });
  cleanups.push(() => server.close());
  const received: string[] = [];
  const upgradePaths: string[] = [];
  server.on('connection', (socket, request) => {
    cleanups.push(() => socket.terminate());
    upgradePaths.push(request.url);
    socket.on('message', (data: unknown) => {
      received.push(String(data));
      socket.send(`echo:${String(data)}`);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen({ port: opts.port }, resolve));
  const opens = observe(portChannelNameForPort(opts.port), 'open');
  const { win, nativeCalls, NativeSocket } = installBrowser(opts.page, opts.script);
  const socket = new win.WebSocket(opts.input, 'vite-hmr');
  cleanups.push(() => socket.close());
  // Wrong prefix must fail here, not hang waiting for an absent native server.
  expect(socket).not.toBeInstanceOf(NativeSocket);
  expect(nativeCalls).toEqual([]);
  let opened = false;
  const replies: string[] = [];
  socket.addEventListener('open', () => {
    opened = true;
  });
  socket.addEventListener('message', (event) => {
    replies.push(String((event as MessageEvent).data));
  });
  await vi.waitFor(() => expect(opened).toBe(true));
  expect(socket.protocol).toBe('vite-hmr');
  socket.send('hmr-update');
  await vi.waitFor(() => expect(replies).toEqual(['echo:hmr-update']));
  expect(received).toEqual(['hmr-update']);
  expect(upgradePaths).toEqual([expected.pathname + expected.search]);
  expect(opens).toHaveLength(1);
  const guestUrl = new URL(String(opens[0]?.url));
  expect(guestUrl.pathname + guestUrl.search).toBe(expected.pathname + expected.search);
}

describe('configured preview prefix — real generated WebSocket client', () => {
  it.each([
    {
      port: 19301,
      prefix: '/sandbox/p/',
      document: '',
      input: 'socket?token=a%2Fb',
      path: '/socket?token=a%2Fb',
    },
    {
      port: 19302,
      prefix: '/sandbox/p/',
      document: '',
      input: '/api/socket?token=b',
      path: '/api/socket?token=b',
    },
    {
      port: 19303,
      prefix: '/sandbox/p/',
      document: 'nested/page',
      input: '../socket?token=c',
      path: '/socket?token=c',
    },
    {
      port: 19304,
      prefix: '/sandbox/p/',
      document: '',
      input: 'ws://localhost:5173/api/socket?token=d',
      path: '/api/socket?token=d',
    },
    {
      port: 19305,
      prefix: '/sandbox/p.+/',
      document: '',
      input: 'socket?token=e',
      path: '/socket?token=e',
    },
  ])(
    'routes $input under literal $prefix to guest port $port',
    async ({ port, prefix, document, input, path }) => {
      const options: PrefixScriptOptions = { previewPortFromPath: true, previewPrefix: prefix };
      await assertGuestSocket({
        script: webSocketBridgeClientScript(options),
        page: `http://preview.local:8080${prefix}${port}/${document}`,
        port,
        input,
        guestPath: path,
      });
    },
  );

  it('keeps the original /preview/ default with real guest exchange', async () => {
    await assertGuestSocket({
      script: webSocketBridgeClientScript({ previewPortFromPath: true }),
      page: 'http://preview.local:8080/preview/19306/',
      port: 19306,
      input: 'socket?default=1',
      guestPath: '/socket?default=1',
    });
  });

  it.each([
    {
      page: 'http://preview.local:8080/sandbox/p.+/19307/',
      input: 'wss://external.example/socket?q=1',
    },
    { page: 'http://preview.local:8080/sandbox/pXX/19307/', input: '/socket?q=2' },
  ])('keeps native egress for $input at $page', ({ page, input }) => {
    const options: PrefixScriptOptions = {
      previewPortFromPath: true,
      previewPrefix: '/sandbox/p.+/',
    };
    const { win, nativeCalls, NativeSocket } = installBrowser(
      page,
      webSocketBridgeClientScript(options),
    );
    const socket = new win.WebSocket(input, ['external-protocol']);
    expect(socket).toBeInstanceOf(NativeSocket);
    expect(nativeCalls).toEqual([{ url: input, protocols: ['external-protocol'] }]);
  });
});

describe('configured preview prefix — HTML injection and real preview transport', () => {
  const html =
    '<!doctype html><html><head><script type="module" src="/src/main.js"></script></head><body>app</body></html>';

  it('injected default HTML script exchanges real guest WebSocket traffic', async () => {
    await assertGuestSocket({
      script: injectedScript(injectPreviewWebSocketBridge(html)),
      page: 'http://preview.local:8080/preview/19312/',
      port: 19312,
      input: 'socket?defaultHtml=1',
      guestPath: '/socket?defaultHtml=1',
    });
  });

  it('does not reuse a default or earlier prefix script for a later deployment', async () => {
    injectWithPrefix(html);
    const first = injectWithPrefix(html, '/sandbox/first/');
    const second = injectWithPrefix(html, '/sandbox/p/');
    expect(injectWithPrefix(second, '/sandbox/p/')).toBe(second);
    expect(second).toContain('<script type="module" src="/src/main.js"></script>');
    await assertGuestSocket({
      script: injectedScript(first),
      page: 'http://preview.local:8080/sandbox/first/19308/',
      port: 19308,
      input: 'socket',
      guestPath: '/socket',
    });
    await assertGuestSocket({
      script: injectedScript(second),
      page: 'http://preview.local:8080/sandbox/p/19309/',
      port: 19309,
      input: 'socket',
      guestPath: '/socket',
    });
  });

  it.each(['Request', 'dispatchStruct'] as const)(
    'carries prefix metadata via %s without changing guest URL or headers',
    async (entrypoint) => {
      const port = entrypoint === 'Request' ? 19310 : 19311;
      const previewPrefix = '/sandbox/p/';
      const scope = `prefix-contract-${entrypoint}`;
      const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
      let staleDispatches = 0;
      cleanups.push(
        serveCrossRealmPreview(
          port,
          async () => {
            staleDispatches++;
            return new Response('stale');
          },
          { scope: `${scope}-old` },
        ),
      );
      cleanups.push(
        serveCrossRealmPreview(
          port,
          async (request) => {
            requests.push({
              url: request.url,
              headers: Object.fromEntries(request.headers),
              body: await request.text(),
            });
            const compressed = await new Response(
              new Blob([html]).stream().pipeThrough(new CompressionStream('gzip')),
            ).arrayBuffer();
            return new Response(compressed, {
              status: 201,
              headers: {
                'content-type': 'text/html; charset=utf-8',
                'content-encoding': 'gzip',
                'content-length': String(compressed.byteLength),
                'x-guest-response': 'preserved',
              },
            });
          },
          { scope },
        ),
      );
      const frames = observe(channelNameFor(previewPortChannelUrl(port)), 'request');
      const options = { scope, previewPrefix };
      const bridge = bridgeCrossRealmPreview(port, options);
      cleanups.push(bridge.dispose);
      const url = `http://localhost:${port}/nested/page?keep=a%2Fb`;
      const headers = { 'x-guest-request': 'preserved' };
      const payload = new TextEncoder().encode('guest-body');
      const response =
        entrypoint === 'Request'
          ? await bridge(new Request(url, { method: 'POST', headers, body: payload }))
          : await bridge.dispatchStruct({ url, method: 'POST', headers, body: [payload] });
      const body = await response.text();
      expect(requests).toEqual([{ url, headers, body: 'guest-body' }]);
      expect(staleDispatches).toBe(0);
      expect(response.status).toBe(201);
      expect(response.headers.get('x-guest-response')).toBe('preserved');
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(Number(response.headers.get('content-length'))).toBe(
        new TextEncoder().encode(body).byteLength,
      );
      expect(body).toContain('<script type="module" src="/src/main.js"></script>');
      expect(injectWithPrefix(body, previewPrefix)).toBe(body);
      await vi.waitFor(() => expect(frames).toHaveLength(1));
      expect(frames[0]).toMatchObject({ v: '2', scope, previewPrefix, url, headers });
      await assertGuestSocket({
        script: injectedScript(body),
        page: `http://preview.local:8080${previewPrefix}${port}/`,
        port,
        input: '/api/socket?token=unchanged',
        guestPath: '/api/socket?token=unchanged',
      });
    },
  );
});
