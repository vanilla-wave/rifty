/**
 * Loud stubs/subsets for network-ish and terminal-ish Node builtins. `node:dns`
 * has a localhost lookup subset; `node:readline` has the line-oriented CLI
 * subset plus cursor helpers that real package CLIs reach. Unsupported members
 * still throw NotImplementedError rather than silently corrupting behaviour.
 * `node:https` lives in `@riftydev/net/https.ts` (ADR-0181: client request/get
 * over the page fetch; TLS server/socket surface still throws — ADR-0010);
 * `node:zlib` is a real web-compression-backed subset in `./zlib.ts` (ADR-0159).
 */
import { NotImplementedError } from '@riftydev/io';
import { EventEmitter } from './events.ts';
import { HTTP2_CONSTANTS } from './http2-constants.ts';

const notImpl = (feature: string) => () => {
  throw new NotImplementedError(feature);
};

interface ReadlineWritable {
  write(chunk: string): boolean;
}

type ReadlineCallback = () => void;

interface ReadlineReadable extends EventEmitter {
  setEncoding?(encoding: string): void;
  resume?(): void;
  pause?(): void;
}

interface ReadlineOptions {
  readonly input: ReadlineReadable;
  readonly output?: ReadlineWritable;
  readonly prompt?: string;
}

type CreateInterfaceArgs = ReadlineReadable | ReadlineOptions;

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

function isReadlineOptions(value: CreateInterfaceArgs): value is ReadlineOptions {
  return typeof (value as ReadlineOptions).input !== 'undefined';
}

function resolveReadlineOptions(
  inputOrOptions: CreateInterfaceArgs,
  output?: ReadlineWritable,
): ReadlineOptions {
  if (isReadlineOptions(inputOrOptions)) return inputOrOptions;
  return { input: inputOrOptions, output };
}

const READLINE_DECODER = new TextDecoder();

function decodeReadlineChunk(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return READLINE_DECODER.decode(chunk);
  if (chunk instanceof ArrayBuffer) return READLINE_DECODER.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return READLINE_DECODER.decode(
      new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    );
  }
  return String(chunk);
}

export class Interface extends EventEmitter {
  readonly input: ReadlineReadable;
  readonly output?: ReadlineWritable;
  line = '';
  #closed = false;
  #prompt: string;
  #questionCallbacks: Array<(answer: string) => void> = [];
  readonly #onData = (chunk: unknown): void => {
    this.#acceptChunk(decodeReadlineChunk(chunk));
  };
  readonly #onEnd = (): void => {
    if (this.line.length > 0) {
      this.#emitLine(this.line);
      this.line = '';
    }
    this.close();
  };

  constructor(options: ReadlineOptions) {
    super();
    this.input = options.input;
    this.output = options.output;
    this.#prompt = options.prompt ?? '';
    this.input.setEncoding?.('utf8');
    this.input.on('data', this.#onData);
    this.input.once('end', this.#onEnd);
    this.input.once('close', this.#onEnd);
    this.input.resume?.();
  }

  question(query: string, cb: (answer: string) => void): void {
    if (this.#closed) throw new Error('readline.Interface is closed');
    this.output?.write(query);
    this.#questionCallbacks.push(cb);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.input.off('data', this.#onData);
    this.input.off('end', this.#onEnd);
    this.input.off('close', this.#onEnd);
    this.input.pause?.();
    this.emit('close');
  }

  pause(): this {
    this.input.pause?.();
    return this;
  }

  resume(): this {
    this.input.resume?.();
    return this;
  }

  prompt(): void {
    if (this.#prompt.length > 0) this.output?.write(this.#prompt);
  }

  setPrompt(prompt: string): void {
    this.#prompt = prompt;
  }

  getPrompt(): string {
    return this.#prompt;
  }

  #acceptChunk(text: string): void {
    let pending = this.line + text;
    while (pending.length > 0) {
      const nl = pending.search(/\r\n|\n|\r/u);
      if (nl === -1) {
        this.line = pending;
        return;
      }
      const sep = pending[nl] === '\r' && pending[nl + 1] === '\n' ? 2 : 1;
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + sep);
      this.#emitLine(line);
    }
    this.line = '';
  }

  #emitLine(line: string): void {
    const question = this.#questionCallbacks.shift();
    if (question) {
      question(line);
      return;
    }
    this.emit('line', line);
  }
}

function createInterface(
  inputOrOptions: CreateInterfaceArgs,
  output?: ReadlineWritable,
): Interface {
  return new Interface(resolveReadlineOptions(inputOrOptions, output));
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
  createInterface,
  Interface,
  cursorTo,
  moveCursor,
  clearLine,
  clearScreenDown,
  emitKeypressEvents: notImpl('readline.emitKeypressEvents'),
};
