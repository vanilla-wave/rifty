import { describe, expect, it } from 'vitest';
import { webSocketBridgeClientScript } from './browser-client-script.ts';
import { channelNameFor, portChannelNameFor, portChannelNameForPort } from './channel.ts';
import { WebSocketServer } from './in-process.ts';

interface BrowserWindowLike {
  WebSocket?: unknown;
  location: { href: string; hostname: string; pathname: string };
  __riftyWebSocketBridgeInstalled?: boolean;
  __riftyHmrOpen?: boolean;
  __riftyHmrLastMessage?: unknown;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

interface BrowserWebSocketLike extends EventTarget {
  readonly OPEN: number;
  readonly protocol: string;
  binaryType: BinaryType;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

interface BrowserWebSocketConstructor {
  readonly OPEN: number;
  new (url: string, protocols?: string | string[]): BrowserWebSocketLike;
}

interface ServerSocketLike {
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

function installWindow(
  opts: { hostname?: string; pathname?: string; nativeWebSocket?: unknown } = {},
): {
  readonly win: BrowserWindowLike;
  readonly restore: () => void;
} {
  const globalWithWindow = globalThis as unknown as { window: BrowserWindowLike | undefined };
  const previousWindow = globalWithWindow.window;
  const events = new EventTarget();
  const hostname = opts.hostname ?? 'preview.local';
  const pathname = opts.pathname ?? '/';
  const win: BrowserWindowLike = {
    WebSocket: opts.nativeWebSocket,
    location: { href: `http://${hostname}:5174${pathname}`, hostname, pathname },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  globalWithWindow.window = win;
  return {
    win,
    restore(): void {
      if (previousWindow === undefined) {
        globalWithWindow.window = undefined;
        return;
      }
      globalWithWindow.window = previousWindow;
    },
  };
}

describe('webSocketBridgeClientScript', () => {
  it('falls through to native WebSocket for unconfigured same-page hosts', () => {
    const constructed: Array<{ url: string; protocols?: string | string[] }> = [];
    class NativeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly readyState = NativeWebSocket.CONNECTING;

      constructor(url: string, protocols?: string | string[]) {
        super();
        constructed.push({ url, protocols });
      }

      send(): void {}
      close(): void {}
    }
    const { win, restore } = installWindow({
      hostname: 'app.local',
      nativeWebSocket: NativeWebSocket,
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://app.local:9020/app-socket', 'app-protocol');

      expect(ws).toBeInstanceOf(NativeWebSocket);
      expect(constructed).toEqual([
        { url: 'ws://app.local:9020/app-socket', protocols: 'app-protocol' },
      ]);
    } finally {
      restore();
    }
  });

  it('bridges browser new WebSocket() to the ordinary WebSocketServer surface', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9020, path: '/hmr' });
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.on('message', (data: unknown) => serverSeen.push(String(data)));
      socket.send('server-hello');
    });

    try {
      const script = webSocketBridgeClientScript({
        bridgeHosts: ['preview.local'],
        instrumentation: {
          eventPrefix: 'rifty:hmr',
          openFlag: '__riftyHmrOpen',
          lastMessageFlag: '__riftyHmrLastMessage',
        },
      });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9020/hmr', 'vite-hmr');
      const clientSeen: string[] = [];
      ws.addEventListener('message', (e) => clientSeen.push(String((e as MessageEvent).data)));

      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );
      expect(ws.protocol).toBe('vite-hmr');
      expect(ws.readyState).toBe(BrowserWebSocket.OPEN);
      expect(win.__riftyHmrOpen).toBe(true);

      ws.send('client-hello');
      await waitFor(() => serverSeen.length === 1);

      expect(serverSeen).toEqual(['client-hello']);
      expect(clientSeen).toEqual(['server-hello']);
      expect(win.__riftyHmrLastMessage).toBe('server-hello');

      ws.close();
    } finally {
      server.close();
      restore();
    }
  });

  it('does not surface bridge control-opcode msg frames to the browser WebSocket', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9030, path: '/control' });
    server.on('connection', () => {});

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const url = 'ws://preview.local:9030/control';
      const ws = new BrowserWebSocket(url);
      const clientSeen: unknown[] = [];
      ws.addEventListener('message', (event) => clientSeen.push((event as MessageEvent).data));
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      const cid = (ws as unknown as { readonly __cid: string }).__cid;
      const channels = [
        new BroadcastChannel(channelNameFor(url)),
        new BroadcastChannel(portChannelNameFor(url)),
      ];
      for (const channel of channels) {
        channel.postMessage({
          type: 'msg',
          cid,
          data: new Uint8Array([1]),
          opcode: 0x9,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(clientSeen).toEqual([]);

      for (const channel of channels) channel.close();
      ws.close();
    } finally {
      server.close();
      restore();
    }
  });

  it('bridges a portless wss URL to a server listening on the default 443 port', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 443, path: '/secure' });
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.send('secure-ok');
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('wss://preview.local/secure');
      const seen: string[] = [];
      ws.addEventListener('message', (event) => seen.push(String((event as MessageEvent).data)));

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('portless wss bridge failed')), {
          once: true,
        });
      });
      await waitFor(() => seen.length === 1);

      expect(seen).toEqual(['secure-ok']);

      ws.close();
    } finally {
      server.close();
      restore();
    }
  });

  it('closes with 1006 when no bridge server accepts the connection', async () => {
    const { win, restore } = installWindow();

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9021/missing');
      let errorSeen = false;
      ws.addEventListener('error', () => {
        errorSeen = true;
      });

      const closeEvent = await new Promise<CloseEvent>((resolve) =>
        ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
      );

      expect(errorSeen).toBe(true);
      expect(closeEvent.code).toBe(1006);
      expect(closeEvent.reason).toBe('connection refused');
    } finally {
      restore();
    }
  });

  it('throws InvalidStateError when send() is called before OPEN', () => {
    const { win, restore } = installWindow();

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9023/slow');

      expect(() => ws.send('too-early')).toThrow(/CONNECTING|InvalidStateError/);
      ws.close();
    } finally {
      restore();
    }
  });

  it('waits for the server close frame after client close()', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9024, path: '/hmr' });
    const order: string[] = [];
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.on('close', () => order.push('server-close'));
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9024/hmr');
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      let clientCloseWasClean: boolean | undefined;
      const closed = new Promise<void>((resolve) =>
        ws.addEventListener(
          'close',
          (event) => {
            order.push(`client-close:${(event as CloseEvent).code}`);
            clientCloseWasClean = (event as CloseEvent).wasClean;
            resolve();
          },
          { once: true },
        ),
      );
      ws.close(3001, 'client-done');
      expect(order).toEqual([]);
      await closed;

      expect(order).toEqual(['server-close', 'client-close:3001']);
      // A client-initiated close completed by the server echo is a clean
      // handshake — wasClean must be true even though readyState was CLOSING.
      expect(clientCloseWasClean).toBe(true);
    } finally {
      server.close();
      restore();
    }
  });

  it('bridges binary frames with browser binaryType semantics', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9025, path: '/bytes' });
    const serverSeen: number[][] = [];
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.on('message', (data: unknown) => {
        serverSeen.push([...new Uint8Array(data as ArrayBuffer)]);
        socket.send(new Uint8Array([9, 8, 7]));
      });
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9025/bytes');
      ws.binaryType = 'arraybuffer';
      const clientSeen: number[][] = [];
      ws.addEventListener('message', (event) => {
        clientSeen.push([...new Uint8Array((event as MessageEvent).data as ArrayBuffer)]);
      });
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      ws.send(new Blob([new Uint8Array([1, 2, 3])]));
      await waitFor(() => clientSeen.length === 1);

      expect(serverSeen).toEqual([[1, 2, 3]]);
      expect(clientSeen).toEqual([[9, 8, 7]]);
      ws.close();
    } finally {
      server.close();
      restore();
    }
  });

  it('preserves frame order when a Blob is sent before a string (FIFO)', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9029, path: '/order' });
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.on('message', (data: unknown) => {
        if (typeof data === 'string') serverSeen.push(`text:${data}`);
        else serverSeen.push(`bin:${[...new Uint8Array(data as ArrayBuffer)].join(',')}`);
      });
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9029/order');
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      // Blob reads are async; a real WebSocket still delivers in call order.
      ws.send(new Blob([new Uint8Array([1, 2, 3])]));
      ws.send('after-blob');
      // The Blob is still being read, so its bytes are buffered, not yet sent.
      expect(ws.bufferedAmount).toBeGreaterThan(0);

      await waitFor(() => serverSeen.length === 2);

      expect(serverSeen).toEqual(['bin:1,2,3', 'text:after-blob']);
      expect(ws.bufferedAmount).toBe(0);
      ws.close();
    } finally {
      server.close();
      restore();
    }
  });

  it('validates protocols and close parameters like a browser WebSocket', () => {
    const { win, restore } = installWindow();

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;

      expect(() => new BrowserWebSocket('ws://preview.local:9026/hmr', ['chat', 'chat'])).toThrow(
        /duplicated|SyntaxError/,
      );
      expect(() => new BrowserWebSocket('ws://preview.local:9026/hmr', ['bad token'])).toThrow(
        /invalid|SyntaxError/,
      );

      const ws = new BrowserWebSocket('ws://preview.local:9026/hmr');
      expect(() => ws.close(1006)).toThrow(/code|InvalidAccessError/);
      expect(() => ws.close(3000, 'x'.repeat(124))).toThrow(/123 bytes|SyntaxError/);
      ws.close();
    } finally {
      restore();
    }
  });

  it('propagates server-initiated close frames to the browser WebSocket', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9022, path: '/hmr' });
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.close(1001, 'server-going-away');
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9022/hmr');

      const closeEvent = await new Promise<CloseEvent>((resolve) =>
        ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
      );

      expect(closeEvent.code).toBe(1001);
      expect(closeEvent.reason).toBe('server-going-away');
      expect(closeEvent.wasClean).toBe(true);
    } finally {
      server.close();
      restore();
    }
  });

  it('client close() resolves with 1006 when the peer realm never echoes the close frame', async () => {
    // Models a terminated peer realm (navigated-away iframe, killed Real-Vite
    // worker): it acks the open handshake, then vanishes — the client close
    // frame is never echoed. A real WebSocket always ends up firing `close`;
    // the shim must too, via a close-handshake timeout, instead of hanging in
    // CLOSING forever and leaking its BroadcastChannels.
    const { win, restore } = installWindow();
    const peer = new BroadcastChannel('rifty:ws:preview.local:9028/hmr');
    const onPeer = (e: MessageEvent): void => {
      const f = e.data as { type?: string; cid?: string };
      if (f?.type === 'open') peer.postMessage({ type: 'open-ack', cid: f.cid, protocol: '' });
      // deliberately ignore 'close' — the peer realm is gone
    };
    peer.addEventListener('message', onPeer);

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9028/hmr');
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      ws.close(3001, 'client-done');
      const closeEvent = await Promise.race([
        new Promise<CloseEvent | null>((resolve) =>
          ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);

      expect(closeEvent, 'close must fire even when the peer never echoes').not.toBeNull();
      expect((closeEvent as CloseEvent).code).toBe(1006);
      expect((closeEvent as CloseEvent).wasClean).toBe(false);
      expect(ws.readyState).toBe(3); // CLOSED
    } finally {
      peer.removeEventListener('message', onPeer);
      peer.close();
      restore();
    }
  });

  it('marks abnormal server close frames as unclean', async () => {
    const { win, restore } = installWindow();
    const server = new WebSocketServer({ port: 9027, path: '/hmr' });
    server.on('connection', (sock) => {
      const socket = sock as ServerSocketLike;
      socket.close(1006, 'socket destroyed');
    });

    try {
      const script = webSocketBridgeClientScript({ bridgeHosts: ['preview.local'] });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://preview.local:9027/hmr');

      const closeEvent = await new Promise<CloseEvent>((resolve) =>
        ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
      );

      expect(closeEvent.code).toBe(1006);
      expect(closeEvent.reason).toBe('socket destroyed');
      expect(closeEvent.wasClean).toBe(false);
    } finally {
      server.close();
      restore();
    }
  });
});

describe('webSocketBridgeClientScript previewPortFromPath remap (ADR-0189)', () => {
  interface OpenFrame {
    readonly type?: string;
    readonly cid?: string;
    readonly url?: string;
    readonly protocols?: readonly string[];
  }

  function ackingPeer(guestPort: number): {
    readonly opens: OpenFrame[];
    readonly close: () => void;
  } {
    const peer = new BroadcastChannel(portChannelNameForPort(guestPort));
    const opens: OpenFrame[] = [];
    const onPeer = (e: MessageEvent): void => {
      const f = e.data as OpenFrame;
      if (f?.type === 'open') {
        opens.push(f);
        peer.postMessage({ type: 'open-ack', cid: f.cid, protocol: f.protocols?.[0] ?? '' });
      }
    };
    peer.addEventListener('message', onPeer);
    return {
      opens,
      close(): void {
        peer.removeEventListener('message', onPeer);
        peer.close();
      },
    };
  }

  async function openOrClose(ws: BrowserWebSocketLike): Promise<'open' | 'close'> {
    return new Promise((resolve) => {
      ws.addEventListener('open', () => resolve('open'), { once: true });
      ws.addEventListener('close', () => resolve('close'), { once: true });
    });
  }

  it('bridges a loopback URL to the guest port from /preview/<port>/ regardless of the URL port', async () => {
    const { win, restore } = installWindow({ hostname: 'localhost', pathname: '/preview/9040/' });
    const peer = ackingPeer(9040);

    try {
      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      // Stock dev-client shape: aims at the page origin (playground host:port),
      // NOT the guest port — only the /preview/<port>/ prefix knows the guest.
      const ws = new BrowserWebSocket('ws://localhost:5174/ws', 'vite-hmr');

      await expect(openOrClose(ws)).resolves.toBe('open');
      expect(ws.protocol).toBe('vite-hmr');
      // The original URL travels in the open frame; only the channel is remapped.
      expect(peer.opens).toEqual([
        expect.objectContaining({ url: 'ws://localhost:5174/ws', protocols: ['vite-hmr'] }),
      ]);
      ws.close();
    } finally {
      peer.close();
      restore();
    }
  });

  it('bridges 127.0.0.1 and the page hostname; deep preview paths still resolve the prefix port', async () => {
    const { win, restore } = installWindow({
      hostname: 'rifty.example',
      pathname: '/preview/9041/nested/page',
    });
    const peer = ackingPeer(9041);

    try {
      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;

      const viaLoopbackIp = new BrowserWebSocket('ws://127.0.0.1:5273/a');
      await expect(openOrClose(viaLoopbackIp)).resolves.toBe('open');
      viaLoopbackIp.close();

      const viaPageHost = new BrowserWebSocket('wss://rifty.example/b');
      await expect(openOrClose(viaPageHost)).resolves.toBe('open');
      viaPageHost.close();

      expect(peer.opens.map((f) => f.url)).toEqual([
        'ws://127.0.0.1:5273/a',
        'wss://rifty.example/b',
      ]);
    } finally {
      peer.close();
      restore();
    }
  });

  it('bridges the full loopback family like the http server predicate (127/8, [::1], 0.0.0.0)', async () => {
    const { win, restore } = installWindow({
      hostname: 'rifty.example',
      pathname: '/preview/9044/',
    });
    const peer = ackingPeer(9044);

    try {
      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;

      for (const url of ['ws://127.0.0.5:3000/a', 'ws://[::1]:3000/b', 'ws://0.0.0.0:4000/c']) {
        const ws = new BrowserWebSocket(url);
        await expect(openOrClose(ws), url).resolves.toBe('open');
        ws.close();
      }
      expect(peer.opens.map((f) => f.url)).toEqual([
        'ws://127.0.0.5:3000/a',
        'ws://[::1]:3000/b',
        'ws://0.0.0.0:4000/c',
      ]);
    } finally {
      peer.close();
      restore();
    }
  });

  it('strips the page /preview/<port>/ prefix from page-base-resolved WS URLs (guest sees its own path)', async () => {
    const { win, restore } = installWindow({ hostname: 'localhost', pathname: '/preview/9043/' });
    const peer = ackingPeer(9043);

    try {
      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;

      // Document-relative URL (WHATWG WebSocket allows it): resolves against
      // the iframe's /preview/<port>/ base — that prefix is the HOST page's
      // routing artifact, never a path the guest serves (the SW strips the
      // same prefix for HTTP requests).
      const relative = new BrowserWebSocket('ws');
      await expect(openOrClose(relative)).resolves.toBe('open');
      relative.close();

      // Root-relative stays untouched (no prefix in the resolved path).
      const rootRelative = new BrowserWebSocket('/api/socket');
      await expect(openOrClose(rootRelative)).resolves.toBe('open');
      rootRelative.close();

      expect(peer.opens.map((f) => f.url)).toEqual([
        'ws://localhost:5174/ws',
        'ws://localhost:5174/api/socket',
      ]);
    } finally {
      peer.close();
      restore();
    }
  });

  it('keeps native WebSocket for non-loopback foreign hosts (real egress stays real)', () => {
    const constructed: string[] = [];
    class NativeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      constructor(url: string) {
        super();
        constructed.push(url);
      }

      send(): void {}
      close(): void {}
    }
    const { win, restore } = installWindow({
      hostname: 'localhost',
      pathname: '/preview/9042/',
      nativeWebSocket: NativeWebSocket,
    });

    try {
      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('wss://echo.example.com/socket');

      expect(ws).toBeInstanceOf(NativeWebSocket);
      expect(constructed).toEqual(['wss://echo.example.com/socket']);
    } finally {
      restore();
    }
  });

  it('does not remap outside a /preview/<port>/ path (loopback falls through to native)', () => {
    const constructed: string[] = [];
    class NativeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      constructor(url: string) {
        super();
        constructed.push(url);
      }

      send(): void {}
      close(): void {}
    }
    const { win, restore } = installWindow({
      hostname: 'localhost',
      pathname: '/not-preview/9043/',
      nativeWebSocket: NativeWebSocket,
    });

    try {
      const script = webSocketBridgeClientScript({ previewPortFromPath: true });
      expect(() => new Function(script)()).not.toThrow();
      const BrowserWebSocket = win.WebSocket as BrowserWebSocketConstructor;
      const ws = new BrowserWebSocket('ws://localhost:9043/ws');

      expect(ws).toBeInstanceOf(NativeWebSocket);
      expect(constructed).toEqual(['ws://localhost:9043/ws']);
    } finally {
      restore();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}
