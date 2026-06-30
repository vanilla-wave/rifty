/**
 * `node:net` over the port registry.
 *
 * The full TCP model doesn't fit a browser. What this module actually exposes
 * is an **HTTP-framed** socket: the connection handler receives the request
 * serialised as HTTP/1.1 wire bytes and the writes back are parsed as an
 * HTTP/1.1 response. This is NOT a general raw TCP socket. Per ADR-0017, the
 * class is named `HttpFramedSocket` to make the framing assumption obvious at
 * the type level — `net.Socket` remains as a deprecated alias that emits a
 * one-shot `console.warn` on instantiation.
 *
 * Calling `.connect()` (which only makes sense for a TCP socket) throws
 * `NotImplementedError` — raw OS TCP sockets are a browser ceiling, not a
 * feature this package can faithfully emulate.
 */

import { EventEmitter, NotImplementedError } from '@riftydev/io';
import { claimPort, releasePort } from './cross-realm/port-claim.ts';
import {
  addrInUseError,
  allocateEphemeralPort,
  isPortBound,
  registerPort,
  unregisterPort,
} from './registry.ts';

// Shared one-shot codecs (default config, non-fatal). One-shot utf8
// encode/decode is stateless, so a module singleton is byte-identical and
// avoids per-call allocation.
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export class HttpFramedSocket extends EventEmitter {
  remoteAddress = '127.0.0.1';
  localAddress = '127.0.0.1';
  remotePort = 0;
  localPort = 0;
  writableEnded = false;
  private chunks: Uint8Array[] = [];

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.emit('data', chunk);
  }

  write(chunk: Uint8Array | string): boolean {
    const buf = typeof chunk === 'string' ? UTF8_ENCODER.encode(chunk) : chunk;
    this.emit('write', buf);
    return true;
  }

  end(chunk?: Uint8Array | string): void {
    if (chunk !== undefined) this.write(chunk);
    this.writableEnded = true;
    this.emit('end');
  }

  /**
   * Raw TCP connect is not supported — the port registry routes via HTTP
   * `Request`/`Response`, not byte streams. Use `fetch()` for client traffic.
   */
  connect(..._args: unknown[]): never {
    throw new NotImplementedError(
      'net.Socket.connect',
      'browser runtimes cannot open raw TCP sockets; use http/fetch/WebSocket transports',
    );
  }

  destroy(): void {
    this.writableEnded = true;
    this.emit('close');
  }

  collected(): Uint8Array {
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

/**
 * Deprecated alias for `HttpFramedSocket`. The name `net.Socket` is misleading
 * because the implementation carries HTTP frames, not raw TCP. Emits a
 * one-shot warning on first instantiation (not on import).
 *
 * @deprecated Use `HttpFramedSocket` to make the framing explicit, or `fetch()`
 *   for client traffic.
 */
let socketDeprecationWarned = false;
export class Socket extends HttpFramedSocket {
  constructor() {
    super();
    if (!socketDeprecationWarned) {
      socketDeprecationWarned = true;
      console.warn(
        '[rifty/net] `net.Socket` is a deprecated alias for `HttpFramedSocket`. ' +
          'The class carries HTTP/1.1-framed bytes, not raw TCP. ' +
          'Update imports to `HttpFramedSocket` or use `fetch()` for client traffic.',
      );
    }
  }
}

/**
 * Subset of Node's `net.ListenOptions` honoured by {@link Server.listen}. Only
 * `port` is read; `host`/`backlog`/`exclusive` are accepted-but-unused for
 * Node-shape parity (rifty is loopback-only — see `request.ts`). Mirrors the
 * `node:http` server's `ListenOptions` so `listen({ port: 0 })` is ephemeral on
 * both surfaces.
 */
export interface NetListenOptions {
  port?: number;
  host?: string;
  backlog?: number;
  exclusive?: boolean;
}

export class Server extends EventEmitter {
  private listenedPort: number | null = null;
  private readonly connectionHandler?: (socket: HttpFramedSocket) => void;

  constructor(connectionHandler?: (socket: HttpFramedSocket) => void) {
    super();
    this.connectionHandler = connectionHandler;
  }

  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this;
  listen(options: NetListenOptions, cb?: () => void): this;
  listen(
    portOrOptions: number | NetListenOptions,
    hostnameOrCb?: string | (() => void),
    cb?: () => void,
  ): this {
    // Accept Node's two `Server.listen` shapes: a bare number, or an options
    // object (`listen({ port }, cb)`). Both extract a numeric port; host is
    // ignored (loopback-only).
    const requested = typeof portOrOptions === 'number' ? portOrOptions : (portOrOptions.port ?? 0);
    const callback = (typeof hostnameOrCb === 'function' ? hostnameOrCb : cb) as
      | (() => void)
      | undefined;
    // Port already bound in this realm → async `'error'` EADDRINUSE, like Node
    // (server returned, no `'listening'`; ADR-0157 review C3). Port 0 = ephemeral,
    // never collides — skip the check for it.
    if (requested !== 0 && isPortBound(requested)) {
      queueMicrotask(() => this.emit('error', addrInUseError('127.0.0.1', requested)));
      return this;
    }
    // `listen(0)` / `listen({ port: 0 })` allocates a virtual ephemeral port from
    // the realm registry, exposed via `address().port` until close (no OS socket).
    const resolvedPort = requested === 0 ? allocateEphemeralPort() : requested;
    this.listenedPort = resolvedPort;
    registerPort(resolvedPort, async (request) => {
      const socket = new HttpFramedSocket();
      this.emit('connection', socket);
      this.connectionHandler?.(socket);
      // Feed raw request bytes through the socket for the HTTP server to parse.
      const headers: string[] = [];
      for (const [k, v] of request.headers) headers.push(`${k}: ${v}`);
      const body = new Uint8Array(await request.arrayBuffer());
      const u = new URL(request.url);
      const head = `${request.method} ${u.pathname + u.search} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`;
      socket.push(UTF8_ENCODER.encode(head));
      if (body.byteLength > 0) socket.push(body);
      // Resolve from a 'response' event, else synthesise a Response from socket writes.
      return await new Promise<Response>((resolve) => {
        const writeBufs: Uint8Array[] = [];
        socket.on('write', (chunk) => writeBufs.push(chunk as Uint8Array));
        socket.on('response', (res) => resolve(res as Response));
        socket.on('end', () => {
          if (writeBufs.length === 0) {
            resolve(new Response('', { status: 200 }));
            return;
          }
          const all = concat(writeBufs);
          const text = UTF8_DECODER.decode(all);
          const sep = text.indexOf('\r\n\r\n');
          if (sep === -1) {
            resolve(new Response(all as unknown as BodyInit, { status: 200 }));
            return;
          }
          const headPart = text.slice(0, sep);
          const bodyStr = text.slice(sep + 4);
          const lines = headPart.split('\r\n');
          const status = Number((lines[0] ?? '').split(' ')[1] ?? 200);
          const headers = new Headers();
          for (const line of lines.slice(1)) {
            const colon = line.indexOf(':');
            if (colon === -1) continue;
            headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
          }
          resolve(new Response(bodyStr, { status, headers }));
        });
      });
    });
    // Ephemeral (`listen(0)`) never collides cross-realm (ADR-0185 D5).
    if (requested === 0) {
      queueMicrotask(() => {
        this.emit('listening');
        callback?.();
      });
      return this;
    }
    // Explicit port: a cross-realm bind-claim (ADR-0185) gates `'listening'`.
    // The port is registered synchronously (above) — the claim only decides
    // whether THIS realm keeps it; a sibling owner → unregister + EADDRINUSE.
    void claimPort(resolvedPort).then((won) => {
      if (this.listenedPort !== resolvedPort) {
        if (won) releasePort(resolvedPort); // closed during the window
        return;
      }
      if (won) {
        this.emit('listening');
        callback?.();
      } else {
        unregisterPort(resolvedPort);
        this.listenedPort = null;
        this.emit('error', addrInUseError('127.0.0.1', resolvedPort));
      }
    });
    return this;
  }

  address(): { port: number } | null {
    return this.listenedPort === null ? null : { port: this.listenedPort };
  }

  close(cb?: () => void): this {
    if (this.listenedPort !== null) {
      releasePort(this.listenedPort); // stop answering cross-realm claims (ADR-0185 D4)
      unregisterPort(this.listenedPort);
      this.listenedPort = null;
    }
    queueMicrotask(() => {
      this.emit('close');
      cb?.();
    });
    return this;
  }
}

function concat(bufs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const b of bufs) total += b.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

export function createServer(handler?: (socket: HttpFramedSocket) => void): Server {
  return new Server(handler);
}

export function connect(..._args: unknown[]): never {
  throw new NotImplementedError(
    'net.connect',
    'browser runtimes cannot open raw TCP sockets; use http/fetch/WebSocket transports',
  );
}

export const createConnection = connect;

const net = { createServer, connect, createConnection, Server, Socket, HttpFramedSocket };
export default net;
