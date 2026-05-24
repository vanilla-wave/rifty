/**
 * Minimal Node-style inspector for REPL output. Not as comprehensive as
 * `util.inspect`, but covers the common cases: primitives, objects, arrays,
 * functions, Errors, and circular references.
 */

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 30;
const MAX_STRING_LEN = 120;

export function inspect(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return formatString(value as string);
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  if (type === 'symbol') return (value as symbol).toString();
  if (type === 'function') return formatFunction(value as (...args: unknown[]) => unknown);
  if (value instanceof Error) return formatError(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Promise) return 'Promise { <pending> }';
  if (value instanceof Map) return formatMap(value, depth, seen);
  if (value instanceof Set) return formatSet(value, depth, seen);
  if (Array.isArray(value)) return formatArray(value, depth, seen);
  if (type === 'object') return formatObject(value as object, depth, seen);
  return String(value);
}

function formatString(s: string): string {
  const truncated = s.length > MAX_STRING_LEN ? `${s.slice(0, MAX_STRING_LEN)}…` : s;
  return JSON.stringify(truncated);
}

function formatFunction(fn: (...args: unknown[]) => unknown): string {
  const name = fn.name || '(anonymous)';
  return `[Function: ${name}]`;
}

function formatError(err: Error): string {
  return err.stack ?? `${err.name}: ${err.message}`;
}

function formatArray(arr: readonly unknown[], depth: number, seen: WeakSet<object>): string {
  if (seen.has(arr)) return '[Circular]';
  if (depth >= MAX_DEPTH) return `[Array(${arr.length})]`;
  seen.add(arr);
  const items = arr.slice(0, MAX_ARRAY_ITEMS).map((v) => inspect(v, depth + 1, seen));
  if (arr.length > MAX_ARRAY_ITEMS) items.push(`... ${arr.length - MAX_ARRAY_ITEMS} more items`);
  seen.delete(arr);
  return `[ ${items.join(', ')} ]`;
}

function formatObject(obj: object, depth: number, seen: WeakSet<object>): string {
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Object]';
  seen.add(obj);
  const keys = Object.keys(obj);
  const ctor = obj.constructor && obj.constructor.name !== 'Object' ? obj.constructor.name : '';
  const items = keys.slice(0, MAX_OBJECT_KEYS).map((k) => {
    const v = (obj as Record<string, unknown>)[k];
    return `${k}: ${inspect(v, depth + 1, seen)}`;
  });
  if (keys.length > MAX_OBJECT_KEYS) items.push(`... ${keys.length - MAX_OBJECT_KEYS} more keys`);
  seen.delete(obj);
  const prefix = ctor ? `${ctor} ` : '';
  return `${prefix}{ ${items.join(', ')} }`;
}

function formatMap(map: Map<unknown, unknown>, depth: number, seen: WeakSet<object>): string {
  if (seen.has(map)) return '[Circular]';
  if (depth >= MAX_DEPTH) return `Map(${map.size})`;
  seen.add(map);
  const items: string[] = [];
  let i = 0;
  for (const [k, v] of map) {
    if (i >= MAX_ARRAY_ITEMS) {
      items.push(`... ${map.size - MAX_ARRAY_ITEMS} more`);
      break;
    }
    items.push(`${inspect(k, depth + 1, seen)} => ${inspect(v, depth + 1, seen)}`);
    i += 1;
  }
  seen.delete(map);
  return `Map(${map.size}) { ${items.join(', ')} }`;
}

function formatSet(set: Set<unknown>, depth: number, seen: WeakSet<object>): string {
  if (seen.has(set)) return '[Circular]';
  if (depth >= MAX_DEPTH) return `Set(${set.size})`;
  seen.add(set);
  const items: string[] = [];
  let i = 0;
  for (const v of set) {
    if (i >= MAX_ARRAY_ITEMS) {
      items.push(`... ${set.size - MAX_ARRAY_ITEMS} more`);
      break;
    }
    items.push(inspect(v, depth + 1, seen));
    i += 1;
  }
  seen.delete(set);
  return `Set(${set.size}) { ${items.join(', ')} }`;
}

export function formatArgs(args: readonly unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
}
