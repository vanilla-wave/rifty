/**
 * Event-loop keepalive for host-task-async Node-surface requests (ADR-0529,
 * extends ADR-0152 §1). libuv counts a pending threadpool/platform request as
 * active; in the child realm these settle on a host task, so the drain reaped
 * the realm before they settled (silent drop). Each pending request holds one
 * ref until it settles: Blob/File body reads, WebAssembly compile/instantiate,
 * SubtleCrypto, Response/Request bodies not backed by a guest stream, and an
 * unclosed global WebSocket. Microtask-settled builtins (`fs.promises` sync RPC,
 * `node:zlib` over Chromium's synchronous CompressionStream) need no ref.
 */

import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';

const promiseThen = Promise.prototype.then;
const reflectApply = Reflect.apply;
const BODY_CONSUMERS = ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const;
const BLOB_READS = ['arrayBuffer', 'bytes', 'text'] as const;

interface HostAsyncTarget {
  Blob?: typeof Blob;
  Response?: typeof Response;
  Request?: typeof Request;
  WebAssembly?: Pick<typeof WebAssembly, 'compile' | 'instantiate'>;
  SubtleCrypto?: typeof SubtleCrypto;
  WebSocket?: typeof WebSocket;
}

/** Hold one ref until `value` settles; the observer branch swallows its own rejection. */
function hold<T>(value: T): T {
  if (typeof (value as { then?: unknown } | null)?.then !== 'function') return value;
  keepaliveRef();
  const release = (): void => keepaliveUnref();
  reflectApply(promiseThen, value, [release, release]);
  return value;
}

/** Replace `owner[name]` with a Proxy (name/length/`toString` preserved). */
function wrapMethod(
  owner: object,
  name: string,
  apply: (original: (...args: unknown[]) => unknown, self: unknown, args: unknown[]) => unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (typeof descriptor?.value !== 'function') return;
  Object.defineProperty(owner, name, {
    ...descriptor,
    value: new Proxy(descriptor.value, { apply }),
  });
}

function holdMethod(owner: object, name: string, counts: (self: unknown) => boolean): void {
  wrapMethod(owner, name, (original, self, args) => {
    const result = reflectApply(original, self, args);
    return counts(self) ? hold(result) : result;
  });
}

/** Proxy a global constructor; `X.prototype.constructor === X` stays true, as in Node. */
function wrapConstructor(
  target: HostAsyncTarget,
  name: 'Response' | 'Request' | 'WebSocket',
  construct: (instance: object, args: unknown[]) => void,
): object | undefined {
  const ctor = target[name] as (new (...args: unknown[]) => object) | undefined;
  if (typeof ctor !== 'function') return undefined;
  const proxy = new Proxy(ctor, {
    construct(original, args, newTarget) {
      const instance = Reflect.construct(original, args, newTarget) as object;
      construct(instance, args);
      return instance;
    },
  });
  (target as Record<string, unknown>)[name] = proxy;
  const prototype = ctor.prototype as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  Object.defineProperty(prototype, 'constructor', { ...descriptor, value: proxy });
  return prototype;
}

/**
 * Byte stream over a host-backed source: each pending read holds one ref, so an
 * idle consumer holds nothing (Node: an unread stream keeps no handle).
 */
function holdReads(
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | null = null;
  return new ReadableStream({
    type: 'bytes',
    pull(controller) {
      reader ??= source.getReader();
      const pull = (): Promise<void> =>
        hold((reader as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>).read()).then(
          ({ done, value }) => {
            if (done) {
              controller.close();
              controller.byobRequest?.respond(0);
              return;
            }
            if (value.byteLength === 0) return pull();
            controller.enqueue(value);
          },
        );
      return pull().catch((error: unknown) => controller.error(error));
    },
    cancel(reason) {
      return reader !== null ? reader.cancel(reason) : source.cancel(reason);
    },
  });
}

function holdStreamGetter(prototype: object, counts: (self: unknown) => boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'body');
  const get = descriptor?.get;
  if (descriptor === undefined || get === undefined) return;
  const wrapped = new WeakMap<
    ReadableStream<Uint8Array<ArrayBuffer>>,
    ReadableStream<Uint8Array<ArrayBuffer>>
  >();
  Object.defineProperty(prototype, 'body', {
    ...descriptor,
    get: new Proxy(get, {
      apply(original, self, args) {
        const source = reflectApply(original, self, args) as ReadableStream<
          Uint8Array<ArrayBuffer>
        > | null;
        if (source === null || !counts(self)) return source;
        let stream = wrapped.get(source);
        if (stream === undefined) {
          stream = holdReads(source);
          wrapped.set(source, stream);
        }
        return stream;
      },
    }),
  });
}

/**
 * Bodies whose source is host data (Blob, FormData, bytes, text) are host reads;
 * a guest `ReadableStream` body settles on the guest's own work and holds nothing.
 */
function installBodyKeepalive(
  target: HostAsyncTarget,
  name: 'Response' | 'Request',
  hostBacked: WeakSet<object>,
): void {
  const counts = (self: unknown): boolean =>
    typeof self === 'object' && self !== null && hostBacked.has(self);
  const ctor = target[name];
  const prototype = wrapConstructor(target, name, (instance, args) => {
    const body = name === 'Response' ? args[0] : (args[1] as { body?: unknown } | undefined)?.body;
    const fromInput = name === 'Request' && body === undefined && counts(args[0]);
    if (fromInput || (body != null && !(body instanceof ReadableStream))) hostBacked.add(instance);
  });
  if (prototype === undefined || ctor === undefined) return;
  const mark =
    (always: boolean) =>
    (original: (...args: unknown[]) => unknown, self: unknown, args: unknown[]): unknown => {
      const created = reflectApply(original, self, args) as object;
      if (always || counts(self)) hostBacked.add(created);
      return created;
    };
  if (name === 'Response') wrapMethod(ctor, 'json', mark(true));
  wrapMethod(prototype, 'clone', mark(false));
  for (const consumer of BODY_CONSUMERS) holdMethod(prototype, consumer, counts);
  holdStreamGetter(prototype, counts);
}

function installWebSocketKeepalive(target: HostAsyncTarget): void {
  wrapConstructor(target, 'WebSocket', (socket) => {
    keepaliveRef();
    (socket as WebSocket).addEventListener('close', () => keepaliveUnref(), { once: true });
  });
}

/** Install once per child realm, beside `installFetchKeepalive`. */
export function installHostAsyncKeepalive(
  target: HostAsyncTarget = globalThis as HostAsyncTarget,
): void {
  const always = (): boolean => true;
  const blob = target.Blob?.prototype;
  if (blob !== undefined) {
    for (const read of BLOB_READS) holdMethod(blob, read, always);
    wrapMethod(blob, 'stream', (original, self, args) =>
      holdReads(reflectApply(original, self, args) as ReadableStream<Uint8Array<ArrayBuffer>>),
    );
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
  const hostBacked = new WeakSet<object>();
  installBodyKeepalive(target, 'Response', hostBacked);
  installBodyKeepalive(target, 'Request', hostBacked);
  installWebSocketKeepalive(target);
}
