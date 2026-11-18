/**
 * Bare-V8 Web globals the rifty runtime and the corpus need (ADR-0557 §5).
 * Imported first by the guest bundle: runtime modules capture timers and
 * codecs at load. Host work goes through the child's copying isolated-vm
 * Callbacks (`HostBridge`); no isolated-vm object reaches the guest.
 */
import { notImplemented } from './loud.ts';
import { TextDecoder, TextEncoder } from './text-codec.ts';

/** Functions the child installs as `globalThis.__riftyIsolateHost` (copying Callbacks). */
export interface HostBridge {
  write(fd: 1 | 2, bytes: Uint8Array): void;
  timerStart(id: number, ms: number, repeat: boolean): void;
  timerClear(id: number): void;
  now(): number;
  readonly timeOrigin: number;
  random(byteLength: number): Uint8Array;
  done(exitCode: number): void;
  /** The token the child sends for an unhandled rejection reason it cannot copy. */
  readonly uncopyableReason: string;
}

const g = globalThis as unknown as Record<string, unknown>;
export const bridge = g.__riftyIsolateHost as HostBridge;
if (typeof bridge?.write !== 'function') throw new Error('isolate-host guest: host bridge missing');
// Captured in this closure, then removed from the realm: guest code cannot call
// the host directly (`done` would bypass the process lifecycle) — ADR-0557 §6.
// biome-ignore lint/performance/noDelete: the property must be gone, not undefined.
delete g.__riftyIsolateHost;

// Built before guest code; `TextEncoder` here is the module's own class, and it
// allocates through a captured `Uint8Array` (text-codec.ts).
const hostEncoder = new TextEncoder();

/**
 * UTF-8 bytes straight to the host, bypassing anything the guest can replace
 * (the encoder and its allocations are primordial — text-codec.ts).
 */
export function writeHost(fd: 1 | 2, text: string): void {
  bridge.write(fd, hostEncoder.encode(text));
}

let uncaught: (error: unknown) => void = (error) => {
  throw error;
};
/** The runtime's uncaught-exception path for errors thrown by host-scheduled work. */
export function setUncaughtHandler(handler: (error: unknown) => void): void {
  uncaught = handler;
}

function define(name: string, value: unknown): void {
  Object.defineProperty(g, name, { value, writable: true, configurable: true, enumerable: false });
}

function argType(name: string, expected: string, value: unknown): TypeError {
  return Object.assign(
    new TypeError(`The "${name}" argument must be ${expected}. Received ${typeof value}`),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

// --- DOMException (WebIDL legacy codes) ---
const LEGACY_CODES: Readonly<Record<string, number>> = {
  IndexSizeError: 1,
  HierarchyRequestError: 3,
  WrongDocumentError: 4,
  InvalidCharacterError: 5,
  NoModificationAllowedError: 7,
  NotFoundError: 8,
  NotSupportedError: 9,
  InvalidStateError: 11,
  SyntaxError: 12,
  InvalidModificationError: 13,
  NamespaceError: 14,
  InvalidAccessError: 15,
  TypeMismatchError: 17,
  SecurityError: 18,
  NetworkError: 19,
  AbortError: 20,
  URLMismatchError: 21,
  QuotaExceededError: 22,
  TimeoutError: 23,
  InvalidNodeTypeError: 24,
  DataCloneError: 25,
};
class DOMException extends Error {
  readonly #name: string;
  constructor(message = '', name = 'Error') {
    super(String(message));
    this.#name = String(name);
  }
  override get name(): string {
    return this.#name;
  }
  get code(): number {
    return LEGACY_CODES[this.#name] ?? 0;
  }
}
define('DOMException', DOMException);

// --- base64 (forgiving-base64, HTML) ---
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const invalidCharacter = (): DOMException =>
  new DOMException('Invalid character', 'InvalidCharacterError');
function missing(name: string): TypeError {
  return Object.assign(new TypeError(`The "${name}" argument must be specified`), {
    code: 'ERR_MISSING_ARGS',
  });
}
define('atob', function atob(...args: unknown[]): string {
  if (args.length === 0) throw missing('input');
  let s = String(args[0]).replace(/[\t\n\f\r ]/g, '');
  if (s.length % 4 === 0) s = s.replace(/={1,2}$/, '');
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) throw invalidCharacter();
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
});
define('btoa', function btoa(...args: unknown[]): string {
  if (args.length === 0) throw missing('input');
  const s = String(args[0]);
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) : -1;
    if (a > 0xff || b > 0xff || c > 0xff) throw invalidCharacter();
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
    out += b < 0 ? '=' : B64[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
    out += c < 0 ? '=' : B64[c & 63];
  }
  return out;
});

define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);

// --- task scheduling ---
define('queueMicrotask', function queueMicrotask(callback: unknown): void {
  if (typeof callback !== 'function') throw argType('callback', 'of type function', callback);
  Promise.resolve().then(() => {
    try {
      (callback as () => void)();
    } catch (error) {
      uncaught(error);
    }
  });
});

/** A host-scheduled timer; expiry runs `_onTimeout`, as Node's `Timeout` does. */
class Timeout {
  constructor(
    readonly fn: (...args: unknown[]) => void,
    readonly args: readonly unknown[],
    readonly repeat: boolean,
  ) {}
  _onTimeout(): void {
    const fn = this.fn;
    fn(...this.args);
  }
}
const timers = new Map<number, Timeout>();
let nextTimerId = 1;
function startTimer(repeat: boolean, fn: unknown, ms: unknown, args: unknown[]): number {
  if (typeof fn !== 'function') throw argType('callback', 'of type function', fn);
  const id = nextTimerId++;
  timers.set(id, new Timeout(fn as Timeout['fn'], args, repeat));
  const delay = Number(ms);
  bridge.timerStart(id, Number.isFinite(delay) && delay > 0 ? delay : 0, repeat);
  return id;
}
function clearTimer(id: unknown): void {
  const key = Number(id);
  if (timers.delete(key)) bridge.timerClear(key);
}
define('setTimeout', (fn: unknown, ms?: unknown, ...args: unknown[]) =>
  startTimer(false, fn, ms, args),
);
define('setInterval', (fn: unknown, ms?: unknown, ...args: unknown[]) =>
  startTimer(true, fn, ms, args),
);
define('clearTimeout', clearTimer);
define('clearInterval', clearTimer);

/** Host timer expiry → the guest callback; a throw takes the uncaught path. */
export function fireTimer(id: number): void {
  const entry = timers.get(id);
  if (entry === undefined) return;
  if (!entry.repeat) timers.delete(id);
  try {
    entry._onTimeout();
  } catch (error) {
    uncaught(error);
  }
}

// --- performance, crypto ---
const loud = (feature: string) =>
  function notAvailable(): never {
    throw notImplemented(
      `isolate-host.${feature}`,
      'not available in the rifty isolate host, ADR-0557',
    );
  };
const performance: Record<string, unknown> = {
  now: () => bridge.now(),
  timeOrigin: bridge.timeOrigin,
  toJSON: () => ({ timeOrigin: bridge.timeOrigin }),
};
for (const member of [
  'mark',
  'measure',
  'getEntries',
  'getEntriesByName',
  'getEntriesByType',
  'clearMarks',
  'clearMeasures',
  'eventLoopUtilization',
  'timerify',
]) {
  performance[member] = loud(`performance.${member}`);
}
define('performance', performance);

const INTEGER_VIEWS = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  BigInt64Array,
  BigUint64Array,
];
const crypto = {
  getRandomValues<T extends ArrayBufferView>(view: T): T {
    if (!INTEGER_VIEWS.some((Ctor) => view instanceof Ctor)) {
      throw new DOMException(
        'The data argument must be an integer-type TypedArray',
        'TypeMismatchError',
      );
    }
    if (view.byteLength > 65536) {
      throw new DOMException(
        `The ArrayBufferView's byte length (${view.byteLength}) exceeds the number of bytes of entropy available via this API (65536)`,
        'QuotaExceededError',
      );
    }
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(
      bridge.random(view.byteLength),
    );
    return view;
  },
  randomUUID(): string {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = ((b[6] as number) & 0x0f) | 0x40;
    b[8] = ((b[8] as number) & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
};
define('crypto', crypto);

/**
 * Node globals this host does not provide (ADR-0557 §5, closed list). Installed
 * after the runtime loaded — its module-load feature detection must still see
 * them absent — and before guest code, which then gets a loud, named throw.
 */
export const CEILING_GLOBALS = [
  'URL',
  'URLSearchParams',
  'structuredClone',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'TextDecoderStream',
  'TextEncoderStream',
  'CompressionStream',
  'DecompressionStream',
  'AbortController',
  'AbortSignal',
  'EventTarget',
  'Event',
  'CustomEvent',
  'Blob',
  'File',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'WebSocket',
  'MessageChannel',
  'MessagePort',
  'BroadcastChannel',
  // Node 24 globals the corpus does not need (live list: tests/parity.test.ts).
  'ReadableStreamDefaultReader',
  'ReadableStreamBYOBReader',
  'ReadableStreamBYOBRequest',
  'ReadableByteStreamController',
  'ReadableStreamDefaultController',
  'TransformStreamDefaultController',
  'WritableStreamDefaultWriter',
  'WritableStreamDefaultController',
  'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
  'CloseEvent',
  'MessageEvent',
  'URLPattern',
  'Crypto',
  'CryptoKey',
  'SubtleCrypto',
  'Navigator',
  'Performance',
  'PerformanceEntry',
  'PerformanceMark',
  'PerformanceMeasure',
  'PerformanceObserver',
  'PerformanceObserverEntryList',
  'PerformanceResourceTiming',
] as const;

/** `navigator` members Node 24 defines; each read is the named gap. */
const NAVIGATOR_MEMBERS = ['hardwareConcurrency', 'language', 'languages', 'platform', 'userAgent'];

export function installCeilingGlobals(): void {
  for (const name of CEILING_GLOBALS) {
    const thrower = loud(name);
    Object.defineProperty(thrower, 'name', { value: name });
    define(name, thrower);
  }
  Object.defineProperty(crypto, 'subtle', { get: loud('crypto.subtle'), configurable: true });
  const navigator = {};
  for (const member of NAVIGATOR_MEMBERS) {
    Object.defineProperty(navigator, member, {
      get: loud(`navigator.${member}`),
      enumerable: true,
    });
  }
  define('navigator', navigator);
  Object.defineProperty(performance, 'nodeTiming', {
    get: loud('performance.nodeTiming'),
    configurable: true,
  });
  const fetchFeature = loud('fetch');
  define('fetch', function fetch(): Promise<never> {
    try {
      return fetchFeature();
    } catch (error) {
      return Promise.reject(error);
    }
  });
}
