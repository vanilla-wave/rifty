/**
 * Tests for `HttpServer.listen` overloads.
 *
 * F05-T1 (Q-2026-05-30-101): Node's real `http.Server.listen` accepts an
 * options object — `server.listen({ port, host }, cb)` — in addition to the
 * bare-number form. `@effect/platform-node`'s `NodeHttpServer.layer` drives
 * `listen` exclusively through the options-object overload. Before this fix,
 * the options object was assigned verbatim as `this.port` and handed to
 * `registerPort`, so the port registry keyed on a non-number: the port was
 * unroutable (502) while `'listening'` still fired (the silent-bind trap).
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchToPort, listPorts, unregisterPort } from '../registry.ts';
import { BridgedWebSocket } from '../ws/bridge.ts';
import type { ServerResponse } from './response.ts';
import { createServer } from './server.ts';

const requireFromHere = createRequire(import.meta.url);

interface RealWsConnection {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  send(data: string): void;
  terminate(): void;
}

interface RealWsServer {
  on(event: 'connection', cb: (socket: RealWsConnection) => void): void;
  close(cb?: () => void): void;
}

type RealWsServerCtor = new (options: {
  server: unknown;
  path?: string;
  handleProtocols?: (protocols: Set<string>) => string | false;
}) => RealWsServer;

afterEach(() => {
  for (const p of listPorts()) unregisterPort(p);
});

describe('HttpServer.listen — options-object overload (Q-2026-05-30-101)', () => {
  it('listen(options) registers the port and fires listening', async () => {
    const s = createServer();
    let listened = false;
    s.on('listening', () => {
      listened = true;
    });
    s.listen({ port: 4097 }, () => {});
    // `listening` + the callback fire on a queued microtask; await past it.
    await Promise.resolve();
    await Promise.resolve();
    expect(listPorts()).toContain(4097);
    expect(listened).toBe(true);
  });

  it('listen(port) bare-number form is unchanged', async () => {
    const s = createServer();
    let listened = false;
    s.on('listening', () => {
      listened = true;
    });
    s.listen(4098, () => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(listPorts()).toContain(4098);
    expect(listened).toBe(true);
  });

  it('address() reflects the numeric port from the options form', () => {
    const s = createServer();
    s.listen({ port: 4099 });
    expect(s.address()).toEqual({ port: 4099 });
  });

  // ADR-0157 review C3: a second listen on a bound port emits an async `'error'`
  // EADDRINUSE (Node-faithful — NOT a sync throw, the server is returned and
  // `'listening'` never fires) instead of silently overwriting the registry.
  it('second listen on a bound port emits an EADDRINUSE error, not a silent overwrite', async () => {
    const first = createServer();
    first.listen({ port: 4110 });
    await Promise.resolve();
    await Promise.resolve();

    const second = createServer();
    let secondListened = false;
    second.on('listening', () => {
      secondListened = true;
    });
    const error = await new Promise<Error & Record<string, unknown>>((resolve) => {
      second.on('error', (...args: unknown[]) =>
        resolve(args[0] as Error & Record<string, unknown>),
      );
      second.listen({ port: 4110 });
    });
    expect(error.code).toBe('EADDRINUSE');
    expect(error.syscall).toBe('listen');
    expect(error.port).toBe(4110);
    expect(secondListened).toBe(false);
    // The original handler still owns the port (not clobbered).
    expect(listPorts().filter((p) => p === 4110)).toEqual([4110]);
  });

  it('listen(port, host, backlog, cb) fires the callback (npm ws { port } 4-arg form)', async () => {
    const s = createServer();
    const fired = await Promise.race([
      new Promise<boolean>((resolve) => s.listen(4096, '127.0.0.1', 511, () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
    ]);
    expect(fired).toBe(true);
    s.close();
  });
});

/**
 * F05-T2 (P3 first-light): the Effect-shaped consumption proof.
 *
 * `@effect/platform-node`'s `NodeHttpServer.layer` constructs the server with
 * NO handler (`createServer()` with zero args) and attaches its request
 * handler afterwards via `server.on('request', (req, res) => …)`. Spike B
 * confirmed this works AS-IS at the buffered level. This pins it as a
 * regression contract: over the now-routable port (F05-T1), a buffered
 * `res.writeHead(200, …) + res.end(jsonBody)` route dispatched through the
 * registry yields a 200 application/json Response with the exact body bytes —
 * proving the `emit('request')` path for the no-arg-constructor Effect form
 * with NONE of the streaming gaps (drain/pipe) in play.
 */
describe('HttpServer — no-handler createServer + on(request) buffered (P3 first-light)', () => {
  it('no-handler createServer + on(request) buffered end(body) dispatches 200 JSON', async () => {
    const port = 4100;
    // Effect form: no handler at construction; attach via .on('request').
    const s = createServer();
    // The `'request'` listener is typed by Node as `(req, res)`; rifty's
    // EventEmitter exposes the generic `(...args: unknown[])` shape, so narrow
    // the positional args to the documented event payload (no `any`).
    s.on('request', (...args: unknown[]) => {
      const res = args[1] as ServerResponse;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: 'x' }));
    });
    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const resp = await dispatchToPort(port, new Request(`http://preview.local:${port}/version`));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('application/json');
    expect(await resp.text()).toBe(JSON.stringify({ version: 'x' }));
  });
});

describe('HttpServer — WebSocket upgrade bridge', () => {
  it('runs the real ws package in { server } mode over the bridge', async () => {
    const { WebSocketServer } = requireFromHere('ws') as {
      WebSocketServer: RealWsServerCtor;
    };
    const port = 4103;
    const httpServer = createServer();
    const requestArgs: unknown[][] = [];
    httpServer.on('request', (...args: unknown[]) => requestArgs.push(args));
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    let serverBufferedAmount: number | undefined;
    wss.on('connection', (socket) => {
      // bufferedAmount reads `_socket._writableState.length`; a missing field
      // returns NaN. The bridge keeps no send queue, so it must read 0.
      serverBufferedAmount = (socket as unknown as { bufferedAmount: number }).bufferedAmount;
      socket.on('message', (data) => socket.send(`echo:${String(data)}`));
    });
    httpServer.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket(`ws://localhost:${port}/ws`, 'probe');
    const seen: string[] = [];
    ws.addEventListener('message', (event) => seen.push(String((event as MessageEvent).data)));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('real ws bridge failed to open')), {
        once: true,
      });
    });
    ws.send('hello');
    await waitFor(() => seen.includes('echo:hello'));

    expect(requestArgs).toHaveLength(0);
    expect(serverBufferedAmount).toBe(0);
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    wss.close();
    httpServer.close();
  });

  it('propagates real ws terminate() to the bridged client', async () => {
    const { WebSocketServer } = requireFromHere('ws') as {
      WebSocketServer: RealWsServerCtor;
    };
    const port = 4105;
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', (socket) => {
      socket.terminate();
    });
    httpServer.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket(`ws://localhost:${port}/ws`);
    const closeEvent = await new Promise<CloseEvent>((resolve, reject) => {
      ws.addEventListener('close', (event) => resolve(event as CloseEvent), { once: true });
      ws.addEventListener(
        'error',
        () => reject(new Error('terminate should close after upgrade')),
        {
          once: true,
        },
      );
    });

    expect(closeEvent.code).toBe(1006);
    expect(closeEvent.reason).toContain('socket destroyed');
    wss.close();
    httpServer.close();
  });

  it('lets the real ws server choose the accepted subprotocol', async () => {
    const { WebSocketServer } = requireFromHere('ws') as {
      WebSocketServer: RealWsServerCtor;
    };
    const port = 4106;
    const httpServer = createServer();
    const wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      handleProtocols: (protocols) => (protocols.has('b') ? 'b' : false),
    });
    wss.on('connection', (socket) => {
      socket.send('ok');
    });
    httpServer.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket(`ws://localhost:${port}/ws`, ['a', 'b']);
    const seen: string[] = [];
    ws.addEventListener('message', (event) => seen.push(String((event as MessageEvent).data)));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('subprotocol bridge failed to open')), {
        once: true,
      });
    });

    expect(ws.protocol).toBe('b');
    await waitFor(() => seen.includes('ok'));
    ws.close();
    wss.close();
    httpServer.close();
  });

  it('accepts wss bridge opens as encrypted upgrade sockets', async () => {
    const port = 4109;
    const s = createServer();
    s.on('upgrade', (...args: unknown[]) => {
      const req = args[0] as { headers: Record<string, string> };
      const socket = args[1] as {
        encrypted: boolean;
        write(chunk: string | Uint8Array): boolean;
      };
      expect(socket.encrypted).toBe(true);
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade',
          'Upgrade: websocket',
          `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key']!)}`,
          '',
          '',
        ].join('\r\n'),
      );
    });
    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket(`wss://localhost:${port}/secure`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('wss bridge failed to open')), {
        once: true,
      });
    });

    ws.close();
    s.close();
  });

  it('emits upgrade for bridged WebSocket opens and carries RFC6455 frames', async () => {
    const port = 4101;
    const s = createServer();
    const requestArgs: unknown[][] = [];
    s.on('request', (...args: unknown[]) => {
      requestArgs.push(args);
    });
    const upgradeArgs: unknown[][] = [];
    s.on('upgrade', async (...args: unknown[]) => {
      upgradeArgs.push(args);
      const req = args[0] as { headers: Record<string, string>; url: string };
      const socket = args[1] as {
        write(chunk: string | Uint8Array): boolean;
        on(event: 'data', cb: (chunk: Uint8Array) => void): void;
      };
      const head = args[2] as Uint8Array;
      expect(req.url).toBe('/socket?room=1');
      expect(req.headers.upgrade).toBe('websocket');
      const connection = req.headers.connection;
      expect(connection).toBeDefined();
      expect(connection?.toLowerCase()).toContain('upgrade');
      expect(head.byteLength).toBe(0);

      const protocol = req.headers['sec-websocket-protocol']
        ?.split(',')
        .map((part) => part.trim())
        .find((part) => part.length > 0);
      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key']!)}`,
      ];
      if (protocol) headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
      socket.write(`${headers.join('\r\n')}\r\n\r\n`);
      socket.on('data', (chunk) => {
        const frame = parseClientFrame(Buffer.from(chunk));
        if (frame.opcode === 0x1 && frame.payload.toString('utf8') === 'ping') {
          socket.write(encodeServerFrame(0x1, Buffer.from('po'), { fin: false }));
          socket.write(encodeServerFrame(0x0, Buffer.from('ng')));
        }
      });
    });

    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket(`ws://localhost:${port}/socket?room=1`, 'chat');
    const seen: string[] = [];
    ws.addEventListener('message', (e) => seen.push(String((e as MessageEvent).data)));
    await new Promise<void>((resolve) =>
      ws.addEventListener('open', () => resolve(), { once: true }),
    );
    expect(ws.protocol).toBe('chat');
    ws.send('ping');
    await waitFor(() => seen.includes('pong'));

    expect(requestArgs).toHaveLength(0);
    expect(upgradeArgs).toHaveLength(1);
    ws.close();
    s.close();
  });

  it('routes concurrent upgrade connections to one server without cross-talk', async () => {
    const port = 4109;
    const s = createServer();
    // Per-connection echo: each upgrade gets its own socket; the server's
    // cid-keyed upgradeSockets map must keep the two clients' frames apart.
    s.on('upgrade', (...args: unknown[]) => {
      const req = args[0] as { headers: Record<string, string> };
      const socket = args[1] as {
        write(chunk: string | Uint8Array): boolean;
        on(event: 'data', cb: (chunk: Uint8Array) => void): void;
      };
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade',
          'Upgrade: websocket',
          `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key']!)}`,
          '',
          '',
        ].join('\r\n'),
      );
      socket.on('data', (chunk) => {
        const frame = parseClientFrame(Buffer.from(chunk));
        if (frame.opcode === 0x1) {
          socket.write(
            encodeServerFrame(0x1, Buffer.from(`echo:${frame.payload.toString('utf8')}`)),
          );
        }
      });
    });
    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const a = new BridgedWebSocket(`ws://localhost:${port}/a`);
    const b = new BridgedWebSocket(`ws://localhost:${port}/b`);
    const aSeen: string[] = [];
    const bSeen: string[] = [];
    a.addEventListener('message', (e) => aSeen.push(String((e as MessageEvent).data)));
    b.addEventListener('message', (e) => bSeen.push(String((e as MessageEvent).data)));
    await Promise.all([
      new Promise<void>((r) => a.addEventListener('open', () => r(), { once: true })),
      new Promise<void>((r) => b.addEventListener('open', () => r(), { once: true })),
    ]);

    a.send('aaa');
    b.send('bbb');
    await waitFor(() => aSeen.length > 0 && bSeen.length > 0);

    expect(aSeen).toEqual(['echo:aaa']);
    expect(bSeen).toEqual(['echo:bbb']);
    a.close();
    b.close();
    s.close();
  });

  it('rejects invalid server-to-client RFC6455 frames loudly', async () => {
    const port = 4107;
    const s = createServer();
    s.on('upgrade', (...args: unknown[]) => {
      const req = args[0] as { headers: Record<string, string> };
      const socket = args[1] as {
        write(chunk: string | Uint8Array): boolean;
        on(event: 'error', cb: () => void): void;
      };
      socket.on('error', () => {});
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade',
          'Upgrade: websocket',
          `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key']!)}`,
          '',
          '',
        ].join('\r\n'),
      );
      socket.write(encodeServerFrame(0x1, Buffer.from('masked'), { masked: true }));
    });
    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket(`ws://localhost:${port}/socket`);
    const closeEvent = await new Promise<CloseEvent>((resolve) =>
      ws.addEventListener('close', (event) => resolve(event as CloseEvent), { once: true }),
    );

    expect(closeEvent.code).toBe(1002);
    expect(closeEvent.reason).toContain('masked websocket frame from server');
    s.close();
  });

  it('does not silently route upgrade-shaped HTTP requests through request', async () => {
    const port = 4102;
    const s = createServer();
    const requestArgs: unknown[][] = [];
    const upgradeArgs: unknown[][] = [];
    s.on('request', (...args: unknown[]) => requestArgs.push(args));
    s.on('upgrade', (...args: unknown[]) => upgradeArgs.push(args));
    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const response = await dispatchToPort(
      port,
      new Request(`http://preview.local:${port}/socket`, {
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('WebSocket upgrade requires');
    expect(requestArgs).toHaveLength(0);
    expect(upgradeArgs).toHaveLength(0);
    s.close();
  });
});

function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}

function parseClientFrame(buf: Buffer): { opcode: number; payload: Buffer } {
  const opcode = buf[0]! & 0x0f;
  const masked = (buf[1]! & 0x80) !== 0;
  let len = buf[1]! & 0x7f;
  let off = 2;
  if (len === 126) {
    len = (buf[2]! << 8) | buf[3]!;
    off = 4;
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  const maskOff = off;
  if (masked) off += 4;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ buf[maskOff + (i % 4)]!;
  }
  return { opcode, payload };
}

function encodeServerFrame(
  opcode: number,
  payload: Buffer,
  opts: { fin?: boolean; masked?: boolean } = {},
): Buffer {
  if (payload.length >= 126) throw new Error('test frame helper only supports short payloads');
  if (!opts.masked) {
    return Buffer.concat([
      Buffer.from([(opts.fin === false ? 0 : 0x80) | opcode, payload.length]),
      payload,
    ]);
  }
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] = masked[i]! ^ mask[i % 4]!;
  return Buffer.concat([
    Buffer.from([(opts.fin === false ? 0 : 0x80) | opcode, 0x80 | payload.length]),
    mask,
    masked,
  ]);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}
