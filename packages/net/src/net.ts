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
 * `NotImplementedError` — raw byte streaming over TCP is deferred to ADR-0017
 * phase 2 / M12.
 */

import { EventEmitter, NotImplementedError } from '@rifty/io';
import { registerPort, unregisterPort } from './registry.ts';

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
    const buf = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
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
  connect(_port: number, _host?: string): never {
    throw new NotImplementedError(
      'net.Socket.connect',
      'rifty net.Socket only supports HTTP framing — use fetch()',
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

export class Server extends EventEmitter {
  private listenedPort: number | null = null;
  private readonly connectionHandler?: (socket: HttpFramedSocket) => void;

  constructor(connectionHandler?: (socket: HttpFramedSocket) => void) {
    super();
    this.connectionHandler = connectionHandler;
  }

  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this {
    const callback = (typeof hostnameOrCb === 'function' ? hostnameOrCb : cb) as
      | (() => void)
      | undefined;
    this.listenedPort = port;
    registerPort(port, async (request) => {
      // Build a socket per request; the connection handler may write Response data.
      const socket = new HttpFramedSocket();
      this.emit('connection', socket);
      this.connectionHandler?.(socket);
      // Send the raw request bytes through the socket so the HTTP server can parse.
      const headers: string[] = [];
      for (const [k, v] of request.headers) headers.push(`${k}: ${v}`);
      const body = new Uint8Array(await request.arrayBuffer());
      const head = `${request.method} ${new URL(request.url).pathname + new URL(request.url).search} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`;
      socket.push(new TextEncoder().encode(head));
      if (body.byteLength > 0) socket.push(body);
      // Wait for a 'response' event with a Response object — or build one from socket writes.
      return await new Promise<Response>((resolve) => {
        const writeBufs: Uint8Array[] = [];
        socket.on('write', (chunk) => writeBufs.push(chunk as Uint8Array));
        socket.on('response', (res) => resolve(res as Response));
        socket.on('end', () => {
          if (writeBufs.length === 0) {
            resolve(new Response('', { status: 200 }));
            return;
          }
          // Try to parse a raw HTTP response from writeBufs.
          const all = concat(writeBufs);
          const text = new TextDecoder().decode(all);
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
    queueMicrotask(() => {
      this.emit('listening');
      callback?.();
    });
    return this;
  }

  address(): { port: number } | null {
    return this.listenedPort === null ? null : { port: this.listenedPort };
  }

  close(cb?: () => void): this {
    if (this.listenedPort !== null) {
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

const net = { createServer, Server, Socket, HttpFramedSocket };
export default net;
