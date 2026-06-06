/**
 * Node-compatible `node:assert`. Classic mode compares loose (`==` / loose deep),
 * strict mode compares `===` / strict deep. Both throw `AssertionError`.
 */

export class AssertionError extends Error {
  actual: unknown;
  expected: unknown;
  operator: string;
  code = 'ERR_ASSERTION';

  constructor(opts: { message?: string; actual?: unknown; expected?: unknown; operator?: string }) {
    const msg =
      opts.message ??
      `${stringify(opts.actual)} ${opts.operator ?? '!='} ${stringify(opts.expected)}`;
    super(msg);
    this.name = 'AssertionError';
    this.actual = opts.actual;
    this.expected = opts.expected;
    this.operator = opts.operator ?? '';
  }
}

function stringify(v: unknown): string {
  try {
    return typeof v === 'string' ? `'${v}'` : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function ok(value: unknown, message?: string): void {
  if (!value) {
    throw new AssertionError({
      message: message ?? `Expected truthy, got ${stringify(value)}`,
      actual: value,
      expected: true,
      operator: '==',
    });
  }
}

function equal(actual: unknown, expected: unknown, message?: string): void {
  // eslint-disable-next-line eqeqeq
  if (actual !== expected) {
    throw new AssertionError({ message, actual, expected, operator: '==' });
  }
}

function strictEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError({ message, actual, expected, operator: '===' });
  }
}

function notEqual(actual: unknown, expected: unknown, message?: string): void {
  // eslint-disable-next-line eqeqeq
  if (actual === expected) {
    throw new AssertionError({ message, actual, expected, operator: '!=' });
  }
}

function notStrictEqual(actual: unknown, expected: unknown, message?: string): void {
  if (Object.is(actual, expected)) {
    throw new AssertionError({ message, actual, expected, operator: '!==' });
  }
}

function deepEqualImpl(
  a: unknown,
  b: unknown,
  strict: boolean,
  seen: WeakMap<object, object>,
): boolean {
  if (strict ? Object.is(a, b) : a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const sa = seen.get(a as object);
  if (sa === b) return true;
  seen.set(a as object, b as object);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualImpl(a[i], b[i], strict, seen)) return false;
    }
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b as object, k)) return false;
    if (
      !deepEqualImpl(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        strict,
        seen,
      )
    ) {
      return false;
    }
  }
  return true;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEqualImpl(actual, expected, false, new WeakMap())) {
    throw new AssertionError({ message, actual, expected, operator: 'deepEqual' });
  }
}

function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEqualImpl(actual, expected, true, new WeakMap())) {
    throw new AssertionError({ message, actual, expected, operator: 'deepStrictEqual' });
  }
}

function notDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  if (deepEqualImpl(actual, expected, false, new WeakMap())) {
    throw new AssertionError({ message, actual, expected, operator: 'notDeepEqual' });
  }
}

function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string): void {
  if (deepEqualImpl(actual, expected, true, new WeakMap())) {
    throw new AssertionError({ message, actual, expected, operator: 'notDeepStrictEqual' });
  }
}

function fail(message?: string): never {
  throw new AssertionError({ message: message ?? 'Failed' });
}

/**
 * Whether `err` satisfies `expected` (Node's 2nd-arg semantics for
 * `assert.throws` / `assert.doesNotThrow`):
 *   - RegExp: match `err.message` (or `String(err)` if not an Error).
 *   - Error-subtype constructor: `err instanceof expected`.
 *   - Any other function: predicate `(err) => truthy`.
 *
 * Object / Error-instance forms aren't wired (Node accepts them, but they need
 * a deep-key check nothing in repo uses yet); land them when a call site needs them.
 */
function matchesExpected(err: unknown, expected: unknown): boolean {
  if (expected instanceof RegExp) {
    return expected.test(err instanceof Error ? err.message : String(err));
  }
  if (typeof expected === 'function') {
    // Error subclass => constructor check, else predicate (Node's heuristic
    // in lib/internal/assert).
    if (isErrorClass(expected)) {
      return err instanceof (expected as new () => Error);
    }
    return Boolean((expected as (e: unknown) => unknown)(err));
  }
  throw new TypeError('The "expected" argument must be of type Function or an instance of RegExp');
}

function isErrorClass(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  let proto: unknown = (fn as { prototype?: unknown }).prototype;
  while (proto && proto !== Object.prototype) {
    if (proto === Error.prototype) return true;
    proto = Object.getPrototypeOf(proto as object);
  }
  return false;
}

function throws(fn: () => unknown, expected?: unknown, message?: string): void {
  try {
    fn();
  } catch (err) {
    if (expected === undefined) return;
    if (!matchesExpected(err, expected)) {
      throw new AssertionError({ message, actual: err, expected, operator: 'throws' });
    }
    return;
  }
  throw new AssertionError({
    message: message ?? 'Missing expected exception',
    operator: 'throws',
  });
}

/**
 * `assert.doesNotThrow(fn[, expected][, message])`.
 *
 * - No `expected`: any throw is wrapped in `AssertionError`.
 * - With `expected`: matching throws are wrapped; non-matching are re-thrown
 *   unchanged (Node's "rethrow on mismatch" contract).
 */
function doesNotThrow(fn: () => unknown, expectedOrMessage?: unknown, message?: string): void {
  // Disambiguate message vs expected as Node does: a plain string is a message.
  let expected: unknown;
  let msg: string | undefined;
  if (typeof expectedOrMessage === 'string') {
    msg = expectedOrMessage;
    expected = undefined;
  } else {
    expected = expectedOrMessage;
    msg = message;
  }
  try {
    fn();
  } catch (err) {
    if (expected !== undefined && !matchesExpected(err, expected)) {
      // Re-throw unchanged on mismatch (Node spec).
      throw err;
    }
    throw new AssertionError({ message: msg, actual: err, expected, operator: 'doesNotThrow' });
  }
}

const assert = Object.assign(
  function assert(value: unknown, message?: string): void {
    ok(value, message);
  },
  {
    ok,
    equal,
    strictEqual,
    notEqual,
    notStrictEqual,
    deepEqual,
    deepStrictEqual,
    notDeepEqual,
    notDeepStrictEqual,
    fail,
    throws,
    doesNotThrow,
    AssertionError,
  },
);

export const strict = Object.assign((value: unknown, message?: string) => ok(value, message), {
  ok,
  equal: strictEqual,
  notEqual: notStrictEqual,
  strictEqual,
  notStrictEqual,
  deepEqual: deepStrictEqual,
  notDeepEqual: notDeepStrictEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  fail,
  throws,
  doesNotThrow,
  AssertionError,
});

const assertWithStrict = Object.assign(assert, { strict });

export {
  ok,
  equal,
  strictEqual,
  notEqual,
  notStrictEqual,
  deepEqual,
  deepStrictEqual,
  notDeepEqual,
  notDeepStrictEqual,
  fail,
  throws,
  doesNotThrow,
};
export default assertWithStrict;
