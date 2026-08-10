/**
 * Node-compatible `node:util` (subset). `inspect` is backed by our REPL
 * inspector; `format` shims the printf-style %s/%d/%j specifiers.
 */
import { type InspectOptions, inspect as inspectImpl } from '../repl/inspect.ts';
import { deepStrictEqual } from './assert.ts';
import { NodeProcess, riftyProcess } from './process.ts';
import { types as utilTypes } from './util-types.ts';

export const inspect = inspectImpl;

// Read the ACTIVE realm process (the spec-seeded one in a kernel child, ADR-0157)
// so `debuglog` honours NODE_DEBUG / pid / stderr of THIS process — not the
// no-spec singleton. Falls back to `riftyProcess` (REPL / in-process harness).
function activeProcess(): NodeProcess {
  const proc = (globalThis as { process?: unknown }).process;
  return proc instanceof NodeProcess ? proc : riftyProcess;
}

export function format(fmt: unknown, ...args: unknown[]): string {
  return formatWithInspectOptions(undefined, fmt, args);
}

export function formatWithOptions(inspectOptions: InspectOptions, ...args: unknown[]): string {
  if (inspectOptions === null || typeof inspectOptions !== 'object') {
    throw invalidArgType('inspectOptions', 'object', inspectOptions);
  }
  if (args.length === 0) return '';
  const [fmt, ...formatArgs] = args;
  return formatWithInspectOptions(inspectOptions, fmt, formatArgs);
}

function formatWithInspectOptions(
  inspectOptions: InspectOptions | undefined,
  fmt: unknown,
  args: unknown[],
): string {
  if (typeof fmt !== 'string') {
    return [fmt, ...args]
      .map((a) => (typeof a === 'string' ? a : inspectImpl(a, inspectOptions)))
      .join(' ');
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
        // non-null objects (incl. arrays) use Node's fixed depth 0; everything
        // else is `String()`.
        if (typeof arg === 'string') result += arg;
        else if (typeof arg === 'bigint') result += `${arg}n`;
        else if (arg !== null && typeof arg === 'object')
          result += inspectImpl(arg, { ...inspectOptions, depth: 0 });
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
        result += inspectImpl(arg, { ...inspectOptions, depth: 4 });
        break;
      case 'O':
        result += inspectImpl(arg, inspectOptions);
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
    result += ` ${typeof a === 'string' ? a : inspectImpl(a, inspectOptions)}`;
  }
  return result;
}

const STYLE_CODES = {
  none: null,
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  faint: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
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
  doubleunderline: [21, 24],
  doubleUnderline: [21, 24],
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
} as const;

type StyleName = keyof typeof STYLE_CODES;

interface StyleTextStream {
  readonly isTTY?: boolean;
  getColorDepth?: () => number;
  hasColors?: () => boolean;
}

interface StyleTextOptions {
  readonly validateStream?: boolean | 0 | null;
  readonly stream?: StyleTextStream;
}

function invalidArgType(name: string, expected: string, value: unknown): TypeError {
  const received =
    value === null
      ? 'null'
      : typeof value === 'object'
        ? `an instance of ${value.constructor?.name ?? 'Object'}`
        : `type ${typeof value}${typeof value === 'number' ? ` (${value})` : ''}`;
  return Object.assign(
    new TypeError(`The "${name}" argument must be of type ${expected}. Received ${received}`),
    {
      code: 'ERR_INVALID_ARG_TYPE',
    },
  );
}

function invalidStyle(format: unknown): TypeError {
  const received =
    typeof format === 'string'
      ? `'${format}'`
      : format === null
        ? 'null'
        : Array.isArray(format)
          ? inspectImpl(format)
          : String(format);
  return Object.assign(
    new TypeError(
      `The argument 'format' must be one of: ${Object.keys(STYLE_CODES)
        .map((name) => `'${name}'`)
        .join(', ')}. Received ${received}`,
    ),
    { code: 'ERR_INVALID_ARG_VALUE' },
  );
}

function normalizeStyles(format: unknown): StyleName[] {
  const raw = Array.isArray(format) ? format : [format];
  const styles: StyleName[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !(item in STYLE_CODES)) throw invalidStyle(item);
    styles.push(item as StyleName);
  }
  return styles;
}

function normalizeStyleTextOptions(options: unknown): StyleTextOptions {
  if (options === undefined) return {};
  if (options === null || typeof options !== 'object') {
    throw invalidArgType('options', 'object', options);
  }
  const candidate = options as { validateStream?: unknown; stream?: unknown };
  if (
    candidate.validateStream !== undefined &&
    candidate.validateStream !== null &&
    typeof candidate.validateStream !== 'boolean' &&
    candidate.validateStream !== 0 &&
    !(typeof candidate.validateStream === 'number' && Number.isNaN(candidate.validateStream))
  ) {
    const received =
      typeof candidate.validateStream === 'number'
        ? `number (${candidate.validateStream})`
        : `type ${typeof candidate.validateStream}`;
    const err = new TypeError(
      `The "options.validateStream" property must be of type boolean. Received ${received}`,
    );
    throw Object.assign(err, { code: 'ERR_INVALID_ARG_TYPE' });
  }
  if (
    candidate.stream !== undefined &&
    !styleTextStreamValidationDisabled(candidate.validateStream) &&
    !isValidStyleTextStream(candidate.stream)
  ) {
    throw invalidArgType(
      'stream',
      'an instance of ReadableStream, WritableStream, or Stream',
      candidate.stream,
    );
  }
  return candidate as StyleTextOptions;
}

function styleTextStreamValidationDisabled(validateStream: unknown): boolean {
  return (
    validateStream === false ||
    validateStream === 0 ||
    (typeof validateStream === 'number' && Number.isNaN(validateStream))
  );
}

function isValidStyleTextStream(stream: unknown): boolean {
  const proc = activeProcess();
  return stream === proc.stdout || stream === proc.stderr;
}

function shouldApplyStyle(options: StyleTextOptions): boolean {
  if (styleTextStreamValidationDisabled(options.validateStream)) {
    return true;
  }
  const stream: StyleTextStream = options.stream ?? activeProcess().stdout;
  if (typeof stream.hasColors === 'function') return stream.hasColors();
  if (typeof stream.getColorDepth === 'function') return stream.getColorDepth() > 1;
  return stream.isTTY === true;
}

export function styleText(format: unknown, text: unknown, options?: StyleTextOptions): string {
  if (typeof text !== 'string') throw invalidArgType('text', 'string', text);
  const styles = normalizeStyles(format);
  const opts = normalizeStyleTextOptions(options);
  if (styles.length === 0 || !shouldApplyStyle(opts)) return text;

  let open = '';
  let close = '';
  for (const style of styles) {
    const code = STYLE_CODES[style];
    if (code === null) continue;
    const [start, end] = code;
    open += `\x1B[${start}m`;
    close = `\x1B[${end}m${close}`;
  }
  return `${open}${text}${close}`;
}

const VT_CONTROL_PATTERN = [
  String.raw`(?:\x1B\][^\x07]*(?:\x07|\x1B\\)|`,
  String.raw`\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]))`,
].join('');
const VT_CONTROL_RE = new RegExp(VT_CONTROL_PATTERN, 'g');

export function stripVTControlCharacters(str: unknown): string {
  if (typeof str !== 'string') throw invalidArgType('str', 'string', str);
  return str.replace(VT_CONTROL_RE, '');
}

function isDotEnvSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n';
}

function trimDotEnvSpaces(input: string): string {
  let start = 0;
  while (start < input.length && isDotEnvSpace(input.charAt(start))) start++;
  let end = input.length;
  while (end > start && isDotEnvSpace(input.charAt(end - 1))) end--;
  return input.slice(start, end);
}

function firstDotEnvSeparator(content: string): number {
  const equals = content.indexOf('=');
  const newline = content.indexOf('\n');
  if (equals === -1) return newline;
  if (newline === -1) return equals;
  return Math.min(equals, newline);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let i = 0; i < sharedLength; i++) {
    const leftByte = left[i]!;
    const rightByte = right[i]!;
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return left.length - right.length;
}

/** Node's `.env` parser, matching `src/node_dotenv.cc` in Node 24. */
export function parseEnv(input: unknown): Record<string, string> {
  if (typeof input !== 'string') throw invalidArgType('content', 'string', input);

  const encoder = new globalThis.TextEncoder();
  const decoder = new globalThis.TextDecoder('utf-8', { ignoreBOM: true });
  let content = trimDotEnvSpaces(decoder.decode(encoder.encode(input)).replaceAll('\r', ''));
  const store = new Map<string, string>();

  while (content.length > 0) {
    if (content[0] === '\n' || content[0] === '#') {
      const newline = content.indexOf('\n');
      content = newline === -1 ? '' : content.slice(newline + 1);
      continue;
    }

    const separator = firstDotEnvSeparator(content);
    if (separator === -1 || content[separator] === '\n') {
      if (separator === -1) break;
      content = trimDotEnvSpaces(content.slice(separator + 1));
      continue;
    }

    let key = trimDotEnvSpaces(content.slice(0, separator));
    content = content.slice(separator + 1);
    if (content.length === 0 || content[0] === '\n') {
      store.set(key, '');
      continue;
    }

    content = trimDotEnvSpaces(content);
    if (key.length === 0) continue;
    if (key.startsWith('export ')) key = trimDotEnvSpaces(key.slice(7));
    if (content.length === 0) {
      store.set(key, '');
      break;
    }

    if (content[0] === '"') {
      const closingQuote = content.indexOf('"', 1);
      if (closingQuote !== -1) {
        const value = content.slice(1, closingQuote).replaceAll('\\n', '\n');
        store.set(key, value);
        const newline = content.indexOf('\n', closingQuote + 1);
        content = newline === -1 ? '' : content.slice(newline + 1);
        continue;
      }
    }

    if (content[0] === "'" || content[0] === '"' || content[0] === '`') {
      const closingQuote = content.indexOf(content[0], 1);
      if (closingQuote === -1) {
        const newline = content.indexOf('\n');
        if (newline === -1) {
          store.set(key, content);
          break;
        }
        store.set(key, content.slice(0, newline));
        content = content.slice(newline + 1);
      } else {
        store.set(key, content.slice(1, closingQuote));
        const newline = content.indexOf('\n', closingQuote + 1);
        content = newline === -1 ? '' : content.slice(newline + 1);
        continue;
      }
    } else {
      const newline = content.indexOf('\n');
      const line = newline === -1 ? content : content.slice(0, newline);
      const hash = line.indexOf('#');
      const value = trimDotEnvSpaces(hash === -1 ? line : line.slice(0, hash));
      store.set(key, value);
      content = newline === -1 ? '' : content.slice(newline + 1);
    }
    content = trimDotEnvSpaces(content);
  }

  const entries = [...store].map(([key, value]) => ({ key, value, bytes: encoder.encode(key) }));
  entries.sort((left, right) => compareBytes(left.bytes, right.bytes));
  const result: Record<string, string> = {};
  for (const { key, value } of entries) result[key] = value;
  return result;
}

export function isDeepStrictEqual(val1: unknown, val2: unknown): boolean {
  try {
    deepStrictEqual(val1, val2);
    return true;
  } catch {
    return false;
  }
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

const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');

export function promisify<T extends (...a: unknown[]) => unknown>(
  fn: T,
): (...args: unknown[]) => Promise<unknown> {
  if (typeof fn !== 'function') throw invalidArgType('original', 'function', fn);
  const custom = Reflect.get(fn, PROMISIFY_CUSTOM);
  if (custom) {
    if (typeof custom !== 'function') {
      throw invalidArgType('util.promisify.custom', 'function', custom);
    }
    Object.defineProperty(custom, PROMISIFY_CUSTOM, {
      configurable: true,
      value: custom,
    });
    return custom as (...args: unknown[]) => Promise<unknown>;
  }

  const promisified = (...args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      (fn as unknown as (...a: unknown[]) => void)(...args, (err: unknown, value: unknown) => {
        if (err) reject(err);
        else resolve(value);
      });
    });
  Object.defineProperties(promisified, {
    name: { configurable: true, value: (fn as { readonly name?: string }).name ?? '' },
    length: { configurable: true, value: fn.length },
    [PROMISIFY_CUSTOM]: { configurable: true, value: promisified },
  });
  return promisified;
}

Object.defineProperty(promisify, 'custom', {
  configurable: true,
  enumerable: true,
  value: PROMISIFY_CUSTOM,
  writable: true,
});

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
  formatWithOptions,
  styleText,
  stripVTControlCharacters,
  parseEnv,
  isDeepStrictEqual,
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
