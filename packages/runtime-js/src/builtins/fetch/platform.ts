import { NotImplementedError } from '@riftydev/io';
import { toWellFormed } from '../../internal/posix-file-url.ts';
import { proxyIdentity } from '../../internal/proxy-identity.ts';
import { publicNodeProcess } from '../process-public.ts';
import type { NodeProcess } from '../process.ts';
import { isDisturbed as nodeStreamIsDisturbed } from '../stream.ts';

const key = Symbol.for('rifty.fetch.platform');

export interface FetchPlatformBindings {
  readonly isProxy: (value: unknown) => boolean;
  readonly isDisturbed: (value: unknown) => boolean;
  readonly prepareBodyAbort: (
    stream: ReadableStream<Uint8Array>,
  ) => ((reason: unknown) => void) | undefined;
  readonly finalizeBody: (stream: ReadableStream<Uint8Array>, reason: string) => void;
  readonly trackBody: (stream: ReadableStream<Uint8Array>) => void;
  readonly toUSVString: (value: string) => string;
  readonly isUSVString: (value: string) => boolean;
  readonly emitWarning: (message: string, options: { code: string }) => void;
}

/** Node's private predicates, scoped to Fetch; install before guest entry. */
export function installFetchPlatformBindings(): FetchPlatformBindings {
  const realm = globalThis as unknown as Record<symbol, FetchPlatformBindings | undefined>;
  const existing = realm[key];
  if (existing !== undefined) return existing;
  const identity = proxyIdentity();
  const NativeProxy = globalThis.Proxy;
  const NativeResponse = globalThis.Response;
  const apply = Reflect.apply;
  const then = Promise.prototype.then;
  const enqueueMicrotask = queueMicrotask;
  const ignore = (): void => {};
  const prototype = ReadableStream.prototype;
  const getReader = prototype.getReader;
  const nativeCancel = prototype.cancel;
  const releaseReader = ReadableStreamDefaultReader.prototype.releaseLock;
  const readerClosed = Object.getOwnPropertyDescriptor(
    ReadableStreamDefaultReader.prototype,
    'closed',
  )?.get;
  const methods = new WeakMap<object, object>();
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
      return apply(streamLocked as (this: unknown) => boolean, value, []) as boolean;
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
  // releaseLock rejects the SAME closed promise only while the stream is readable.
  // Terminal states replace it. No read, disturbance, await or persistent state.
  const inspect = (
    stream: ReadableStream<Uint8Array>,
  ): { readable: boolean; closed: Promise<unknown> } | undefined => {
    if (locked(stream) !== false) return undefined;
    trackBody(stream);
    const reader = apply(getReader, stream, []) as ReadableStreamDefaultReader<Uint8Array>;
    const before = apply(
      readerClosed as (this: unknown) => Promise<unknown>,
      reader,
      [],
    ) as Promise<unknown>;
    apply(then, before, [undefined, ignore]);
    apply(releaseReader, reader, []);
    const after = apply(
      readerClosed as (this: unknown) => Promise<unknown>,
      reader,
      [],
    ) as Promise<unknown>;
    apply(then, after, [undefined, ignore]);
    return { readable: before === after, closed: before };
  };
  const defaultCancel = (stream: ReadableStream<Uint8Array>): boolean => {
    let owner: object | null = stream;
    while (owner !== null && !identity.isProxy(owner)) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'cancel');
      if (descriptor !== undefined) {
        if (!Object.hasOwn(descriptor, 'value')) return false;
        const wrapped = methods.get(nativeCancel);
        return (
          descriptor.value === nativeCancel ||
          (wrapped !== undefined && descriptor.value === wrapped)
        );
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return false;
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
        return apply(bodyUsed as (this: Response) => boolean, witness, []) as boolean;
      return disturbed.has(stream) || isLocked;
    },
    prepareBodyAbort(stream: ReadableStream<Uint8Array>) {
      const state = inspect(stream);
      if (state === undefined) {
        // A caller-owned reader must stay locked. Native cancel would reject
        // ERR_INVALID_STATE, which Node ignores; custom cancel needs hidden state.
        if (locked(stream) === true && defaultCancel(stream)) return undefined;
        throw new NotImplementedError('fetch.abortBodyState');
      }
      if (!state.readable) return undefined;
      return (reason: unknown): void => {
        void stream.cancel(reason).catch((error: unknown) => {
          if ((error as { code?: unknown }).code !== 'ERR_INVALID_STATE') throw error;
        });
      };
    },
    finalizeBody(stream: ReadableStream<Uint8Array>, reason: string) {
      const state = inspect(stream);
      if (state === undefined) return;
      const cancel = (): void => {
        void stream.cancel(reason).catch(ignore);
      };
      if (state.readable) cancel();
      else apply(then, state.closed, [() => enqueueMicrotask(cancel), ignore]);
    },
    trackBody,
    toUSVString: toWellFormed,
    isUSVString: (value: string) => toWellFormed(value) === value,
    emitWarning: (message: string, options: { code: string }) =>
      (publicNodeProcess() as NodeProcess).emitWarning(message, options),
  });

  // Observe before public lock/disturb operations, including direct readers.
  // A custom tee may return an already locked stream: observe before that lock.
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
      const created = remember(
        new NativeProxy(descriptor.value, {
          apply(original, self, args) {
            trackBody(self);
            return Reflect.apply(original, self, args);
          },
        }),
      );
      methods.set(descriptor.value, created);
      wrapped = created;
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
