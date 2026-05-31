/**
 * Loud stubs for `node:dns`, `node:tls`, `node:readline`, `node:zlib`. They
 * exist so that `import` succeeds (Vite static-imports all of them at top
 * level); every actual method call throws NotImplementedError so we never
 * silently corrupt behaviour. `node:https` lives in `@rifty/net/https.ts`
 * and is registered there (ADR-0010 loud-throw stub).
 */
import { NotImplementedError } from '@rifty/io';

const notImpl = (feature: string) => () => {
  throw new NotImplementedError(feature);
};

// Browser-only "dns" — only `localhost` resolves, everything else throws.
// Vite's `server.listen()` calls `dns.promises.lookup('localhost', …)` to
// decide between 127.0.0.1 and ::1; that's the one case we have to handle.
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

// `node:dgram` — raw UDP datagram sockets. There is NO UDP socket API in the
// browser (WebSocket / fetch / WebTransport are all stream/connection-oriented;
// none expose `recvfrom`/`sendto` on a UDP port), so this is a genuine
// browser/WASI capability ceiling: every actual socket operation throws
// NotImplementedError, exactly like `tls` / `zlib` above.
//
// The module surface must still RESOLVE, because `multicast-dns/index.js` does a
// top-level `var dgram = require('dgram')` and only calls `dgram.createSocket()`
// later, inside its exported factory — which `bonjour-service` invokes only when
// mDNS is actually published at runtime. The opencode server graph pulls
// multicast-dns transitively (server.ts -> mdns.ts -> bonjour-service ->
// multicast-dns), so the import must succeed for the static graph to evaluate;
// the throw fires only if UDP is genuinely used (mDNS publish), never on import.
// Named `Socket` (not `DgramSocketThrow`) so `dgram.Socket.name === 'Socket'`
// matches Node — multicast-dns probes the module shape, and the parity surface
// case pins it.
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

export const readline = {
  createInterface: notImpl('readline.createInterface'),
  cursorTo: notImpl('readline.cursorTo'),
  clearLine: notImpl('readline.clearLine'),
  clearScreenDown: notImpl('readline.clearScreenDown'),
  emitKeypressEvents: notImpl('readline.emitKeypressEvents'),
};

class ZlibUnsupported {
  constructor() {
    throw new NotImplementedError('zlib');
  }
}

export const zlib = {
  createGzip: notImpl('zlib.createGzip'),
  createDeflate: notImpl('zlib.createDeflate'),
  createBrotliCompress: notImpl('zlib.createBrotliCompress'),
  createBrotliDecompress: notImpl('zlib.createBrotliDecompress'),
  gzip: notImpl('zlib.gzip'),
  gzipSync: notImpl('zlib.gzipSync'),
  gunzip: notImpl('zlib.gunzip'),
  gunzipSync: notImpl('zlib.gunzipSync'),
  deflate: notImpl('zlib.deflate'),
  deflateSync: notImpl('zlib.deflateSync'),
  inflate: notImpl('zlib.inflate'),
  inflateSync: notImpl('zlib.inflateSync'),
  Gzip: ZlibUnsupported,
  Deflate: ZlibUnsupported,
  constants: {
    Z_NO_FLUSH: 0,
    Z_PARTIAL_FLUSH: 1,
    Z_SYNC_FLUSH: 2,
    Z_FULL_FLUSH: 3,
    Z_FINISH: 4,
  },
};
