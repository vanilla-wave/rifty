import { Buffer } from '../buffer.ts';
import { NotImplementedError } from '../errors.ts';

interface ReadableFromWebConfig {
  highWaterMark: number | undefined;
  encoding: string | undefined;
  objectMode: boolean;
}

interface WritableFromWebConfig {
  highWaterMark: number | undefined;
  objectMode: boolean;
  decodeStrings: boolean;
}

interface DuplexFromWebConfig extends ReadableFromWebConfig, WritableFromWebConfig {
  allowHalfOpen: boolean;
}

type SignalResult =
  | { kind: 'absent' }
  | { kind: 'supported' }
  | { kind: 'invalid' }
  | { kind: 'missing-method' }
  | { kind: 'raw'; error: unknown };

interface HighWaterMarkResult {
  value: number | undefined;
  invalid: boolean;
}

const readableLockedGetter = Object.getOwnPropertyDescriptor(
  ReadableStream.prototype,
  'locked',
)?.get;
const writableLockedGetter = Object.getOwnPropertyDescriptor(
  WritableStream.prototype,
  'locked',
)?.get;

function invalidArgType(key: string, expected: string): TypeError & { code: string } {
  const error = new TypeError(`The "${key}" argument must be ${expected}`) as TypeError & {
    code: string;
  };
  error.code = 'ERR_INVALID_ARG_TYPE';
  return error;
}

function invalidArgValue(key: string, value: unknown): TypeError & { code: string } {
  const error = new TypeError(
    `The argument '${key}' is invalid. Received ${String(value)}`,
  ) as TypeError & {
    code: string;
  };
  error.code = 'ERR_INVALID_ARG_VALUE';
  return error;
}

function hasBrand(value: unknown, getter: (() => boolean) | undefined): boolean {
  if (getter === undefined || value === null || typeof value !== 'object') return false;
  try {
    getter.call(value);
    return true;
  } catch {
    return false;
  }
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
  return hasBrand(value, readableLockedGetter);
}

function isWritableStream(value: unknown): value is WritableStream<unknown> {
  return hasBrand(value, writableLockedGetter);
}

function optionBag(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArgType('options', 'an object');
  }
  return value as Record<string, unknown>;
}

function validateBoolean(key: string, value: unknown): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw invalidArgType(key, 'of type boolean');
  }
}

function validateEncoding(value: unknown): asserts value is string | undefined {
  if (value !== undefined && !Buffer.isEncoding(value)) {
    throw invalidArgValue('encoding', value);
  }
}

function classifyHighWaterMark(value: unknown): HighWaterMarkResult {
  if (value === undefined || value === null) return { value: undefined, invalid: false };
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return { value, invalid: false };
  }
  return { value: undefined, invalid: true };
}

function classifySignal(signal: unknown): SignalResult {
  if (!signal) return { kind: 'absent' };
  if (typeof signal !== 'object') return { kind: 'invalid' };
  try {
    if (!('aborted' in signal)) return { kind: 'invalid' };
  } catch (error) {
    return { kind: 'raw', error };
  }

  let aborted: unknown;
  try {
    aborted = (signal as { aborted?: unknown }).aborted;
  } catch (error) {
    return { kind: 'raw', error };
  }
  if (aborted) return { kind: 'supported' };

  let addEventListener: unknown;
  try {
    addEventListener = (signal as { addEventListener?: unknown }).addEventListener;
  } catch (error) {
    return { kind: 'raw', error };
  }
  return typeof addEventListener === 'function'
    ? { kind: 'supported' }
    : { kind: 'missing-method' };
}

function rejectSupportedSignal(signal: SignalResult, feature: string): void {
  if (signal.kind === 'supported') throw new NotImplementedError(feature);
}

function validateAfterAcquisition(
  highWaterMark: HighWaterMarkResult,
  rawHighWaterMark: unknown,
  highWaterMarkKey: string,
  signal: SignalResult,
): void {
  if (highWaterMark.invalid) throw invalidArgValue(highWaterMarkKey, rawHighWaterMark);
  if (signal.kind === 'invalid') throw invalidArgType('signal', 'an AbortSignal');
  if (signal.kind === 'missing-method') {
    throw new TypeError('signal.addEventListener is not a function');
  }
  if (signal.kind === 'raw') throw signal.error;
}

export function acquireReadableFromWeb(
  source: unknown,
  options: unknown,
): { reader: ReadableStreamDefaultReader<unknown>; config: ReadableFromWebConfig } {
  if (!isReadableStream(source)) {
    throw invalidArgType('readableStream', 'an instance of ReadableStream');
  }
  const bag = optionBag(options);
  const rawHighWaterMark = bag.highWaterMark;
  const encoding = bag.encoding;
  const objectMode = bag.objectMode;
  const rawSignal = bag.signal;

  validateEncoding(encoding);
  validateBoolean('objectMode', objectMode);
  const highWaterMark = classifyHighWaterMark(rawHighWaterMark);
  const signal = highWaterMark.invalid ? { kind: 'absent' as const } : classifySignal(rawSignal);
  rejectSupportedSignal(signal, 'stream.Readable.fromWeb.signal');

  const reader = source.getReader();
  validateAfterAcquisition(highWaterMark, rawHighWaterMark, 'highWaterMark', signal);
  return {
    reader,
    config: {
      highWaterMark: highWaterMark.value,
      encoding,
      objectMode: objectMode ?? false,
    },
  };
}

export function acquireWritableFromWeb(
  source: unknown,
  options: unknown,
): { writer: WritableStreamDefaultWriter<unknown>; config: WritableFromWebConfig } {
  if (!isWritableStream(source)) {
    throw invalidArgType('writableStream', 'an instance of WritableStream');
  }
  const bag = optionBag(options);
  const rawHighWaterMark = bag.highWaterMark;
  const decodeStrings = bag.decodeStrings;
  const objectMode = bag.objectMode;
  const rawSignal = bag.signal;

  validateBoolean('objectMode', objectMode);
  validateBoolean('decodeStrings', decodeStrings);
  const highWaterMark = classifyHighWaterMark(rawHighWaterMark);
  const signal = highWaterMark.invalid ? { kind: 'absent' as const } : classifySignal(rawSignal);
  rejectSupportedSignal(signal, 'stream.Writable.fromWeb.signal');

  const writer = source.getWriter();
  validateAfterAcquisition(highWaterMark, rawHighWaterMark, 'highWaterMark', signal);
  return {
    writer,
    config: {
      highWaterMark: highWaterMark.value,
      objectMode: objectMode ?? false,
      decodeStrings: decodeStrings ?? true,
    },
  };
}

export function acquireDuplexFromWeb(
  pair: unknown,
  options: unknown,
): {
  writer: WritableStreamDefaultWriter<unknown>;
  reader: ReadableStreamDefaultReader<unknown>;
  config: DuplexFromWebConfig;
} {
  if (pair === null || typeof pair !== 'object' || Array.isArray(pair)) {
    throw invalidArgType('pair', 'an object containing readable and writable streams');
  }
  const readable = (pair as { readable?: unknown }).readable;
  const writable = (pair as { writable?: unknown }).writable;
  if (!isReadableStream(readable) || !isWritableStream(writable)) {
    throw invalidArgType('pair', 'an object containing readable and writable streams');
  }

  const bag = optionBag(options);
  const allowHalfOpen = bag.allowHalfOpen;
  const objectMode = bag.objectMode;
  const encoding = bag.encoding;
  const decodeStrings = bag.decodeStrings;
  const rawHighWaterMark = bag.highWaterMark;
  const rawSignal = bag.signal;

  validateBoolean('objectMode', objectMode);
  validateEncoding(encoding);
  const highWaterMark = classifyHighWaterMark(rawHighWaterMark);
  const signal = highWaterMark.invalid ? { kind: 'absent' as const } : classifySignal(rawSignal);
  rejectSupportedSignal(signal, 'stream.Duplex.fromWeb.signal');

  const writer = writable.getWriter();
  const reader = readable.getReader();
  validateAfterAcquisition(highWaterMark, rawHighWaterMark, 'readableHighWaterMark', signal);
  return {
    writer,
    reader,
    config: {
      allowHalfOpen: allowHalfOpen === undefined ? false : allowHalfOpen !== false,
      highWaterMark: highWaterMark.value,
      encoding,
      objectMode: objectMode ?? false,
      decodeStrings: decodeStrings !== false,
    },
  };
}
