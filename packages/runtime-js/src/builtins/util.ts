/**
 * Node-compatible `node:util` (subset). `inspect` is backed by our REPL
 * inspector; `format` shims the printf-style %s/%d/%j specifiers.
 */
import { inspect as inspectImpl } from '../repl/inspect.ts';
import { NodeProcess, riftyProcess } from './process.ts';
import { Stream } from './stream.ts';
import { types as utilTypes } from './util-types.ts';

export const inspect = inspectImpl;

// Read the ACTIVE realm process (the spec-seeded one in a kernel child, ADR-0157)
// so `debuglog` honours NODE_DEBUG / pid / stderr of THIS process — not the
// no-spec singleton. Falls back to `riftyProcess` (REPL / in-process harness).
function activeProcess(): NodeProcess {
  const proc = (globalThis as { process?: unknown }).process;
  return proc instanceof NodeProcess ? proc : riftyProcess;
}

interface StyleTextOptions {
  readonly validateStream?: boolean;
  readonly stream?: unknown;
}

const STYLE_CODES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  faint: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  doubleunderline: [21, 24],
  doubleUnderline: [21, 24],
  blink: [5, 25],
  inverse: [7, 27],
  swapColors: [7, 27],
  swapcolors: [7, 27],
  hidden: [8, 28],
  conceal: [8, 28],
  strikethrough: [9, 29],
  strikeThrough: [9, 29],
  crossedout: [9, 29],
  crossedOut: [9, 29],
  framed: [51, 54],
  overlined: [53, 55],
  black: [30, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  grey: [90, 39],
  blackBright: [90, 39],
  redBright: [91, 39],
  greenBright: [92, 39],
  yellowBright: [93, 39],
  blueBright: [94, 39],
  magentaBright: [95, 39],
  cyanBright: [96, 39],
  whiteBright: [97, 39],
  bgBlack: [40, 49],
  bgRed: [41, 49],
  bgGreen: [42, 49],
  bgYellow: [43, 49],
  bgBlue: [44, 49],
  bgMagenta: [45, 49],
  bgCyan: [46, 49],
  bgWhite: [47, 49],
  bgGray: [100, 49],
  bgGrey: [100, 49],
  bgBlackBright: [100, 49],
  bgRedBright: [101, 49],
  bgGreenBright: [102, 49],
  bgYellowBright: [103, 49],
  bgBlueBright: [104, 49],
  bgMagentaBright: [105, 49],
  bgCyanBright: [106, 49],
  bgWhiteBright: [107, 49],
});

function normalizeStyleFormats(format: unknown): readonly unknown[] {
  if (typeof format === 'string') return [format];
  if (Array.isArray(format)) return format;
  throw Object.assign(
    new TypeError(`The argument 'format' must be a known style. Received ${String(format)}`),
    {
      code: 'ERR_INVALID_ARG_VALUE',
    },
  );
}

function styleCode(format: unknown): readonly [number, number] | null {
  if (format === 'none') return null;
  if (typeof format !== 'string') {
    throw Object.assign(
      new TypeError(`The argument 'format' must be a known style. Received ${String(format)}`),
      {
        code: 'ERR_INVALID_ARG_VALUE',
      },
    );
  }
  const code = STYLE_CODES[format];
  if (code) return code;
  throw Object.assign(
    new TypeError(`The argument 'format' must be a known style. Received '${format}'`),
    {
      code: 'ERR_INVALID_ARG_VALUE',
    },
  );
}

function invalidStream(stream: unknown): TypeError {
  const received =
    stream === null
      ? 'null'
      : typeof stream === 'object'
        ? `an instance of ${(stream as object).constructor?.name ?? 'Object'}`
        : `type ${typeof stream}`;
  return Object.assign(
    new TypeError(
      `The "stream" argument must be an instance of ReadableStream, WritableStream, or Stream. Received ${received}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function isStyleTextStream(stream: unknown): boolean {
  if (stream === riftyProcess.stderr || stream === riftyProcess.stdout) return true;
  if (stream instanceof Stream) return true;
  const webStreams = globalThis as {
    ReadableStream?: { new (...args: never[]): unknown };
    WritableStream?: { new (...args: never[]): unknown };
  };
  return (
    (webStreams.ReadableStream !== undefined && stream instanceof webStreams.ReadableStream) ||
    (webStreams.WritableStream !== undefined && stream instanceof webStreams.WritableStream)
  );
}

function streamSupportsColor(stream: unknown, explicit: boolean): boolean {
  if (stream === null || (typeof stream !== 'object' && typeof stream !== 'function')) {
    if (explicit) throw invalidStream(stream);
    return false;
  }
  if (!isStyleTextStream(stream)) {
    if (explicit) throw invalidStream(stream);
    return false;
  }
  const candidate = stream as { isTTY?: unknown; hasColors?: unknown; getColorDepth?: unknown };
  if (typeof candidate.hasColors === 'function') return Boolean(candidate.hasColors());
  if (typeof candidate.getColorDepth === 'function') return Number(candidate.getColorDepth()) > 1;
  return candidate.isTTY === true;
}

export function styleText(
  format: string | readonly string[],
  text: string,
  options: StyleTextOptions = {},
): string {
  if (typeof text !== 'string') {
    throw Object.assign(
      new TypeError(`The "text" argument must be of type string. Received type ${typeof text}`),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  const formats = normalizeStyleFormats(format);
  const codes = formats
    .map(styleCode)
    .filter((code): code is readonly [number, number] => Array.isArray(code));
  if (
    options.validateStream !== false &&
    !streamSupportsColor(
      options.stream ?? riftyProcess.stderr,
      Object.prototype.hasOwnProperty.call(options, 'stream'),
    )
  ) {
    return text;
  }
  if (codes.length === 0) return text;
  const open = codes.map(([start]) => `\u001b[${start}m`).join('');
  const close = [...codes]
    .reverse()
    .map(([, end]) => `\u001b[${end}m`)
    .join('');
  return `${open}${text}${close}`;
}

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
      case 'c':
        // CSS directive: outside a browser console Node CONSUMES the arg (already
        // taken via `args[i++]`) and emits nothing. Was falling through to
        // `default`, which kept the literal `%c` AND un-consumed the arg.
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
  const raw = activeProcess().env.NODE_DEBUG;
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
    const proc = activeProcess();
    proc.stderr.write(`${upper} ${proc.pid}: ${format(fmt, ...rest)}\n`);
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
  styleText,
  types: utilTypes,
  TextEncoder,
  TextDecoder,
};
export default util;
