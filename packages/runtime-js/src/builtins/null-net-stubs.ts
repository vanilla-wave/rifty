/**
 * Loud stubs for `node:dns`, `node:tls`, `node:readline`. Exist so `import`
 * succeeds (Vite static-imports them all); every method call throws
 * NotImplementedError rather than silently corrupting behaviour. `node:https`
 * lives in `@riftydev/net/https.ts` (ADR-0010 loud-throw stub); `node:zlib` is a
 * real web-compression-backed subset in `./zlib.ts` (ADR-0159).
 */
import { NotImplementedError } from '@riftydev/io';
import { HTTP2_CONSTANTS } from './http2-constants.ts';

const notImpl = (feature: string) => () => {
  throw new NotImplementedError(feature);
};

interface ReadlineWritable {
  write(chunk: string): boolean;
}

type ReadlineCallback = () => void;

function writeControl(stream: ReadlineWritable, sequence: string, cb?: ReadlineCallback): boolean {
  const ok = stream.write(sequence);
  if (cb) queueMicrotask(cb);
  return ok;
}

function clearLine(stream: ReadlineWritable, dir = 0, cb?: ReadlineCallback): boolean {
  const mode = dir < 0 ? 1 : dir > 0 ? 0 : 2;
  return writeControl(stream, `\x1b[${mode}K`, cb);
}

function clearScreenDown(stream: ReadlineWritable, cb?: ReadlineCallback): boolean {
  return writeControl(stream, '\x1b[0J', cb);
}

function cursorTo(
  stream: ReadlineWritable,
  x: number,
  yOrCb?: number | ReadlineCallback,
  cb?: ReadlineCallback,
): boolean {
  const y = typeof yOrCb === 'number' ? yOrCb : undefined;
  const callback = typeof yOrCb === 'function' ? yOrCb : cb;
  const sequence = y === undefined ? `\x1b[${Math.max(0, x) + 1}G` : `\x1b[${y + 1};${x + 1}H`;
  return writeControl(stream, sequence, callback);
}

function moveCursor(
  stream: ReadlineWritable,
  dx: number,
  dy: number,
  cb?: ReadlineCallback,
): boolean {
  let sequence = '';
  if (dx < 0) sequence += `\x1b[${-dx}D`;
  else if (dx > 0) sequence += `\x1b[${dx}C`;
  if (dy < 0) sequence += `\x1b[${-dy}A`;
  else if (dy > 0) sequence += `\x1b[${dy}B`;
  return writeControl(stream, sequence, cb);
}

// Browser-only "dns": only `localhost` resolves. Vite's `server.listen()` calls
// `dns.promises.lookup('localhost', …)` to choose 127.0.0.1 vs ::1 — the one
// case we must handle; everything else throws.
function lookupLocal(hostname: string): { address: string; family: number } {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { address: '127.0.0.1', family: 4 };
  }
  if (hostname === '::1') {
    return { address: '::1', family: 6 };
  }
  throw new NotImplementedError(`dns.lookup('${hostname}')`);
}

type DnsLookupCallback = (err: Error | null, address?: string, family?: number) => void;

export const dns = {
  lookup(hostname: string, options?: unknown, cb?: DnsLookupCallback): void {
    const callback = (typeof options === 'function' ? options : cb) as DnsLookupCallback;
    try {
      const { address, family } = lookupLocal(hostname);
      callback(null, address, family);
    } catch (err) {
      callback(err as Error);
    }
  },
  resolve: notImpl('dns.resolve'),
  resolve4: notImpl('dns.resolve4'),
  resolve6: notImpl('dns.resolve6'),
  promises: {
    async lookup(
      hostname: string,
      _options?: unknown,
    ): Promise<{ address: string; family: number }> {
      return lookupLocal(hostname);
    },
    resolve: notImpl('dns.promises.resolve'),
    resolve4: notImpl('dns.promises.resolve4'),
    resolve6: notImpl('dns.promises.resolve6'),
  },
};

class TlsThrow {
  constructor() {
    throw new NotImplementedError('tls.createServer');
  }
}

export const tls = {
  createServer: notImpl('tls.createServer'),
  connect: notImpl('tls.connect'),
  Server: TlsThrow,
  TLSSocket: TlsThrow,
};

// `node:dgram` raw UDP sockets: no UDP socket API exists in the browser
// (WebSocket/fetch/WebTransport are all stream/connection-oriented, none expose
// `recvfrom`/`sendto`), a genuine browser/WASI capability ceiling — socket ops
// throw, like `tls`.
//
// The surface must still RESOLVE: `multicast-dns/index.js` does top-level
// `var dgram = require('dgram')` and only calls `createSocket()` later in its
// factory, which `bonjour-service` invokes only on mDNS publish. opencode pulls
// multicast-dns transitively (server.ts -> mdns.ts -> bonjour-service ->
// multicast-dns), so import must succeed for the static graph; the throw fires
// only if UDP is actually used (mDNS publish), never on import.
// Named `Socket` so `dgram.Socket.name === 'Socket'` matches Node —
// multicast-dns probes the module shape, pinned by the parity surface case.
class Socket {
  constructor() {
    throw new NotImplementedError('dgram.createSocket');
  }
}

export const dgram = {
  createSocket: notImpl('dgram.createSocket'),
  Socket,
  _createSocketHandle: notImpl('dgram._createSocketHandle'),
};

// `node:http2`: HTTP/2 multiplexes frames over one raw TCP/TLS connection, but
// the browser/WASI realm has no raw socket API (rifty's `node:http` runs over the
// page<->SW port registry; `node:tls`/raw `node:net` connect already loud-throw),
// so a real HTTP/2 server/session is a capability ceiling, like `tls`/`dgram`.
//
// The surface must still RESOLVE: `fastify/lib/server.js` does top-level
// `const http2 = require('node:http2')` UNCONDITIONALLY and only calls
// `createServer`/`createSecureServer` later, when configured `http2: true`.
// opencode boots HTTP/1 so that branch is never taken, but the import must
// succeed for the static graph; server/session creation throws if HTTP/2 is
// actually used. Exposed names mirror Node 24's `node:http2`; `sensitiveHeaders`
// is the documented symbol.
export const http2 = {
  createServer: notImpl('http2.createServer'),
  createSecureServer: notImpl('http2.createSecureServer'),
  connect: notImpl('http2.connect'),
  getDefaultSettings: notImpl('http2.getDefaultSettings'),
  getPackedSettings: notImpl('http2.getPackedSettings'),
  getUnpackedSettings: notImpl('http2.getUnpackedSettings'),
  performServerHandshake: notImpl('http2.performServerHandshake'),
  sensitiveHeaders: Symbol('nodejs.http2.sensitiveHeaders'),
  // Real spec constants (pure data) — undici's client-h2.js reads
  // `constants.HTTP2_HEADER_*` at module-eval.
  constants: HTTP2_CONSTANTS,
};

export const readline = {
  createInterface: notImpl('readline.createInterface'),
  cursorTo,
  moveCursor,
  clearLine,
  clearScreenDown,
  emitKeypressEvents: notImpl('readline.emitKeypressEvents'),
};
