import { proxyIdentity } from '../../internal/proxy-identity.ts';
import { isDisturbed as nodeStreamIsDisturbed } from '../stream.ts';

const key = Symbol.for('rifty.fetch.platform');

export interface FetchPlatformBindings {
  readonly isProxy: (value: unknown) => boolean;
  readonly isDisturbed: (value: unknown) => boolean;
  readonly trackBody: (stream: ReadableStream<Uint8Array>) => void;
}

/** Node's private predicates, scoped to Fetch; install before guest entry. */
export function installFetchPlatformBindings(): FetchPlatformBindings {
  const realm = globalThis as unknown as Record<symbol, FetchPlatformBindings | undefined>;
  const existing = realm[key];
  if (existing !== undefined) return existing;
  const identity = proxyIdentity();
  const NativeProxy = globalThis.Proxy;
  const NativeResponse = globalThis.Response;
  const streamLocked = Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'locked')?.get;
  const bodyUsed = Object.getOwnPropertyDescriptor(NativeResponse.prototype, 'bodyUsed')?.get;
  const witnesses = new WeakMap<object, Response>();
  const disturbed = new WeakSet<object>();

  const remember = <T extends object>(value: T): T => {
    identity.record(value, false);
    return value;
  };
  const isObject = (value: unknown): value is object =>
    (typeof value === 'object' && value !== null) || typeof value === 'function';
  const locked = (value: unknown): boolean | undefined => {
    try {
      return Reflect.apply(streamLocked as (this: unknown) => boolean, value, []) as boolean;
    } catch {
      return undefined;
    }
  };
  const trackBody = (value: unknown): void => {
    if (!isObject(value) || witnesses.has(value) || disturbed.has(value) || locked(value) !== false)
      return;
    try {
      witnesses.set(value, new NativeResponse(value as ReadableStream<Uint8Array>));
    } catch {
      disturbed.add(value);
    }
  };
  const bindings: FetchPlatformBindings = Object.freeze({
    isProxy: identity.isProxy,
    isDisturbed(value: unknown): boolean {
      const isLocked = locked(value);
      if (isLocked === undefined) return nodeStreamIsDisturbed(value);
      const stream = value as ReadableStream<Uint8Array>;
      trackBody(stream);
      const witness = witnesses.get(stream);
      if (witness !== undefined)
        return Reflect.apply(bodyUsed as (this: Response) => boolean, witness, []) as boolean;
      return disturbed.has(stream) || isLocked;
    },
    trackBody,
  });

  // Observe before public lock/disturb operations, including direct readers.
  // A custom tee may return an already locked stream: observe before that lock.
  const prototype = ReadableStream.prototype;
  const methods = new WeakMap<object, object>();
  for (const name of [
    'getReader',
    'cancel',
    'pipeTo',
    'pipeThrough',
    'tee',
    'values',
    Symbol.asyncIterator,
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (typeof descriptor?.value !== 'function') continue;
    let wrapped = methods.get(descriptor.value);
    if (wrapped === undefined) {
      wrapped = remember(
        new NativeProxy(descriptor.value, {
          apply(original, self, args) {
            trackBody(self);
            return Reflect.apply(original, self, args);
          },
        }),
      );
      methods.set(descriptor.value, wrapped);
    }
    Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
  }
  for (const name of ['ReadableStreamDefaultReader', 'ReadableStreamBYOBReader'] as const) {
    const Original = globalThis[name];
    const wrapped = remember(
      new NativeProxy(Original, {
        construct(original, args, newTarget) {
          trackBody(args[0]);
          return Reflect.construct(original, args, newTarget);
        },
      }),
    );
    Object.defineProperty(globalThis, name, {
      ...Object.getOwnPropertyDescriptor(globalThis, name),
      value: wrapped,
    });
    Object.defineProperty(Original.prototype, 'constructor', {
      ...Object.getOwnPropertyDescriptor(Original.prototype, 'constructor'),
      value: wrapped,
    });
  }

  Object.defineProperty(globalThis, key, { value: bindings });
  return bindings;
}
