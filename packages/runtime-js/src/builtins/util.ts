/**
 * Node-compatible `node:util` (subset). `inspect` is backed by our REPL
 * inspector; `format` shims the printf-style %s/%d/%j specifiers.
 */
import { inspect as inspectImpl } from '../repl/inspect.ts';
import { riftyProcess } from './process.ts';
import { types as utilTypes } from './util-types.ts';

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
        // Node's `%s`: strings pass through, bigints get the `n` suffix,
        // non-null objects (incl. arrays) are inspected (Node uses depth 2; our
        // default depth differs for deeply-nested values), everything else is
        // `String()`.
        if (typeof arg === 'string') result += arg;
        else if (typeof arg === 'bigint') result += `${arg}n`;
        else if (arg !== null && typeof arg === 'object') result += inspectImpl(arg);
        else result += String(arg);
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
        i--; // unknown spec consumed no arg
    }
    cursor = idx + 2;
  }
  // Trailing args get space-appended, like console.log.
  while (i < args.length) {
    const a = args[i++];
    result += ` ${typeof a === 'string' ? a : inspectImpl(a)}`;
  }
  return result;
}

/**
 * A `util.debuglog` debug function: callable with printf-style args, carrying a
 * lazily-resolved `enabled` reflecting whether `NODE_DEBUG` selected the
 * section. Disabled = no-op; enabled writes `SECTION PID: <formatted>\n` to
 * stderr (matching Node).
 */
export interface DebugLogFunction {
  (...args: unknown[]): void;
  readonly enabled: boolean;
}

/**
 * Resolve `NODE_DEBUG` against a section name. The value is a comma/space
 * separated list of section globs (`*` = any run of chars), matched
 * case-insensitively — mirrors Node's `lib/internal/util/debuglog.js`.
 */
function debuglogEnabledFor(section: string): boolean {
  const raw = riftyProcess.env.NODE_DEBUG;
  if (!raw) return false;
  const target = section.toUpperCase();
  for (const token of raw.split(/[ ,]+/)) {
    if (token.length === 0) continue;
    // Glob to RegExp; only `*` is special in Node.
    const pattern = token
      .toUpperCase()
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    if (new RegExp(`^${pattern}$`).test(target)) return true;
  }
  return false;
}

/**
 * `util.debuglog(section[, callback])` — lazily-initialised, env-gated debug
 * logger. Faithful to Node:
 * - returns a callable with an `enabled` getter (resolved against `NODE_DEBUG`
 *   on first read, then memoised),
 * - the optional `callback` fires once on the FIRST call (not at creation),
 *   receiving the resolved debug function,
 * - disabled = no-op; enabled writes
 *   `SECTION PID: <util.format(...args)>\n` to `process.stderr`.
 */
export function debuglog(
  section: string,
  callback?: (fn: DebugLogFunction) => void,
): DebugLogFunction {
  const upper = section.toUpperCase();
  let enabled: boolean | undefined;
  let initialized = false;

  const resolveEnabled = (): boolean => {
    if (enabled === undefined) enabled = debuglogEnabledFor(section);
    return enabled;
  };

  const logger = ((...args: unknown[]): void => {
    if (!initialized) {
      initialized = true;
      const on = resolveEnabled();
      if (typeof callback === 'function') callback(logger);
      if (!on) return;
    } else if (!resolveEnabled()) {
      return;
    }
    const [fmt, ...rest] = args;
    riftyProcess.stderr.write(`${upper} ${riftyProcess.pid}: ${format(fmt, ...rest)}\n`);
  }) as DebugLogFunction;

  Object.defineProperty(logger, 'enabled', {
    enumerable: true,
    configurable: true,
    get: resolveEnabled,
  });

  return logger;
}

/** `util.debug` is an alias of `util.debuglog`. */
export const debug = debuglog;

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

// Full predicate set lives in its own module (also registered as the standalone
// `node:util/types` builtin). Re-exported here as `util.types`, matching Node.
export { types } from './util-types.ts';

export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

const util = {
  inspect,
  format,
  debuglog,
  debug,
  promisify,
  callbackify,
  deprecate,
  inherits,
  types: utilTypes,
  TextEncoder,
  TextDecoder,
};
export default util;
