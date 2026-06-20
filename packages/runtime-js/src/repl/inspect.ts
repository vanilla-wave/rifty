/**
 * Minimal Node-style inspector for REPL output. Not as comprehensive as
 * `util.inspect`, but covers the common cases: primitives, objects, arrays,
 * functions, Errors, Buffers, and circular references.
 */

import { Buffer, getInspectMaxBytes } from '@riftydev/io';

// rifty's historical default nesting cap. Node's own default is 2; matching that
// (plus colors/getters/sorted/breakLength) is the broader inspect-options work
// owned by `util-surface-completions` — this module honours an explicit
// `options.depth` (the active divergence fixed here) and keeps the prior default.
const DEFAULT_DEPTH = 3;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 30;
const MAX_STRING_LEN = 120;

export interface InspectOptions {
  /** Nesting levels to render before collapsing to `[Object]`/`[Array]`. `null` = unlimited. */
  depth?: number | null;
}

/**
 * `util.inspect(value[, options])`. The 2nd argument is an OPTIONS object, NOT
 * the internal recursion counter — `util.inspect(obj, { depth: null })` no
 * longer misreads `{ depth: null }` as `depth = NaN`. `depth: null` = unlimited.
 * Other options (colors/getters/sorted/breakLength/…) are tracked separately in
 * `util-surface-completions`.
 */
export function inspect(value: unknown, options?: InspectOptions): string {
  const depthOpt = options?.depth;
  const maxDepth =
    depthOpt === null
      ? Number.POSITIVE_INFINITY
      : typeof depthOpt === 'number'
        ? depthOpt
        : DEFAULT_DEPTH;
  return inspectValue(value, 0, new WeakSet(), maxDepth);
}

function inspectValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  maxDepth: number,
): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return quoteString(value as string);
  if (type === 'number' || type === 'boolean') return String(value);
  // Node renders bigints with a trailing `n` at every depth (`3n`, `{ a: 3n }`).
  if (type === 'bigint') return `${String(value)}n`;
  if (type === 'symbol') return (value as symbol).toString();
  if (type === 'function') return formatFunction(value as (...args: unknown[]) => unknown);
  if (value instanceof Error) return formatError(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Promise) return 'Promise { <pending> }';
  // Buffer renders as Node's `<Buffer 01 02 …>` hex, truncated at the live
  // `buffer.INSPECT_MAX_BYTES`. Checked before the generic Uint8Array/object
  // paths so a Buffer never falls through to a key dump.
  if (Buffer.isBuffer(value)) return formatBuffer(value as Uint8Array);
  if (value instanceof Map) return formatMap(value, depth, seen, maxDepth);
  if (value instanceof Set) return formatSet(value, depth, seen, maxDepth);
  if (Array.isArray(value)) return formatArray(value, depth, seen, maxDepth);
  if (type === 'object') return formatObject(value as object, depth, seen, maxDepth);
  return String(value);
}

// Per-codepoint control-character escapes, matching Node's `strEscape` meta map.
const CONTROL_ESCAPES: Record<number, string> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  12: '\\f',
  13: '\\r',
};

/**
 * Quote a string the way Node's inspector does: single quotes by default; double
 * quotes when the string holds a `'` but no `"`; backticks when it holds both
 * but no backtick; otherwise single quotes with `'` escaped. Backslash and
 * control characters are escaped.
 */
function quoteString(raw: string): string {
  const s = raw.length > MAX_STRING_LEN ? `${raw.slice(0, MAX_STRING_LEN)}…` : raw;
  let quote = "'";
  if (s.includes("'")) {
    if (!s.includes('"')) quote = '"';
    else if (!s.includes('`')) quote = '`';
  }
  let out = quote;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (CONTROL_ESCAPES[code] !== undefined) out += CONTROL_ESCAPES[code];
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f))
      out += `\\x${code.toString(16).toUpperCase().padStart(2, '0')}`;
    else out += ch;
  }
  return out + quote;
}

/** `<Buffer 01 02 …>` hex dump, truncated at the live `buffer.INSPECT_MAX_BYTES`. */
function formatBuffer(buf: Uint8Array): string {
  const max = getInspectMaxBytes();
  const shown = Math.min(buf.length, max);
  let hex = '';
  for (let i = 0; i < shown; i++) {
    hex += (i ? ' ' : '') + (buf[i] ?? 0).toString(16).padStart(2, '0');
  }
  const more = buf.length > max ? `${hex ? ' ' : ''}... ${buf.length - max} more bytes` : '';
  return `<Buffer ${hex}${more}>`;
}

function formatFunction(fn: (...args: unknown[]) => unknown): string {
  const name = fn.name || '(anonymous)';
  return `[Function: ${name}]`;
}

function formatError(err: Error): string {
  return err.stack ?? `${err.name}: ${err.message}`;
}

function formatArray(
  arr: readonly unknown[],
  depth: number,
  seen: WeakSet<object>,
  maxDepth: number,
): string {
  if (seen.has(arr)) return '[Circular]';
  if (depth > maxDepth) return `[Array(${arr.length})]`;
  seen.add(arr);
  const items = arr
    .slice(0, MAX_ARRAY_ITEMS)
    .map((v) => inspectValue(v, depth + 1, seen, maxDepth));
  if (arr.length > MAX_ARRAY_ITEMS) items.push(`... ${arr.length - MAX_ARRAY_ITEMS} more items`);
  seen.delete(arr);
  return `[ ${items.join(', ')} ]`;
}

function formatObject(obj: object, depth: number, seen: WeakSet<object>, maxDepth: number): string {
  if (seen.has(obj)) return '[Circular]';
  if (depth > maxDepth) return '[Object]';
  seen.add(obj);
  const keys = Object.keys(obj);
  const ctor = obj.constructor && obj.constructor.name !== 'Object' ? obj.constructor.name : '';
  const items = keys.slice(0, MAX_OBJECT_KEYS).map((k) => {
    const v = (obj as Record<string, unknown>)[k];
    return `${k}: ${inspectValue(v, depth + 1, seen, maxDepth)}`;
  });
  if (keys.length > MAX_OBJECT_KEYS) items.push(`... ${keys.length - MAX_OBJECT_KEYS} more keys`);
  seen.delete(obj);
  const prefix = ctor ? `${ctor} ` : '';
  return `${prefix}{ ${items.join(', ')} }`;
}

function formatMap(
  map: Map<unknown, unknown>,
  depth: number,
  seen: WeakSet<object>,
  maxDepth: number,
): string {
  if (seen.has(map)) return '[Circular]';
  if (depth > maxDepth) return `Map(${map.size})`;
  seen.add(map);
  const items: string[] = [];
  let i = 0;
  for (const [k, v] of map) {
    if (i >= MAX_ARRAY_ITEMS) {
      items.push(`... ${map.size - MAX_ARRAY_ITEMS} more`);
      break;
    }
    items.push(
      `${inspectValue(k, depth + 1, seen, maxDepth)} => ${inspectValue(v, depth + 1, seen, maxDepth)}`,
    );
    i += 1;
  }
  seen.delete(map);
  return `Map(${map.size}) { ${items.join(', ')} }`;
}

function formatSet(
  set: Set<unknown>,
  depth: number,
  seen: WeakSet<object>,
  maxDepth: number,
): string {
  if (seen.has(set)) return '[Circular]';
  if (depth > maxDepth) return `Set(${set.size})`;
  seen.add(set);
  const items: string[] = [];
  let i = 0;
  for (const v of set) {
    if (i >= MAX_ARRAY_ITEMS) {
      items.push(`... ${set.size - MAX_ARRAY_ITEMS} more`);
      break;
    }
    items.push(inspectValue(v, depth + 1, seen, maxDepth));
    i += 1;
  }
  seen.delete(set);
  return `Set(${set.size}) { ${items.join(', ')} }`;
}

export function formatArgs(args: readonly unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
}
