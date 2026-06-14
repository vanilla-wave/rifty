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
}

function installWindow(): {
  readonly win: BrowserWindowLike;
  readonly restore: () => void;
} {
  const globalWithWindow = globalThis as unknown as { window: BrowserWindowLike | undefined };
  const previousWindow = globalWithWindow.window;
  const events = new EventTarget();
  const win: BrowserWindowLike = {
    location: { href: 'http://preview.local:5174/', hostname: 'preview.local' },
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
});
