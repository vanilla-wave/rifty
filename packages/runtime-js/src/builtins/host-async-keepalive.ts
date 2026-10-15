/**
 * Event-loop keepalive for host-task-async Node-surface requests (ADR-0529,
 * extends ADR-0152 §1). libuv counts a pending threadpool/platform request as
 * active; in the child realm these settle on a host task, so the drain reaped
 * the realm before they settled (silent drop). Each pending request holds one
 * ref until it settles: Blob/File body reads, WebAssembly compile/instantiate,
 * SubtleCrypto, blob-backed Response/Request bodies, and an unclosed global
 * WebSocket. Microtask-settled work (`fs.promises` sync RPC, `node:zlib` over
 * Chromium's synchronous CompressionStream, string/bytes bodies) needs no ref.
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
const blobPrototype = typeof Blob === 'function' ? Blob.prototype : undefined;

const blobSize = blobPrototype && Object.getOwnPropertyDescriptor(blobPrototype, 'size')?.get;
const blobType = blobPrototype && Object.getOwnPropertyDescriptor(blobPrototype, 'type')?.get;
const nativeBlobStream = blobPrototype?.stream as AnyFunction | undefined;
const formDataHas = typeof FormData === 'function' ? FormData.prototype.has : undefined;
// Realm primordials for the wrappers' own stream/header work (guest patches cannot reach it).
const streamPrototype = typeof ReadableStream === 'function' ? ReadableStream.prototype : undefined;
const readerPrototype =
  typeof ReadableStreamDefaultReader === 'function'
    ? ReadableStreamDefaultReader.prototype
    : undefined;
const nativeGetReader = streamPrototype?.getReader as AnyFunction | undefined;
const nativeStreamCancel = streamPrototype?.cancel as AnyFunction | undefined;
const nativeRead = readerPrototype?.read as AnyFunction | undefined;
const nativeReaderCancel = readerPrototype?.cancel as AnyFunction | undefined;
const responsePrototype = typeof Response === 'function' ? Response.prototype : undefined;
const responseBody =
  responsePrototype && Object.getOwnPropertyDescriptor(responsePrototype, 'body')?.get;
const responseHeaders =
  responsePrototype && Object.getOwnPropertyDescriptor(responsePrototype, 'headers')?.get;
const requestPrototype = typeof Request === 'function' ? Request.prototype : undefined;
const requestHeaders =
  requestPrototype && Object.getOwnPropertyDescriptor(requestPrototype, 'headers')?.get;
const FileReaderSyncCtor = (globalThis as { FileReaderSync?: typeof FileReaderSync })
  .FileReaderSync;
const headersPrototype = typeof Headers === 'function' ? Headers.prototype : undefined;
const headersGet = headersPrototype?.get as AnyFunction | undefined;
const headersHas = headersPrototype?.has as AnyFunction | undefined;
const headersSet = headersPrototype?.set as AnyFunction | undefined;
const BLOB_READS = ['arrayBuffer', 'bytes', 'text'] as const;

interface HostAsyncTarget {
  Function?: typeof Function;
  Blob?: typeof Blob;
  Response?: typeof Response;
  Request?: typeof Request;
  ReadableStream?: typeof ReadableStream;
  WebAssembly?: Pick<typeof WebAssembly, 'compile' | 'instantiate'>;
  SubtleCrypto?: typeof SubtleCrypto;
  WebSocket?: typeof WebSocket;
}

/** Wrapper → wrapped native function, for `Function#toString`. */
const originals = new WeakMap<object, object>();
/** In-guest Requests whose body is blob-backed host data. */
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

/** Proxy a global constructor; `X.prototype.constructor === X` stays true, as in Node. */
function wrapConstructor(
  target: HostAsyncTarget,
  name: 'Response' | 'Request' | 'WebSocket',
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
const isBlob = (value: unknown): value is Blob => branded(blobSize, value);
const isFormData = (value: unknown): value is FormData =>
  branded(formDataHas as AnyFunction | undefined, value);

/**
 * The one stream a guest sees over host blob data: every native consumer
 * (readers, async iteration, tee, pipes, bodies) works on it unchanged, and
 * only its pull — a pending host read — holds the loop.
 */
function holdReads(
  ReadableStreamCtor: typeof ReadableStream,
  /** Resolved at the first pull or cancel (a Response body is encoded after its init). */
  source: () => ReadableStream<Uint8Array<ArrayBuffer>>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let reader: object | null = null;
  const pull = (controller: ReadableByteStreamController): Promise<void> => {
    reader ??= reflectApply(nativeGetReader as AnyFunction, source(), []) as object;
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
  return new ReadableStreamCtor({
    type: 'bytes',
    pull,
    cancel: (reason) =>
      reader === null
        ? (reflectApply(nativeStreamCancel as AnyFunction, source(), [reason]) as Promise<void>)
        : (reflectApply(nativeReaderCancel as AnyFunction, reader, [reason]) as Promise<void>),
  });
}

function installBlobKeepalive(target: HostAsyncTarget): void {
  const blob = target.Blob?.prototype;
  const ReadableStreamCtor = target.ReadableStream;
  if (blob === undefined) return;
  for (const read of BLOB_READS) holdMethod(blob, read, () => true);
  if (ReadableStreamCtor === undefined) return;
  wrapMethod(blob, 'stream', (original, self, args) => {
    const native = reflectApply(original, self, args) as ReadableStream<Uint8Array<ArrayBuffer>>;
    return holdReads(ReadableStreamCtor, () => native);
  });
}

/**
 * A blob-backed Response is built natively over the held blob stream (its
 * `body`, locking, clone and consumers stay native); the content type the
 * native body extraction would set is kept. String/bytes bodies settle
 * without a host task and stay native as given.
 */
function installResponseKeepalive(target: HostAsyncTarget): void {
  const ReadableStreamCtor = target.ReadableStream;
  if (
    ReadableStreamCtor === undefined ||
    nativeBlobStream === undefined ||
    responseBody === undefined ||
    responseHeaders === undefined
  ) {
    return;
  }
  const headers = (response: object): object =>
    reflectApply(responseHeaders, response, []) as object;
  const keepType = (response: object, type: string | null): void => {
    if (
      type !== null &&
      !reflectApply(headersHas as AnyFunction, headers(response), ['content-type'])
    ) {
      reflectApply(headersSet as AnyFunction, headers(response), ['content-type', type]);
    }
  };
  wrapConstructor(target, 'Response', (original, args, newTarget) => {
    const body = args[0];
    if (isBlob(body)) {
      const native = reflectApply(nativeBlobStream, body, []) as ReadableStream<
        Uint8Array<ArrayBuffer>
      >;
      const response = reflectConstruct(
        original,
        [holdReads(ReadableStreamCtor, () => native), ...args.slice(1)],
        newTarget,
      );
      keepType(response, (reflectApply(blobType as AnyFunction, body, []) as string) || null);
      return response;
    }
    if (!isFormData(body)) return reflectConstruct(original, args, newTarget);
    let encoded: object | null = null;
    const response = reflectConstruct(
      original,
      [
        holdReads(
          ReadableStreamCtor,
          () => reflectApply(responseBody, encoded, []) as ReadableStream<Uint8Array<ArrayBuffer>>,
        ),
        ...args.slice(1),
      ],
      newTarget,
    );
    // Native extraction encodes after the init conversion, before the constructor
    // returns: encode here, before any guest code can change the FormData.
    encoded = reflectConstruct(original, [body]);
    keepType(
      response,
      reflectApply(headersGet as AnyFunction, headers(encoded), ['content-type']) as string | null,
    );
    return response;
  });
}

/**
 * An in-guest Request keeps a native body (a stream body would change how
 * `fetch(request)` sends it). A Blob/File body is read synchronously
 * (`FileReaderSync`, dedicated workers) into the same bytes plus its content
 * type, so its reads need no host task; a FormData body holds its consumer
 * methods. `init.body` is observed during the native read, never read twice.
 */
function installRequestKeepalive(target: HostAsyncTarget): void {
  const counts = (self: unknown): boolean => isObject(self) && hostBodies.has(self);
  const prototype = wrapConstructor(target, 'Request', (original, args, newTarget) => {
    let body: unknown;
    let type: string | null = null;
    const init = args[1];
    const observed = isObject(init)
      ? new Proxy(init, {
          get(source, key) {
            const value = Reflect.get(source, key, source);
            if (key !== 'body') return value;
            body = value;
            if (!isBlob(value) || FileReaderSyncCtor === undefined) return value;
            type = (reflectApply(blobType as AnyFunction, value, []) as string) || null;
            return new FileReaderSyncCtor().readAsArrayBuffer(value);
          },
        })
      : init;
    const request = reflectConstruct(
      original,
      args.length > 1 ? [args[0], observed, ...args.slice(2)] : args,
      newTarget,
    );
    if (type !== null && requestHeaders !== undefined) {
      const headers = reflectApply(requestHeaders, request, []) as object;
      if (!reflectApply(headersHas as AnyFunction, headers, ['content-type'])) {
        reflectApply(headersSet as AnyFunction, headers, ['content-type', type]);
      }
    }
    const blobRead = isBlob(body) && FileReaderSyncCtor !== undefined;
    if (body == null ? counts(args[0]) : !blobRead && (isBlob(body) || isFormData(body))) {
      hostBodies.add(request);
    }
    return request;
  });
  if (prototype === undefined) return;
  wrapMethod(prototype, 'clone', (original, self, args) => {
    const copy = reflectApply(original, self, args) as object;
    if (counts(self)) hostBodies.add(copy);
    return copy;
  });
  for (const consumer of BODY_CONSUMERS) holdMethod(prototype, consumer, counts);
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
  installResponseKeepalive(target);
  installRequestKeepalive(target);
  installWebSocketKeepalive(target);
}
