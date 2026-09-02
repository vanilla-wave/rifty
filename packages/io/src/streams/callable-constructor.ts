import { getDefaultHighWaterMark } from './default-highwatermark.ts';
import type { Readable, ReadableOptions, ReadableState } from './readable.ts';
import type { Writable, WritableOptions, WritableState, WriteChunk } from './writable.ts';

interface StreamImplementation<Instance extends object, Options> {
  new (options?: Options): Instance;
  readonly prototype: Instance;
}

export type CallableStreamConstructor<
  Implementation extends StreamImplementation<Instance, Options>,
  Instance extends object,
  Options,
> = Implementation & {
  (options?: Options): Instance;
  (this: Instance, options?: Options): void;
};

/** Publish one class implementation through Node's callable constructor ABI. */
export function makeCallableStreamConstructor<
  Instance extends object,
  Options,
  Implementation extends StreamImplementation<Instance, Options>,
>(
  name: string,
  implementation: Implementation,
  initializeReceiver: (receiver: Instance, options?: Options) => void,
): CallableStreamConstructor<Implementation, Instance, Options> {
  const callable = function publishedConstructor(
    this: Instance | undefined,
    options?: Options,
  ): Instance | undefined {
    if (!(this instanceof publishedConstructor)) {
      return Reflect.construct(publishedConstructor, [options]) as Instance;
    }
    initializeReceiver(this, options);
  };

  callable.prototype = implementation.prototype;
  Object.defineProperty(implementation.prototype, 'constructor', {
    configurable: true,
    value: callable,
    writable: true,
  });
  for (const key of Reflect.ownKeys(implementation)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue;
    const descriptor = Object.getOwnPropertyDescriptor(implementation, key);
    if (descriptor) Object.defineProperty(callable, key, descriptor);
  }
  Object.setPrototypeOf(callable, Object.getPrototypeOf(implementation));
  Object.defineProperty(callable, 'name', { configurable: true, value: name });

  return callable as CallableStreamConstructor<Implementation, Instance, Options>;
}

interface ReadableInitializationTarget {
  _readableState: ReadableState;
  readMoreScheduled: boolean;
  readableScheduled: boolean;
  endScheduled: boolean;
  encodingState: unknown;
  pipeCleanups: Map<unknown, () => void>;
  _read: NonNullable<ReadableOptions['read']>;
  on(event: 'newListener', listener: (event: string | symbol) => void): unknown;
  rawListeners(event: 'newListener'): Array<(event: string | symbol) => void>;
  setEncoding(encoding: string): unknown;
  scheduleFlow(): void;
  scheduleReadable(): void;
  maybeRead(): void;
}

function handleReadableNewListener(
  this: ReadableInitializationTarget,
  event: string | symbol,
): void {
  if (event === 'data' && this._readableState.flowing === null) {
    this._readableState.flowing = true;
    this.scheduleFlow();
  } else if (event === 'readable' && !this._readableState.endEmitted) {
    queueMicrotask(() => {
      const state = this._readableState;
      if (state.destroyed || state.endEmitted) return;
      if (state.buffer.length > 0 || state.ended) this.scheduleReadable();
      if (!state.ended) this.maybeRead();
    });
  }
}

export function initializeReadable(receiver: Readable, options: ReadableOptions = {}): void {
  const target = receiver as unknown as ReadableInitializationTarget;
  const objectMode = options.objectMode ?? false;
  target._readableState = {
    buffer: [],
    length: 0,
    highWaterMark: options.highWaterMark ?? getDefaultHighWaterMark(objectMode),
    objectMode,
    flowing: null,
    ended: false,
    endEmitted: false,
    reading: false,
    destroyed: false,
    errored: null,
    disturbed: false,
    flowScheduled: false,
  };
  target.readMoreScheduled = false;
  target.readableScheduled = false;
  target.endScheduled = false;
  target.encodingState = null;
  target.pipeCleanups = new Map();
  if (options.read !== undefined) target._read = options.read;
  if (options.encoding) target.setEncoding(options.encoding);
  if (!target.rawListeners('newListener').includes(handleReadableNewListener)) {
    target.on('newListener', handleReadableNewListener);
  }
}

type WriteImplementation = (
  this: Writable,
  chunk: unknown,
  encoding: string,
  callback: (error?: Error | null) => void,
) => void;
type WritevImplementation = (
  this: Writable,
  chunks: WriteChunk[],
  callback: (error?: Error | null) => void,
) => void;
type FinalImplementation = (this: Writable, callback: (error?: Error | null) => void) => void;

interface WritableInitializationTarget {
  _writableState: WritableState;
  writeImpl?: WriteImplementation;
  writevImpl?: WritevImplementation;
  finalImpl?: FinalImplementation;
  endCallbacks: Array<(error?: Error | null) => void>;
}

export function initializeWritable(receiver: Writable, options: WritableOptions = {}): void {
  const target = receiver as unknown as WritableInitializationTarget;
  const objectMode = options.objectMode ?? false;
  target._writableState = {
    buffered: [],
    length: 0,
    highWaterMark: options.highWaterMark ?? getDefaultHighWaterMark(objectMode),
    objectMode,
    decodeStrings: options.decodeStrings !== false,
    writing: false,
    finalizing: false,
    ending: false,
    finished: false,
    destroyed: false,
    closed: false,
    errored: null,
    needDrain: false,
    corked: 0,
    drainScheduled: false,
    writevBatch: false,
  };
  if (typeof options.write === 'function') target.writeImpl = options.write;
  if (typeof options.writev === 'function') target.writevImpl = options.writev;
  if (typeof options.final === 'function') target.finalImpl = options.final;
  target.endCallbacks = [];
}
