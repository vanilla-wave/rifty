/**
 * Node-compatible `node:util` (subset). Backed by our REPL inspector for
 * `inspect`, and a small `format` shim that handles the printf-style %s/%d/%j
 * specifiers Node supports.
 */
import { inspect as inspectImpl } from '../repl/inspect.ts';

export const inspect = inspectImpl;

export function format(fmt: unknown, ...args: unknown[]): string {
  if (typeof fmt !== 'string') {
    return [fmt, ...args].map((a) => (typeof a === 'string' ? a : inspectImpl(a))).join(' ');
  }
  let i = 0;
  let result = '';
  let cursor = 0;
  while (cursor < fmt.length) {
    const idx = fmt.indexOf('%', cursor);
    if (idx === -1 || idx === fmt.length - 1) {
      result += fmt.slice(cursor);
      break;
    }
    result += fmt.slice(cursor, idx);
    const spec = fmt[idx + 1];
    if (spec === '%') {
      result += '%';
      cursor = idx + 2;
      continue;
    }
    if (i >= args.length) {
      result += `%${spec}`;
      cursor = idx + 2;
      continue;
    }
    const arg = args[i++];
    switch (spec) {
      case 's':
        result += typeof arg === 'string' ? arg : String(arg);
        break;
      case 'd':
      case 'i':
        result += Number(arg).toString();
        break;
      case 'f':
        result += Number(arg).toString();
        break;
      case 'j':
        try {
          result += JSON.stringify(arg);
        } catch {
          result += '[Circular]';
        }
        break;
      case 'o':
      case 'O':
        result += inspectImpl(arg);
        break;
      default:
        result += `%${spec}`;
        i--; // didn't consume an arg
    }
    cursor = idx + 2;
  }
  // Trailing args get appended like console.log does (space-separated).
  while (i < args.length) {
    const a = args[i++];
    result += ` ${typeof a === 'string' ? a : inspectImpl(a)}`;
  }
  return result;
}

export function promisify<T extends (...a: unknown[]) => unknown>(
  fn: T,
): (...args: unknown[]) => Promise<unknown> {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      (fn as unknown as (...a: unknown[]) => void)(...args, (err: unknown, value: unknown) => {
        if (err) reject(err);
        else resolve(value);
      });
    });
}

export function callbackify<T extends (...a: unknown[]) => Promise<unknown>>(
  fn: T,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const cb = args.pop() as (err: unknown, value?: unknown) => void;
    fn(...args).then(
      (v) => cb(null, v),
      (e) => cb(e),
    );
  };
}

export function deprecate<T extends (...a: unknown[]) => unknown>(fn: T, msg: string): T {
  let warned = false;
  return ((...args: unknown[]) => {
    if (!warned) {
      warned = true;
      console.warn(`DeprecationWarning: ${msg}`);
    }
    return (fn as unknown as (...a: unknown[]) => unknown)(...args);
  }) as T;
}

export function inherits(ctor: unknown, superCtor: unknown): void {
  if (typeof ctor !== 'function' || typeof superCtor !== 'function') {
    throw new TypeError('util.inherits expects constructors');
  }
  const child = ctor as { prototype: object; super_?: unknown };
  const parent = superCtor as { prototype: object };
  child.super_ = superCtor;
  Object.setPrototypeOf(child.prototype, parent.prototype);
}

export const types = {
  isPromise: (v: unknown): v is Promise<unknown> => v instanceof Promise,
  isDate: (v: unknown): v is Date => v instanceof Date,
  isRegExp: (v: unknown): v is RegExp => v instanceof RegExp,
  isMap: (v: unknown): v is Map<unknown, unknown> => v instanceof Map,
  isSet: (v: unknown): v is Set<unknown> => v instanceof Set,
  isUint8Array: (v: unknown): v is Uint8Array => v instanceof Uint8Array,
  isArrayBuffer: (v: unknown): v is ArrayBuffer => v instanceof ArrayBuffer,
  isAsyncFunction: (v: unknown) =>
    typeof v === 'function' && v.constructor && v.constructor.name === 'AsyncFunction',
  isGeneratorFunction: (v: unknown) =>
    typeof v === 'function' && v.constructor && v.constructor.name === 'GeneratorFunction',
};

export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

const util = {
  inspect,
  format,
  promisify,
  callbackify,
  deprecate,
  inherits,
  types,
  TextEncoder,
  TextDecoder,
};
export default util;
