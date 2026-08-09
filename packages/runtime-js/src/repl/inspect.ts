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
const PromiseConstructorPrimordial = Promise;
const promiseThenPrimordial = Promise.prototype.then;
const promiseResolvePrimordial = Promise.resolve;
const reflectApplyPrimordial = Reflect.apply;

interface InspectContext {
  readonly ancestors: WeakSet<object>;
  readonly referenceIds: WeakMap<object, number>;
  nextReferenceId: number;
}

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
  return inspectValue(
    value,
    0,
    {
      ancestors: new WeakSet(),
      referenceIds: new WeakMap(),
      nextReferenceId: 1,
    },
    maxDepth,
  );
}

function inspectValue(
  value: unknown,
  depth: number,
  context: InspectContext,
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
  if (value instanceof Map) return formatMap(value, depth, context, maxDepth);
  if (value instanceof Set) return formatSet(value, depth, context, maxDepth);
  if (Array.isArray(value)) return formatArray(value, depth, context, maxDepth);
  if (type === 'object') return formatObject(value as object, depth, context, maxDepth);
  return String(value);
}

function circularReference(value: object, context: InspectContext): string | null {
  if (!context.ancestors.has(value)) return null;
  let id = context.referenceIds.get(value);
  if (id === undefined) {
    id = context.nextReferenceId++;
    context.referenceIds.set(value, id);
  }
  return `[Circular *${id}]`;
}

function referencePrefix(value: object, context: InspectContext): string {
  const id = context.referenceIds.get(value);
  return id === undefined ? '' : `<ref *${id}> `;
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
  // Node appends own ENUMERABLE non-index properties after the hex
  // (`<Buffer 01 02, foo: 'bar'>`); the integer indices are not shown.
  const rec = buf as unknown as Record<string, unknown>;
  const extra = Object.keys(buf)
    .filter((k) => !/^\d+$/.test(k))
    .map((k) => `${k}: ${inspect(rec[k])}`);
  const props = extra.length > 0 ? `, ${extra.join(', ')}` : '';
  return `<Buffer ${hex}${more}${props}>`;
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
  context: InspectContext,
  maxDepth: number,
): string {
  const circular = circularReference(arr, context);
  if (circular !== null) return circular;
  if (depth > maxDepth) return '[Array]';
  context.ancestors.add(arr);
  const items = arr
    .slice(0, MAX_ARRAY_ITEMS)
    .map((v) => inspectValue(v, depth + 1, context, maxDepth));
  if (arr.length > MAX_ARRAY_ITEMS) items.push(`... ${arr.length - MAX_ARRAY_ITEMS} more items`);
  context.ancestors.delete(arr);
  return `${referencePrefix(arr, context)}[ ${items.join(', ')} ]`;
}

function formatObject(
  obj: object,
  depth: number,
  context: InspectContext,
  maxDepth: number,
): string {
  const circular = circularReference(obj, context);
  if (circular !== null) return circular;
  if (depth > maxDepth) return '[Object]';
  context.ancestors.add(obj);
  const keys = Object.keys(obj);
  const ctor = obj.constructor && obj.constructor.name !== 'Object' ? obj.constructor.name : '';
  const items = keys.slice(0, MAX_OBJECT_KEYS).map((k) => {
    const v = (obj as Record<string, unknown>)[k];
    return `${k}: ${inspectValue(v, depth + 1, context, maxDepth)}`;
  });
  if (keys.length > MAX_OBJECT_KEYS) items.push(`... ${keys.length - MAX_OBJECT_KEYS} more keys`);
  context.ancestors.delete(obj);
  const prefix = ctor ? `${ctor} ` : '';
  return `${referencePrefix(obj, context)}${prefix}{ ${items.join(', ')} }`;
}

function formatMap(
  map: Map<unknown, unknown>,
  depth: number,
  context: InspectContext,
  maxDepth: number,
): string {
  const circular = circularReference(map, context);
  if (circular !== null) return circular;
  if (depth > maxDepth) return '[Map]';
  context.ancestors.add(map);
  const items: string[] = [];
  let i = 0;
  for (const [k, v] of map) {
    if (i >= MAX_ARRAY_ITEMS) {
      items.push(`... ${map.size - MAX_ARRAY_ITEMS} more`);
      break;
    }
    items.push(
      `${inspectValue(k, depth + 1, context, maxDepth)} => ${inspectValue(
        v,
        depth + 1,
        context,
        maxDepth,
      )}`,
    );
    i += 1;
  }
  context.ancestors.delete(map);
  return `${referencePrefix(map, context)}Map(${map.size}) { ${items.join(', ')} }`;
}

function formatSet(
  set: Set<unknown>,
  depth: number,
  context: InspectContext,
  maxDepth: number,
): string {
  const circular = circularReference(set, context);
  if (circular !== null) return circular;
  if (depth > maxDepth) return '[Set]';
  context.ancestors.add(set);
  const items: string[] = [];
  let i = 0;
  for (const v of set) {
    if (i >= MAX_ARRAY_ITEMS) {
      items.push(`... ${set.size - MAX_ARRAY_ITEMS} more`);
      break;
    }
    items.push(inspectValue(v, depth + 1, context, maxDepth));
    i += 1;
  }
  context.ancestors.delete(set);
  return `${referencePrefix(set, context)}Set(${set.size}) { ${items.join(', ')} }`;
}

export function formatArgs(args: readonly unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
}

type PromiseSnapshot =
  | { readonly kind: 'pending' }
  | { readonly kind: 'fulfilled'; readonly value: unknown }
  | { readonly kind: 'rejected'; readonly reason: unknown };

async function snapshotPromise(promise: Promise<unknown>): Promise<PromiseSnapshot> {
  let snapshot: PromiseSnapshot = { kind: 'pending' };
  reflectApplyPrimordial(promiseThenPrimordial, promise, [
    (value: unknown) => {
      snapshot = { kind: 'fulfilled', value };
    },
    (reason: unknown) => {
      snapshot = { kind: 'rejected', reason };
    },
  ]);
  await reflectApplyPrimordial(promiseResolvePrimordial, PromiseConstructorPrimordial, []);
  return snapshot;
}

function formatNodeEvalRejectedReason(reason: unknown): string {
  if (!(reason instanceof Error)) return inspect(reason);
  const stack = reason.stack ?? `${reason.name}: ${reason.message}`;
  const title = stack.split('\n', 1)[0] ?? `${reason.name}: ${reason.message}`;
  const frame = /(?:^|\n)\s+at (?:eval \()?\[eval\]:(\d+):(\d+)\)?(?:\n|$)/u.exec(stack);
  if (frame === null) return inspect(reason);
  return `${title}\n    at [eval]:${frame[1]}:${frame[2]}`;
}

/** Node CLI `-p`'s deferred one-argument console formatting. */
export async function formatNodeEvalPrintValue(value: unknown): Promise<string> {
  if (!(value instanceof PromiseConstructorPrimordial)) {
    return typeof value === 'string' ? value : inspect(value);
  }
  const snapshot = await snapshotPromise(value);
  if (snapshot.kind === 'pending') return 'Promise { <pending> }';
  if (snapshot.kind === 'fulfilled') return `Promise { ${inspect(snapshot.value)} }`;
  const reason = formatNodeEvalRejectedReason(snapshot.reason).replaceAll('\n', '\n  ');
  return `Promise {\n  <rejected> ${reason}\n}`;
}
