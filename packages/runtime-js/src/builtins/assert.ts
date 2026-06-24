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
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return (
      a instanceof RegExp &&
      b instanceof RegExp &&
      a.source === b.source &&
      a.flags === b.flags &&
      a.lastIndex === b.lastIndex
    );
  }
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    return (
      a instanceof ArrayBuffer &&
      b instanceof ArrayBuffer &&
      bytesEqual(new Uint8Array(a), new Uint8Array(b))
    );
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    return viewsEqual(a, b);
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    const unmatched = [...b];
    for (const av of a) {
      const idx = unmatched.findIndex((bv) => deepEqualImpl(av, bv, strict, seen));
      if (idx === -1) return false;
      unmatched.splice(idx, 1);
    }
    return true;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    const unmatched = [...b];
    for (const [ak, av] of a) {
      const idx = unmatched.findIndex(
        ([bk, bv]) => deepEqualImpl(ak, bk, strict, seen) && deepEqualImpl(av, bv, strict, seen),
      );
      if (idx === -1) return false;
      unmatched.splice(idx, 1);
    }
    return true;
  }
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function viewsEqual(a: unknown, b: unknown): boolean {
  if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  return bytesEqual(
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
    new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );
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
 * `assert.throws` / `assert.doesNotThrow` / `assert.rejects`):
 *   - RegExp: match `err.message` (or `String(err)` if not an Error).
 *   - Error-subtype constructor: `err instanceof expected`.
 *   - Any other function: predicate `(err) => truthy`.
 *   - Error INSTANCE: same `name` + `message` + every own-enumerable prop deep-equal.
 *   - Validation OBJECT: every own key deep-equals the error's same key (a RegExp
 *     value tests the error's stringified field); a missing/mismatched key fails.
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
  if (expected instanceof Error) {
    if (err === null || typeof err !== 'object') return false;
    const e = err as Record<string, unknown> & { name?: unknown; message?: unknown };
    if (e.name !== expected.name || e.message !== expected.message) return false;
    // `name`/`message` are non-enumerable on Error, so this checks only extra
    // own-enumerable props the caller set on the expected error (e.g. `code`).
    const expectedProps = expected as unknown as Record<string, unknown>;
    for (const k of Object.keys(expected)) {
      if (!deepEqualImpl(e[k], expectedProps[k], true, new WeakMap())) {
        return false;
      }
    }
    return true;
  }
  if (expected !== null && typeof expected === 'object') {
    if (err === null || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    for (const k of Object.keys(expected)) {
      const exp = (expected as Record<string, unknown>)[k];
      if (exp instanceof RegExp) {
        if (!exp.test(String(e[k]))) return false;
      } else if (!deepEqualImpl(e[k], exp, true, new WeakMap())) {
        return false;
      }
    }
    return true;
  }
  throw new TypeError('The "expected" argument must be of type Function or an instance of RegExp');
}

/** TypeError carrying Node's `ERR_INVALID_ARG_TYPE` code (message prose is not pinned). */
function invalidArgType(name: string, expected: string, actual: unknown): TypeError {
  const err = new TypeError(
    `The "${name}" argument must be of type ${expected}. Received ${typeof actual}`,
  );
  (err as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
  return err;
}

/**
 * `assert.partialDeepStrictEqual(actual, expected)` (v23.4 exp): `expected` is a
 * recursive SUBSET of `actual`. Objects compare own-enumerable keys present in
 * `expected`; arrays must contain `expected` as an in-order subsequence (greedy);
 * Map/Set check each expected entry/element is present; leaves compare strict.
 */
function partialMatch(actual: unknown, expected: unknown, seen: WeakMap<object, object>): boolean {
  if (Object.is(actual, expected)) return true;
  // Primitive (or function) expected that isn't identical → no partial leeway.
  if (expected === null || typeof expected !== 'object') return false;
  if (actual === null || typeof actual !== 'object') return false;
  const sa = seen.get(actual);
  if (sa === expected) return true;
  seen.set(actual, expected as object);

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    let ai = 0;
    for (const exp of expected) {
      let found = false;
      while (ai < actual.length) {
        if (partialMatch(actual[ai++], exp, seen)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }
  if (expected instanceof Map) {
    if (!(actual instanceof Map)) return false;
    for (const [k, v] of expected) {
      if (!actual.has(k) || !partialMatch(actual.get(k), v, seen)) return false;
    }
    return true;
  }
  if (expected instanceof Set) {
    if (!(actual instanceof Set)) return false;
    for (const exp of expected) {
      let ok = false;
      for (const a of actual) {
        if (partialMatch(a, exp, seen)) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
    return true;
  }
  // Special leaf objects (Date/RegExp/typed arrays) compare strictly-whole.
  if (
    expected instanceof Date ||
    expected instanceof RegExp ||
    expected instanceof ArrayBuffer ||
    ArrayBuffer.isView(expected)
  ) {
    return deepEqualImpl(actual, expected, true, new WeakMap());
  }
  // Plain-ish object: every own-enumerable key of `expected` must partial-match.
  for (const k of Object.keys(expected)) {
    if (
      !partialMatch(
        (actual as Record<string, unknown>)[k],
        (expected as Record<string, unknown>)[k],
        seen,
      )
    ) {
      return false;
    }
  }
  return true;
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
  if (typeof fn !== 'function') throw invalidArgType('fn', 'function', fn);
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
  if (typeof fn !== 'function') throw invalidArgType('fn', 'function', fn);
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

function match(value: unknown, regexp: unknown, message?: string): void {
  if (!(regexp instanceof RegExp)) throw invalidArgType('regexp', 'RegExp', regexp);
  // `RegExp.test` coerces a non-string `value` to a string, so a non-string
  // input simply fails the match (Node throws AssertionError there too).
  if (!regexp.test(value as string)) {
    throw new AssertionError({ message, actual: value, expected: regexp, operator: 'match' });
  }
}

function doesNotMatch(value: unknown, regexp: unknown, message?: string): void {
  if (!(regexp instanceof RegExp)) throw invalidArgType('regexp', 'RegExp', regexp);
  if (regexp.test(value as string)) {
    throw new AssertionError({
      message,
      actual: value,
      expected: regexp,
      operator: 'doesNotMatch',
    });
  }
}

/**
 * `assert.ifError(value)` — throw when `value` is not `null`/`undefined`, wrapped
 * in an AssertionError. When the value is an Error, the ORIGINAL stack is
 * appended so the throw site that produced it is preserved (Node contract).
 */
function ifError(value: unknown): void {
  if (value === null || value === undefined) return;
  const detail = value instanceof Error ? value.message : stringify(value);
  const err = new AssertionError({
    message: `ifError got unwanted exception: ${detail}`,
    actual: value,
    expected: null,
    operator: 'ifError',
  });
  if (value instanceof Error && typeof value.stack === 'string') {
    // Append the original error's frames (drop its header line) after ours.
    const origFrames = value.stack.split('\n').slice(1).join('\n');
    if (origFrames) err.stack = `${err.stack ?? `${err.name}: ${err.message}`}\n${origFrames}`;
  }
  throw err;
}

/** Disambiguate Node's `(asyncFn[, error][, message])`: a string 2nd arg is the message. */
function splitErrorMessage(
  expectedOrMessage: unknown,
  message?: string,
): { expected: unknown; msg: string | undefined } {
  if (typeof expectedOrMessage === 'string') return { expected: undefined, msg: expectedOrMessage };
  return { expected: expectedOrMessage, msg: message };
}

function isThenable(v: unknown): boolean {
  return v != null && typeof (v as { then?: unknown }).then === 'function';
}

/**
 * Resolve the `rejects`/`doesNotReject` first arg to a thenable, matching Node's two
 * guards: a non-function-non-thenable arg is `ERR_INVALID_ARG_TYPE`; a function whose
 * return is not a thenable is `ERR_INVALID_RETURN_VALUE` (never silently await a
 * non-promise — that would resolve and mis-report "Missing expected rejection").
 */
function toPromise(promiseOrFn: unknown): Promise<unknown> {
  if (typeof promiseOrFn === 'function') {
    const ret = (promiseOrFn as () => unknown)();
    if (!isThenable(ret)) {
      const e = new TypeError(
        `Expected instance of Promise to be returned from the "promiseFn" function but got ${ret === null ? 'null' : typeof ret === 'string' ? `type string ('${ret}')` : `type ${typeof ret}`}.`,
      );
      (e as { code?: string }).code = 'ERR_INVALID_RETURN_VALUE';
      throw e;
    }
    return ret as Promise<unknown>;
  }
  if (isThenable(promiseOrFn)) return promiseOrFn as Promise<unknown>;
  const e = new TypeError(
    `The "promiseFn" argument must be of type function or an instance of Promise. Received ${promiseOrFn === null ? 'null' : `type ${typeof promiseOrFn}`}`,
  );
  (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
  throw e;
}

async function rejects(
  promiseOrFn: Promise<unknown> | (() => Promise<unknown>),
  expectedOrMessage?: unknown,
  message?: string,
): Promise<void> {
  // `toPromise` runs the fn + validates arg/return OUTSIDE the try, so its
  // ERR_INVALID_ARG_TYPE / ERR_INVALID_RETURN_VALUE isn't swallowed as "the rejection".
  const p = toPromise(promiseOrFn);
  const { expected, msg } = splitErrorMessage(expectedOrMessage, message);
  try {
    await p;
  } catch (err) {
    if (expected !== undefined && !matchesExpected(err, expected)) {
      throw new AssertionError({ message: msg, actual: err, expected, operator: 'rejects' });
    }
    return;
  }
  throw new AssertionError({
    message: msg ?? 'Missing expected rejection.',
    operator: 'rejects',
  });
}

async function doesNotReject(
  promiseOrFn: Promise<unknown> | (() => Promise<unknown>),
  expectedOrMessage?: unknown,
  message?: string,
): Promise<void> {
  const p = toPromise(promiseOrFn);
  const { expected, msg } = splitErrorMessage(expectedOrMessage, message);
  try {
    await p;
  } catch (err) {
    // Re-throw a non-matching rejection unchanged (Node spec); else it's a failure.
    if (expected !== undefined && !matchesExpected(err, expected)) throw err;
    throw new AssertionError({
      message: msg ?? 'Got unwanted rejection.',
      actual: err,
      expected,
      operator: 'doesNotReject',
    });
  }
}

function partialDeepStrictEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!partialMatch(actual, expected, new WeakMap())) {
    throw new AssertionError({ message, actual, expected, operator: 'partialDeepStrictEqual' });
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
    match,
    doesNotMatch,
    ifError,
    rejects,
    doesNotReject,
    partialDeepStrictEqual,
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
  match,
  doesNotMatch,
  ifError,
  rejects,
  doesNotReject,
  partialDeepStrictEqual,
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
  match,
  doesNotMatch,
  ifError,
  rejects,
  doesNotReject,
  partialDeepStrictEqual,
};
export default assertWithStrict;
