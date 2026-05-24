/**
 * Loud stubs for `node:dns`, `node:tls`, `node:https`, `node:readline`,
 * `node:zlib`. They exist so that `import` succeeds (Vite static-imports all
 * of them at top level); every actual method call throws NotImplementedError
 * so we never silently corrupt behaviour. `https` is special: it re-exports
 * `node:http` so HTTPS-only call sites at least see the same shape.
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

// `https` is registered by @rifty/net once its http shim has loaded, since
// runtime-js cannot import from the layer above. Until then, importing
// `node:https` from inside the runtime would fail — net registers it as an
// alias of http on package init.
export const https = {
  createServer: notImpl('https.createServer'),
  request: notImpl('https.request'),
  Agent: class {
    constructor() {
      throw new NotImplementedError('https.Agent');
    }
  },
};

export const readline = {
  createInterface: notImpl('readline.createInterface'),
  cursorTo: () => {},
  clearLine: () => {},
  clearScreenDown: () => {},
  emitKeypressEvents: () => {},
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
