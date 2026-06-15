import { describe, expect, it } from 'vitest';
import { webSocketBridgeClientScript } from './browser-client-script.ts';
import { WebSocketServer } from './in-process.ts';

interface BrowserWindowLike {
  WebSocket?: unknown;
  location: { href: string; hostname: string };
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
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface BrowserWebSocketConstructor {
  readonly OPEN: number;
  new (url: string, protocols?: string | string[]): BrowserWebSocketLike;
}

interface ServerSocketLike {
  on(event: 'message', listener: (data: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

function installWindow(opts: { hostname?: string; nativeWebSocket?: unknown } = {}): {
  readonly win: BrowserWindowLike;
  readonly restore: () => void;
} {
  const globalWithWindow = globalThis as unknown as { window: BrowserWindowLike | undefined };
  const previousWindow = globalWithWindow.window;
  const events = new EventTarget();
  const hostname = opts.hostname ?? 'preview.local';
  const win: BrowserWindowLike = {
    WebSocket: opts.nativeWebSocket,
    location: { href: `http://${hostname}:5174/`, hostname },
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
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(serverSeen).toEqual(['client-hello']);
      expect(clientSeen).toEqual(['server-hello']);
      expect(win.__riftyHmrLastMessage).toBe('server-hello');

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
    } finally {
      server.close();
      restore();
    }
  });
});
