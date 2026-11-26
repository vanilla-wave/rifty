/**
 * The call-time half of `fs`'s async APIs: what Node v24.16.0's JS layer reads from its
 * arguments before the first binding call (`lib/fs.js`, `lib/internal/fs/promises.js`,
 * `lib/internal/fs/utils.js`), read here the same way — the same fields, through the same
 * accessors, as often — into primitives the operation runs on. Nothing of the caller's but
 * a view's data bytes reaches the operation.
 */
import { bytesToString } from '@riftydev/io';
import { invalidArgType } from '../internal/node-received.ts';
import { Buffer } from './buffer.ts';
import { type PathLike, pathToString } from './fs-path.ts';
import { utimesArgs } from './fs-times.ts';
import { isAnyArrayBuffer } from './view-bytes.ts';

type Options = Record<string, unknown>;

/** `getOptions`: a string is the encoding; an object is returned as it is, its `encoding` checked. */
export function getOptions(options: unknown, defaults: Options = {}): Options {
  if (options == null || typeof options === 'function') return defaults;
  if (typeof options === 'string') return { ...defaults, encoding: options };
  if (typeof options !== 'object')
    throw invalidArgType('"options" argument', 'one of type string or Object', options);
  const o = options as Options;
  if (o.encoding !== 'buffer') assertEncoding(o.encoding);
  if (o.signal !== undefined && (typeof o.signal !== 'object' || o.signal === null))
    throw invalidArgType('"options.signal" property', 'an instance of AbortSignal', o.signal);
  return o;
}

function assertEncoding(encoding: unknown): void {
  if (encoding && !Buffer.isEncoding(encoding as string)) {
    throw Object.assign(
      new TypeError(`The argument 'encoding' is invalid encoding. Received '${String(encoding)}'`),
      { code: 'ERR_INVALID_ARG_VALUE' },
    );
  }
}

/** `copyObject`: own and inherited enumerable keys. */
export function copyObject(source: Options): Options {
  const target: Options = {};
  for (const key in source) target[key] = source[key];
  return target;
}

/** `validateRmdirOptions`/`validateCpOptions`: an object or nothing, spread over the defaults. */
export function spreadOptions(options: unknown, defaults: Options): Options {
  if (options === undefined) return { ...defaults };
  if (typeof options !== 'object' || options === null || Array.isArray(options))
    throw invalidArgType('"options" argument', 'of type object', options);
  return { ...defaults, ...(options as Options) };
}

export function validateBoolean(value: unknown, name: string): void {
  if (typeof value !== 'boolean')
    throw invalidArgType(`"${name}" property`, 'of type boolean', value);
}

/** `getValidatedPath`: a string, a `Buffer` or a file `URL`, as the string it names. */
export function validatedPath(p: unknown, name = 'path'): string {
  // A view's text first: `pathToString`'s URL check needs a `URL` the isolate guest lacks
  // (`runtime-js/isolate-fs-buffer-path-throws`).
  if (p instanceof Uint8Array) return pathToString(bytesToString(p, 'utf8'));
  if (typeof p === 'string' || isUrl(p)) return pathToString(p as PathLike);
  throw invalidArgType(`"${name}" argument`, 'of type string or an instance of Buffer or URL', p);
}

function isUrl(p: unknown): boolean {
  return typeof p === 'object' && p !== null && typeof (p as { href?: unknown }).href === 'string';
}

/** A path or a file descriptor (`readFile`/`writeFile`/`appendFile`). */
export function pathOrFd(p: unknown): string | number {
  return typeof p === 'number' ? p : validatedPath(p);
}

/** A field Node reads twice at the call (a check, then the use). */
export const readTwice = (o: Options, key: string): unknown => {
  void o[key];
  return o[key];
};
const readFlag = (flag: unknown): string => (flag ?? 'r') as string;

/** Each async API's call-time record; `promise` picks Node's promise form's reads. */
export const at = {
  readFile(path: unknown, options: unknown, promise: boolean) {
    const o = getOptions(options, { flag: 'r' });
    // The callback form reads `encoding` at the call, the promise form after its open.
    const encoding = promise ? undefined : o.encoding;
    if (!promise) void o.signal;
    const flag = promise ? o.flag || 'r' : o.flag;
    void o.signal;
    const p = pathOrFd(path);
    return { path: p, flag: readFlag(flag), encoding: () => (promise ? o.encoding : encoding) };
  },
  writeFile(path: unknown, data: unknown, options: unknown, promise: boolean, flagDefault = 'w') {
    const o = getOptions(options, {
      encoding: 'utf8',
      mode: 0o666,
      flag: flagDefault,
      flush: false,
    });
    const flag = (o.flag || flagDefault) as string;
    const flush = o.flush ?? false;
    validateBoolean(flush, 'options.flush');
    // String data is encoded at the call; a view's bytes are read when the write runs (lib/fs:
    // its memory; fs/promises: through its JS `buffer`/`byteOffset`/`byteLength`, view-bytes.ts).
    if (isAnyArrayBuffer(data))
      throw invalidArgType(
        '"data" argument',
        'of type string or an instance of Buffer, TypedArray, or DataView',
        data,
      );
    const bytes =
      typeof data === 'string'
        ? Buffer.from(data, ((o.encoding as string) || 'utf8') as 'utf8')
        : (data as Uint8Array);
    if (promise) void o.signal;
    void o.signal;
    const mode = o.mode as number | undefined;
    // Node's promise form passes `options.encoding` to its handle write once the open settles.
    const late = () => {
      if (promise) void o.encoding;
    };
    return { path: pathOrFd(path), bytes, flag, mode, late, promise };
  },
  appendFile(path: unknown, data: unknown, options: unknown, promise: boolean) {
    const o = copyObject(getOptions(options, { encoding: 'utf8', mode: 0o666, flag: 'a' }));
    if (!o.flag || (!promise && typeof path === 'number')) o.flag = 'a';
    return at.writeFile(path, data, o, promise, 'a');
  },
  readdir(path: unknown, options: unknown, promise: boolean) {
    let o = getOptions(options);
    if (promise) o = copyObject(o);
    const p = validatedPath(path);
    if (!promise && o.recursive != null) validateBoolean(o.recursive, 'options.recursive');
    const recursive = Boolean(o.recursive);
    if (recursive && !promise) o = copyObject(o);
    void o.encoding;
    const withFileTypes = Boolean(promise ? o.withFileTypes : readTwice(o, 'withFileTypes'));
    return { path: p, withFileTypes, recursive };
  },
  mkdir(path: unknown, options: unknown, promise: boolean) {
    let mode: unknown = 0o777;
    let recursive: unknown = false;
    if (typeof options === 'number' || typeof options === 'string') mode = options;
    else if (promise) ({ recursive = false, mode = 0o777 } = (options ?? {}) as Options);
    else if (options) {
      const o = options as Options;
      if (o.recursive !== undefined) recursive = o.recursive;
      if (o.mode !== undefined) mode = o.mode;
    }
    validateBoolean(recursive, 'options.recursive');
    return { path: validatedPath(path), recursive: recursive as boolean, mode: mode as number };
  },
  rm(path: unknown, options: unknown) {
    const p = validatedPath(path);
    const o = spreadOptions(options, {
      retryDelay: 100,
      maxRetries: 0,
      recursive: false,
      force: false,
    });
    validateBoolean(o.recursive, 'options.recursive');
    validateBoolean(o.force, 'options.force');
    return { path: p, recursive: o.recursive as boolean, force: o.force as boolean };
  },
  rmdir(path: unknown, options: unknown, promise: boolean) {
    const p = validatedPath(path);
    // The callback form reads `recursive` first, then spreads the options; the promise form spreads.
    const first = promise ? undefined : (options as Options | undefined)?.recursive;
    const o = spreadOptions(options, { retryDelay: 100, maxRetries: 0, recursive: false });
    return { path: p, recursive: Boolean(promise ? o.recursive : first) };
  },
  stat(path: unknown, options: unknown, promise: boolean, lstat: boolean) {
    let o: Options = (options ?? { bigint: false, throwIfNoEntry: true }) as Options;
    if (!promise && !lstat) {
      o = typeof o !== 'object' ? {} : getOptions(o, { bigint: false });
      void o.signal;
    }
    const p = validatedPath(path);
    const bigint = promise ? o.bigint : readTwice(o, 'bigint');
    const throwIfNoEntry = lstat ? true : o.throwIfNoEntry;
    return {
      path: p,
      lstat,
      bigint: bigint as boolean,
      throwIfNoEntry: throwIfNoEntry as boolean,
      feature: `fs.${promise ? 'promises.' : ''}${lstat ? 'lstat' : 'stat'}.bigint`,
      // Node's promise `stat` reads `throwIfNoEntry` again once the binding settles.
      late: () => {
        if (promise && !lstat) void o.throwIfNoEntry;
      },
    };
  },
  realpath(path: unknown, options: unknown, promise: boolean) {
    const o = getOptions(options);
    // The promise form hands `encoding` to its binding at the call; the callback form encodes
    // its result after its lstat walk (`encodeRealpathResult`), reading the options then.
    const atCall = promise ? { encoding: o.encoding } : null;
    return {
      path: validatedPath(path),
      encode: (result: string): string | Buffer => encodeRealpathResult(result, atCall ?? o),
    };
  },
  /** `readlink`/`mkdtemp`: `getOptions(options).encoding`, then the path. */
  encodingOnly(path: unknown, options: unknown, name = 'path'): string {
    void getOptions(options).encoding;
    return validatedPath(path, name);
  },
  cp(src: unknown, dest: unknown, options: unknown) {
    const o = spreadOptions(options, {
      dereference: false,
      errorOnExist: false,
      force: true,
      preserveTimestamps: false,
      recursive: false,
      verbatimSymlinks: false,
    });
    for (const k of CP_BOOLEANS) validateBoolean(o[k], `options.${k}`);
    if (o.filter !== undefined && typeof o.filter !== 'function')
      throw invalidArgType('"options.filter" property', 'of type function', o.filter);
    return { src: validatedPath(src, 'src'), dest: validatedPath(dest, 'dest'), options: o };
  },
  utimes(path: unknown, atime: unknown, mtime: unknown) {
    const p = validatedPath(path);
    return { path: p, times: utimesArgs(atime as number, mtime as number) };
  },
};

const CP_BOOLEANS = [
  'dereference',
  'errorOnExist',
  'force',
  'preserveTimestamps',
  'recursive',
  'verbatimSymlinks',
] as const;

/** Node's `encodeRealpathResult`. */
function encodeRealpathResult(result: string, options: Options): string | Buffer {
  if (!options || !options.encoding || options.encoding === 'utf8') return result;
  const asBuffer = Buffer.from(result);
  if (options.encoding === 'buffer') return asBuffer;
  return asBuffer.toString(options.encoding as 'hex');
}
