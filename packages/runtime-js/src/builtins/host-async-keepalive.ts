/**
 * Event-loop keepalive for host-task-async Node-surface requests (ADR-0529,
 * extends ADR-0152 §1). libuv counts a pending threadpool/platform request as
 * active; in the child realm these settle on a host task, so the drain reaped
 * the realm before they settled (silent drop). Each pending request holds one
 * ref until it settles: Blob/File body reads, WebAssembly compile/instantiate,
 * SubtleCrypto, reads of host-backed streams and Response/Request bodies, and
 * an unclosed global WebSocket. Microtask-settled builtins (`fs.promises` sync
 * RPC, `node:zlib` over Chromium's synchronous CompressionStream) need no ref.
 *
 * Wrappers are Proxies over the realm's own functions; `Function#toString`
 * reports the wrapped native text. A held call returns a settle-tracked copy
 * of the native promise, so an unhandled rejection stays the caller's.
 */

import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';

type AnyFunction = (...args: unknown[]) => unknown;
type Construct = new (...args: unknown[]) => object;

const promiseThen = Promise.prototype.then;
const reflectApply = Reflect.apply;
const reflectConstruct = Reflect.construct;
const BODY_CONSUMERS = ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const;
const BLOB_READS = ['arrayBuffer', 'bytes', 'text'] as const;

interface HostAsyncTarget {
  Function?: typeof Function;
  Blob?: typeof Blob;
  Response?: typeof Response;
  Request?: typeof Request;
  ReadableStream?: typeof ReadableStream;
  ReadableStreamDefaultReader?: typeof ReadableStreamDefaultReader;
  ReadableStreamBYOBReader?: typeof ReadableStreamBYOBReader;
  WebAssembly?: Pick<typeof WebAssembly, 'compile' | 'instantiate'>;
  SubtleCrypto?: typeof SubtleCrypto;
  WebSocket?: typeof WebSocket;
}

/** Wrapper → wrapped native function, for `Function#toString`. */
const originals = new WeakMap<object, object>();
/** Native streams whose reads wait on host data (Blob streams, host-backed bodies). */
const hostStreams = new WeakSet<object>();
const hostReaders = new WeakSet<object>();
const hostIterators = new WeakSet<object>();
/** Response/Request objects whose body source is host data, not a guest stream. */
const hostBodies = new WeakSet<object>();

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
  const proxy = new Proxy(original, handler);
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

/** Record the result of `original` in `set` when `self` is counted. */
function registering(set: WeakSet<object>, counts: (self: unknown) => boolean) {
  return (original: AnyFunction, self: unknown, args: unknown[]): unknown => {
    const result = reflectApply(original, self, args);
    if (counts(self) && isObject(result)) set.add(result);
    return result;
  };
}

/** Proxy a global constructor; `X.prototype.constructor === X` stays true, as in Node. */
function wrapConstructor(
  target: HostAsyncTarget,
  name:
    | 'Response'
    | 'Request'
    | 'WebSocket'
    | 'ReadableStreamDefaultReader'
    | 'ReadableStreamBYOBReader',
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

/**
 * Reads of host streams: readers (`getReader()` or direct constructors), async
 * iteration and `tee()` branches hold per pending read. `pipeTo`/`pipeThrough`
 * pipe through a tap that holds only while its host read is pending, so a pipe
 * waiting on a guest sink or transform holds nothing, as in Node.
 */
function installStreamKeepalive(target: HostAsyncTarget): void {
  const ReadableStreamCtor = target.ReadableStream;
  if (ReadableStreamCtor === undefined) return;
  const stream = ReadableStreamCtor.prototype;
  const nativeGetReader = stream.getReader as AnyFunction;
  const lockedGetter = Object.getOwnPropertyDescriptor(stream, 'locked')?.get as AnyFunction;
  const reader = target.ReadableStreamDefaultReader?.prototype;
  if (reader === undefined) return;
  const nativeRead = reader.read as AnyFunction;
  const nativeCancel = reader.cancel as AnyFunction;
  const nativeReleaseLock = reader.releaseLock as AnyFunction;
  const isHost = (self: unknown): boolean => isObject(self) && hostStreams.has(self);
  const isHostReader = (self: unknown): boolean => isObject(self) && hostReaders.has(self);
  wrapMethod(stream, 'getReader', registering(hostReaders, isHost));
  for (const name of ['ReadableStreamDefaultReader', 'ReadableStreamBYOBReader'] as const) {
    const prototype = wrapConstructor(target, name, (original, args, newTarget) => {
      const created = reflectConstruct(original, args, newTarget);
      if (isHost(args[0])) hostReaders.add(created);
      return created;
    });
    if (prototype !== undefined) holdMethod(prototype, 'read', isHostReader);
  }
  wrapMethod(stream, 'tee', (original, self, args) => {
    const branches = reflectApply(original, self, args) as object[];
    if (isHost(self)) for (const branch of branches) hostStreams.add(branch);
    return branches;
  });
  /** Lock `source` now (as the native pipe does) and expose it as a held-read tap. */
  const tap = (source: object): { readonly tap: ReadableStream; release(): void } => {
    const sourceReader = reflectApply(nativeGetReader, source, []) as object;
    const tapStream = new ReadableStreamCtor(
      {
        pull: (controller) =>
          reflectApply(promiseThen, hold(reflectApply(nativeRead, sourceReader, [])), [
            ({ done, value }: ReadableStreamReadResult<unknown>) => {
              if (done) controller.close();
              else controller.enqueue(value);
            },
            (error: unknown) => controller.error(error),
          ]) as Promise<void>,
        cancel: (reason) => reflectApply(nativeCancel, sourceReader, [reason]) as Promise<void>,
      },
      { highWaterMark: 0 },
    );
    const release = (): void => {
      try {
        reflectApply(nativeReleaseLock, sourceReader, []);
      } catch {
        // already released by cancel/close
      }
    };
    return { tap: tapStream, release };
  };
  const piping =
    (settle: (piped: unknown, release: () => void) => unknown) =>
    (original: AnyFunction, self: unknown, args: unknown[]): unknown => {
      if (!isHost(self) || reflectApply(lockedGetter, self, [])) {
        return reflectApply(original, self, args); // native refusal, native order
      }
      const { tap: tapStream, release } = tap(self as object);
      return settle(reflectApply(original, tapStream, args), release);
    };
  wrapMethod(
    stream,
    'pipeTo',
    piping((piped, release) =>
      reflectApply(promiseThen, piped, [
        (result: unknown) => {
          release();
          return result;
        },
        (error: unknown) => {
          release();
          throw error;
        },
      ]),
    ),
  );
  wrapMethod(
    stream,
    'pipeThrough',
    piping((readable) => readable),
  );
  const values = Object.getOwnPropertyDescriptor(stream, 'values')?.value as
    | AnyFunction
    | undefined;
  if (typeof values !== 'function') return;
  const iterator = Object.getPrototypeOf(
    reflectApply(values, new ReadableStreamCtor(), []),
  ) as object;
  holdMethod(iterator, 'next', (self) => isObject(self) && hostIterators.has(self));
  const sharesIterator = Reflect.get(stream, Symbol.asyncIterator) === values;
  wrapMethod(stream, 'values', registering(hostIterators, isHost));
  if (sharesIterator) {
    Object.defineProperty(stream, Symbol.asyncIterator, {
      ...Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator),
      value: Reflect.get(stream, 'values'),
    });
  } else wrapMethod(stream, Symbol.asyncIterator, registering(hostIterators, isHost));
}

/**
 * A body is host data unless it is a guest `ReadableStream` (a host stream counts):
 * Node exits with a read pending on an idle guest stream.
 */
function installBodyKeepalive(target: HostAsyncTarget, name: 'Response' | 'Request'): void {
  const lockedGetter = Object.getOwnPropertyDescriptor(
    target.ReadableStream?.prototype ?? {},
    'locked',
  )?.get as AnyFunction | undefined;
  const isGuestStream = (body: unknown): boolean => {
    if (lockedGetter === undefined || !isObject(body) || hostStreams.has(body)) return false;
    try {
      reflectApply(lockedGetter, body, []); // brand check: no Proxy trap runs
      return true;
    } catch {
      return false;
    }
  };
  const hostBody = (body: unknown): boolean => body != null && !isGuestStream(body);
  const counts = (self: unknown): boolean => isObject(self) && hostBodies.has(self);
  const ctor = target[name];
  const prototype = wrapConstructor(target, name, (original, args, newTarget) => {
    if (name === 'Response') {
      const response = reflectConstruct(original, args, newTarget);
      if (hostBody(args[0])) hostBodies.add(response);
      return response;
    }
    // Observe the native read of `init.body` instead of reading the accessor again.
    let body: unknown;
    const init = args[1];
    const observed = isObject(init)
      ? new Proxy(init, {
          get(source, key) {
            const value = Reflect.get(source, key, source);
            if (key === 'body') body = value;
            return value;
          },
        })
      : init;
    const request = reflectConstruct(
      original,
      args.length > 1 ? [args[0], observed, ...args.slice(2)] : args,
      newTarget,
    );
    if (body == null ? counts(args[0]) : hostBody(body)) hostBodies.add(request);
    return request;
  });
  if (prototype === undefined || ctor === undefined) return;
  if (name === 'Response')
    wrapMethod(
      ctor,
      'json',
      registering(hostBodies, () => true),
    );
  wrapMethod(prototype, 'clone', registering(hostBodies, counts));
  for (const consumer of BODY_CONSUMERS) holdMethod(prototype, consumer, counts);
  const body = Object.getOwnPropertyDescriptor(prototype, 'body');
  if (body?.get !== undefined) {
    Object.defineProperty(prototype, 'body', {
      ...body,
      get: wrapFunction(body.get, { apply: registering(hostStreams, counts) }),
    });
  }
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

/** Install once per child realm, beside `installFetchKeepalive`. */
export function installHostAsyncKeepalive(
  target: HostAsyncTarget = globalThis as HostAsyncTarget,
): void {
  installToStringMask(target);
  const always = (): boolean => true;
  const blob = target.Blob?.prototype;
  if (blob !== undefined) {
    for (const read of BLOB_READS) holdMethod(blob, read, always);
    wrapMethod(blob, 'stream', registering(hostStreams, always));
  }
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
  installStreamKeepalive(target);
  installBodyKeepalive(target, 'Response');
  installBodyKeepalive(target, 'Request');
  installWebSocketKeepalive(target);
}
