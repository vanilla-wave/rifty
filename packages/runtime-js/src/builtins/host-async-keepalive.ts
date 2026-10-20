import { runtimeProxy } from '../internal/proxy-identity.ts';
/** Host-I/O keepalive: Blob reads, WebAssembly, crypto, WebSocket and BroadcastChannel.
 * Fetch classes/bodies are JS-owned (ADR-0541); only actual host requests hold refs.
 */

import { HOST_BROADCAST_CHANNEL } from '@riftydev/io';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';

type AnyFunction = (...args: unknown[]) => unknown;
type Construct = new (...args: unknown[]) => object;

const promiseThen = Promise.prototype.then;
const reflectApply = Reflect.apply;
const reflectConstruct = Reflect.construct;
// Realm primordials for host Blob reads (guest patches cannot reach them).
const streamPrototype = typeof ReadableStream === 'function' ? ReadableStream.prototype : undefined;
const readerPrototype =
  typeof ReadableStreamDefaultReader === 'function'
    ? ReadableStreamDefaultReader.prototype
    : undefined;
const nativeGetReader = streamPrototype?.getReader as AnyFunction | undefined;
const nativeStreamCancel = streamPrototype?.cancel as AnyFunction | undefined;
const nativeRead = readerPrototype?.read as AnyFunction | undefined;
const nativeReaderCancel = readerPrototype?.cancel as AnyFunction | undefined;
const BLOB_READS = ['arrayBuffer', 'bytes', 'text'] as const;
const broadcastChannelName =
  typeof BroadcastChannel === 'function'
    ? Object.getOwnPropertyDescriptor(BroadcastChannel.prototype, 'name')?.get
    : undefined;

interface HostAsyncTarget {
  Function?: typeof Function;
  Blob?: typeof Blob;
  ReadableStream?: typeof ReadableStream;
  WebAssembly?: Pick<typeof WebAssembly, 'compile' | 'instantiate'>;
  SubtleCrypto?: typeof SubtleCrypto;
  WebSocket?: typeof WebSocket;
  BroadcastChannel?: typeof BroadcastChannel;
}

/** Wrapper → wrapped native function, for `Function#toString`. */
const originals = new WeakMap<object, object>();
const isObject = (value: unknown): value is object =>
  (typeof value === 'object' || typeof value === 'function') && value !== null;

/** One ref until the native promise settles; returns the tracked copy (rejection stays unhandled if unobserved). */
function hold<T>(value: T): T {
  let tracked: T;
  try {
    tracked = reflectApply(promiseThen, value, [
      (result: unknown) => {
        keepaliveUnref();
        return result;
      },
      (error: unknown) => {
        keepaliveUnref();
        throw error;
      },
    ]) as T;
  } catch {
    return value; // not a promise: nothing pending
  }
  keepaliveRef();
  return tracked;
}

function wrapFunction<F extends object>(original: F, handler: ProxyHandler<F>): F {
  const proxy = runtimeProxy(original, handler);
  originals.set(proxy, original);
  return proxy;
}

function wrapMethod(
  owner: object,
  name: PropertyKey,
  apply: (original: AnyFunction, self: unknown, args: unknown[]) => unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (typeof descriptor?.value !== 'function') return;
  Object.defineProperty(owner, name, {
    ...descriptor,
    value: wrapFunction(descriptor.value as AnyFunction, { apply }),
  });
}

function holdMethod(owner: object, name: PropertyKey, counts: (self: unknown) => boolean): void {
  wrapMethod(owner, name, (original, self, args) => {
    const result = reflectApply(original, self, args);
    return counts(self) ? hold(result) : result;
  });
}

/** Proxy a global constructor; `X.prototype.constructor === X` stays true, as in Node. */
function wrapConstructor(
  target: HostAsyncTarget,
  name: 'WebSocket' | 'BroadcastChannel',
  construct: (original: Construct, args: unknown[], newTarget: Construct) => object,
): object | undefined {
  const ctor = target[name] as unknown as Construct | undefined;
  if (typeof ctor !== 'function') return undefined;
  const proxy = wrapFunction(ctor, {
    construct: (original, args, newTarget) => construct(original, args, newTarget as Construct),
  });
  (target as Record<string, unknown>)[name] = proxy;
  const prototype = ctor.prototype as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  Object.defineProperty(prototype, 'constructor', { ...descriptor, value: proxy });
  return prototype;
}

function installToStringMask(target: HostAsyncTarget): void {
  const prototype = target.Function?.prototype;
  if (prototype === undefined) return;
  wrapMethod(prototype, 'toString', (original, self, args) =>
    reflectApply(original, (isObject(self) && originals.get(self)) || self, args),
  );
}

/** Brand checks run no Proxy traps or guest accessors. */
function branded(getter: AnyFunction | undefined, value: unknown): boolean {
  if (getter === undefined || !isObject(value)) return false;
  try {
    reflectApply(getter, value, ['']);
    return true;
  } catch {
    return false;
  }
}
/**
 * The one stream a guest sees over host blob data: every native consumer
 * (readers, async iteration, tee, pipes, bodies) works on it unchanged, and
 * only its pull — a pending host read — holds the loop.
 */
function holdReads(
  ReadableStreamCtor: typeof ReadableStream,
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let reader: object | null = null;
  const pull = (controller: ReadableByteStreamController): Promise<void> => {
    reader ??= reflectApply(nativeGetReader as AnyFunction, source, []) as object;
    return reflectApply(promiseThen, hold(reflectApply(nativeRead as AnyFunction, reader, [])), [
      ({ done, value }: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>) => {
        if (done) {
          controller.close();
          controller.byobRequest?.respond(0);
          return undefined;
        }
        if (value.byteLength === 0) return pull(controller);
        controller.enqueue(value);
        return undefined;
      },
      (error: unknown) => controller.error(error),
    ]) as Promise<void>;
  };
  const stream = new ReadableStreamCtor({
    type: 'bytes',
    pull,
    cancel: (reason) =>
      reader === null
        ? (reflectApply(nativeStreamCancel as AnyFunction, source, [reason]) as Promise<void>)
        : (reflectApply(nativeReaderCancel as AnyFunction, reader, [reason]) as Promise<void>),
  });
  return stream;
}

function installBlobKeepalive(target: HostAsyncTarget): void {
  const blob = target.Blob?.prototype;
  const ReadableStreamCtor = target.ReadableStream;
  if (blob === undefined) return;
  for (const read of BLOB_READS) holdMethod(blob, read, () => true);
  if (ReadableStreamCtor === undefined) return;
  wrapMethod(blob, 'stream', (original, self, args) => {
    const native = reflectApply(original, self, args) as ReadableStream<Uint8Array<ArrayBuffer>>;
    return holdReads(ReadableStreamCtor, native);
  });
}

function installWebSocketKeepalive(target: HostAsyncTarget): void {
  const addEventListener = EventTarget.prototype.addEventListener;
  const removeEventListener = EventTarget.prototype.removeEventListener;
  wrapConstructor(target, 'WebSocket', (original, args, newTarget) => {
    const socket = reflectConstruct(original, args, newTarget);
    // Native listener API: a subclass override must not run before its constructor.
    const release = (event: Event): void => {
      if (!event.isTrusted) return; // a synthetic `close` does not end the socket
      reflectApply(removeEventListener, socket, ['close', release]);
      keepaliveUnref();
    };
    reflectApply(addEventListener, socket, ['close', release]);
    keepaliveRef();
    return socket;
  });
}

/**
 * A Node `BroadcastChannel` is ref'd from construction until `close()`;
 * Node's `ref()`/`unref()` (absent natively) toggle the hold and return the channel.
 */
function installBroadcastChannelKeepalive(target: HostAsyncTarget): void {
  // rifty's own channels open the native constructor (`openHostBroadcastChannel`).
  if (
    typeof target.BroadcastChannel === 'function' &&
    !Object.hasOwn(target, HOST_BROADCAST_CHANNEL)
  ) {
    Object.defineProperty(target, HOST_BROADCAST_CHANNEL, { value: target.BroadcastChannel });
  }
  /** true = holding, false = unref'd; absent after close. */
  const held = new WeakMap<object, boolean>();
  const prototype = wrapConstructor(target, 'BroadcastChannel', (original, args, newTarget) => {
    const channel = reflectConstruct(original, args, newTarget);
    held.set(channel, true);
    keepaliveRef();
    return channel;
  });
  if (prototype === undefined) return;
  const toggle = (self: unknown, hold: boolean): unknown => {
    if (!isObject(self) || !branded(broadcastChannelName, self)) {
      const error = new TypeError(
        'Value of "this" must be of type BroadcastChannel',
      ) as TypeError & {
        code: string;
      };
      error.code = 'ERR_INVALID_THIS';
      throw error;
    }
    const state = held.get(self);
    if (state !== undefined && state !== hold) {
      held.set(self, hold);
      if (hold) keepaliveRef();
      else keepaliveUnref();
    }
    return self;
  };
  wrapMethod(prototype, 'close', (original, self, args) => {
    const result = reflectApply(original, self, args);
    if (isObject(self) && held.get(self) === true) keepaliveUnref();
    if (isObject(self)) held.delete(self);
    return result;
  });
  // Node's own class methods: non-enumerable, writable, configurable.
  for (const [name, hold] of [
    ['ref', true],
    ['unref', false],
  ] as const) {
    const method = {
      [name](this: unknown) {
        return toggle(this, hold);
      },
    }[name];
    Object.defineProperty(prototype, name, {
      value: method,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
}

/** Install once per child realm, beside `installFetchKeepalive`. */
export function installHostAsyncKeepalive(
  target: HostAsyncTarget = globalThis as HostAsyncTarget,
): void {
  installToStringMask(target);
  installBlobKeepalive(target);
  const always = (): boolean => true;
  const wasm = target.WebAssembly;
  if (wasm !== undefined) {
    holdMethod(wasm, 'compile', always);
    holdMethod(wasm, 'instantiate', always);
  }
  const subtle = target.SubtleCrypto?.prototype;
  if (subtle !== undefined) {
    for (const name of Object.getOwnPropertyNames(subtle)) {
      if (name !== 'constructor') holdMethod(subtle, name, always);
    }
  }
  installWebSocketKeepalive(target);
  installBroadcastChannelKeepalive(target);
}
