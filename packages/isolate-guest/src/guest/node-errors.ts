/**
 * Node v24.16.0 `internal/errors` for the isolate guest's generated Node sources (ADR-0578,
 * ADR-0579): `makeNodeErrorWithCode`'s shape, the `E()` texts those files throw, `hideStackFrames`.
 * Intrinsics captured at bundle load: a guest replacing `Array.prototype.*` changes no text.
 * Kill condition: Node's own `errors.js` generated for the guest (stream core, ADR-0575).
 */
import { describeReceived, inspect } from '@riftydev/runtime-js/internal';

type Fn = (...args: never[]) => unknown;
const apply = Reflect.apply;
const uncurry =
  <T extends Fn>(f: T) =>
  (self: unknown, ...args: Parameters<T>): ReturnType<T> =>
    apply(f, self, args) as ReturnType<T>;
const sliceString = uncurry(String.prototype.slice);
const indexOf = uncurry(String.prototype.indexOf);
const endsWith = uncurry(String.prototype.endsWith);
const includes = uncurry(String.prototype.includes);
const toLowerCase = uncurry(String.prototype.toLowerCase);
const arrayIncludes = uncurry(Array.prototype.includes);
const arrayIndexOf = uncurry(Array.prototype.indexOf);
const arrayJoin = uncurry(Array.prototype.join);
const arrayPush = uncurry(Array.prototype.push);
const arraySlice = uncurry(Array.prototype.slice);
const arraySplice = uncurry(Array.prototype.splice);
const regExpExec = uncurry(RegExp.prototype.exec);
const isArray = Array.isArray;
const NumberIsInteger = Number.isInteger;
const MathAbs = Math.abs;
const StringCtor = String;
const kIsNodeError = Symbol('kIsNodeError');
const defineProperty = Object.defineProperty;
type Message = (...args: never[]) => string;
type ErrorBase = new (message?: string) => Error;
const captureStackTrace = Error.captureStackTrace;
const ErrorCtor = Error;

/** Node's stack header for its own errors (`TypeError [CODE]: message`, its prepareStackTrace);
 * the isolate formats `stack` when it is captured. */
export function nodeStack(error: Error, key: string): void {
  const stack = (error as { stack?: unknown }).stack;
  if (typeof stack !== 'string') return;
  const frames = indexOf(stack, '\n    at ') as number;
  defineProperty(error, 'stack', {
    value: `${error.name} [${key}]: ${error.message}${frames < 0 ? '' : sliceString(stack, frames)}`,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

/**
 * `makeNodeErrorWithCode(Base, key)`: a `%s` text (`formatted`) is passed to `super` (own keys
 * `stack, message, code`), a function's text defined after it (`stack, code, message`).
 */
function nodeError(Base: ErrorBase, key: string, message: Message, formatted: boolean) {
  class NodeError extends Base {
    code = key;
    constructor(...args: never[]) {
      if (formatted) super(apply(message, undefined, args));
      else super();
      if (!formatted)
        defineProperty(this, 'message', {
          value: apply(message, undefined, args),
          enumerable: false,
          writable: true,
          configurable: true,
        });
      nodeStack(this, key);
    }
    // Node: «a workaround for wpt tests that expect that the error constructor has a `name`
    // property of the base class». A class cannot name an accessor `constructor`.
    // biome-ignore lint/complexity/useLiteralKeys: see above
    override get ['constructor']() {
      return Base;
    }
    get [kIsNodeError]() {
      return true;
    }
    override toString(): string {
      return `${this.name} [${key}]: ${this.message}`;
    }
  }
  return NodeError;
}
/** Node's `makeNodeErrorForHideStackFrame`: what a `hideStackFrames` validator throws. */
function hideStackFramesError(Err: new (...args: never[]) => Error, Base: ErrorBase) {
  return class HideStackFramesError extends Err {
    // biome-ignore lint/complexity/useLiteralKeys: as `nodeError`
    override get ['constructor']() {
      return Base;
    }
  };
}
/**
 * `E(key, message, Base, ...otherClasses)`: `codes[key]`, `codes[key][Other.name]`, and with
 * `HideStackFramesError` among them `codes[key].HideStackFramesError`. `formatted`: a `%s` text.
 */
function E(
  key: string,
  message: Message,
  formatted: boolean,
  Base: ErrorBase,
  others: readonly ErrorBase[] = [],
  hidesFrames = false,
) {
  const ctor = nodeError(Base, key, message, formatted) as ReturnType<typeof nodeError> &
    Record<string, unknown>;
  for (let i = 0; i < others.length; i++) {
    const Other = others[i] as ErrorBase;
    ctor[Other.name] = nodeError(Other, key, message, formatted);
  }
  if (hidesFrames) ctor.HideStackFramesError = hideStackFramesError(ctor, Base);
  return ctor;
}

/** `internal/errors` `formatList`. */
function formatList(list: readonly string[], type = 'and'): string {
  if (list.length < 3) return arrayJoin(list, ` ${type} `) as string;
  return `${arrayJoin(arraySlice(list, 0, -1), ', ')}, ${type} ${list[list.length - 1]}`;
}
const kTypes = [
  'string',
  'function',
  'number',
  'object',
  'Function',
  'Object',
  'boolean',
  'bigint',
  'symbol',
];
const classRegExp = /^[A-Z][a-zA-Z0-9]*$/;
/** `internal/errors` `addNumericalSeparator`. */
function addNumericalSeparator(val: string): string {
  let res = '';
  let i = val.length;
  const start = val[0] === '-' ? 1 : 0;
  for (; i >= start + 4; i -= 3) res = `_${sliceString(val, i - 3, i)}${res}`;
  return `${sliceString(val, 0, i)}${res}`;
}
const ASSERTION_SUFFIX =
  'This is caused by either a bug in Node.js or incorrect usage of Node.js internals.\n' +
  'Please open an issue with this stack trace at https://github.com/nodejs/node/issues\n';

export const codes = {
  ERR_BUFFER_TOO_LARGE: E(
    'ERR_BUFFER_TOO_LARGE',
    (max: number) => `Cannot create a Buffer larger than ${max} bytes`,
    true,
    RangeError,
  ),
  ERR_EVENT_RECURSION: E(
    'ERR_EVENT_RECURSION',
    (type: string) => `The event "${type}" is already being dispatched`,
    true,
    Error,
  ),
  ERR_ILLEGAL_CONSTRUCTOR: E(
    'ERR_ILLEGAL_CONSTRUCTOR',
    () => 'Illegal constructor',
    true,
    TypeError,
  ),
  ERR_INTERNAL_ASSERTION: E(
    'ERR_INTERNAL_ASSERTION',
    (message?: string) =>
      message === undefined ? ASSERTION_SUFFIX : `${message}\n${ASSERTION_SUFFIX}`,
    false,
    Error,
  ),
  ERR_INVALID_ARG_TYPE: E(
    'ERR_INVALID_ARG_TYPE',
    (name: string, expected: string | string[], actual: unknown) => {
      let msg = 'The ';
      if (endsWith(name, ' argument')) msg += `${name} `;
      else msg += `"${name}" ${includes(name, '.') ? 'property' : 'argument'} `;
      msg += 'must be ';
      const types: string[] = [];
      const instances: string[] = [];
      const other: string[] = [];
      const list = isArray(expected) ? expected : [expected];
      for (let i = 0; i < list.length; i++) {
        const value = list[i] as string;
        if (arrayIncludes(kTypes, value)) arrayPush(types, toLowerCase(value) as string);
        else if (regExpExec(classRegExp, value) !== null) arrayPush(instances, value);
        else arrayPush(other, value);
      }
      if (instances.length > 0) {
        const pos = arrayIndexOf(types, 'object') as number;
        if (pos !== -1) {
          arraySplice(types, pos, 1);
          arrayPush(instances, 'Object');
        }
      }
      if (types.length > 0) {
        msg += `${types.length > 1 ? 'one of type' : 'of type'} ${formatList(types, 'or')}`;
        if (instances.length > 0 || other.length > 0) msg += ' or ';
      }
      if (instances.length > 0) {
        msg += `an instance of ${formatList(instances, 'or')}`;
        if (other.length > 0) msg += ' or ';
      }
      if (other.length > 0) {
        if (other.length > 1) msg += `one of ${formatList(other, 'or')}`;
        else {
          if (toLowerCase(other[0] as string) !== other[0]) msg += 'an ';
          msg += `${other[0]}`;
        }
      }
      return `${msg}. ${describeReceived(actual)}`;
    },
    false,
    TypeError,
    [],
    true,
  ),
  ERR_INVALID_ARG_VALUE: E(
    'ERR_INVALID_ARG_VALUE',
    (name: string, value: unknown, reason = 'is invalid') => {
      let inspected = inspect(value);
      if (inspected.length > 128) inspected = `${sliceString(inspected, 0, 128)}...`;
      const type = includes(name, '.') ? 'property' : 'argument';
      return `The ${type} '${name}' ${reason}. Received ${inspected}`;
    },
    false,
    TypeError,
    [RangeError],
    true,
  ),
  ERR_INVALID_STATE: E(
    'ERR_INVALID_STATE',
    (what: string) => `Invalid state: ${what}`,
    true,
    Error,
    [TypeError, RangeError],
  ),
  ERR_INVALID_THIS: E(
    'ERR_INVALID_THIS',
    (type: string) => `Value of "this" must be of type ${type}`,
    true,
    TypeError,
    [],
    true,
  ),
  ERR_MISSING_ARGS: E(
    'ERR_MISSING_ARGS',
    (...args: (string | string[])[]) => {
      const names: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as string | string[];
        if (!isArray(a)) arrayPush(names, `"${a}"`);
        else {
          const wrapped: string[] = [];
          for (let j = 0; j < a.length; j++) arrayPush(wrapped, `"${a[j]}"`);
          arrayPush(names, arrayJoin(wrapped, ' or ') as string);
        }
      }
      return `The ${formatList(names)} argument${args.length > 1 ? 's' : ''} must be specified`;
    },
    false,
    TypeError,
  ),
  ERR_OUT_OF_RANGE: E(
    'ERR_OUT_OF_RANGE',
    (str: string, range: string, input: unknown, replaceDefaultBoolean = false) => {
      let msg = replaceDefaultBoolean ? str : `The value of "${str}" is out of range.`;
      let received: string;
      if (NumberIsInteger(input) && MathAbs(input as number) > 2 ** 32) {
        received = addNumericalSeparator(StringCtor(input));
      } else if (typeof input === 'bigint') {
        received = StringCtor(input);
        if (input > 2n ** 32n || input < -(2n ** 32n)) received = addNumericalSeparator(received);
        received += 'n';
      } else {
        received = inspect(input);
      }
      msg += ` It must be ${range}. Received ${received}`;
      return msg;
    },
    false,
    RangeError,
    [],
    true,
  ),
};

/** `internal/errors` `hideStackFrames`: the error's frames start at the wrapper's caller. */
export function hideStackFrames<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  function wrappedFn(this: unknown, ...args: A): R {
    try {
      return apply(fn, this, args) as R;
    } catch (error) {
      if ((ErrorCtor as { stackTraceLimit?: number }).stackTraceLimit) {
        captureStackTrace(error as object, wrappedFn);
        const code = (error as { code?: unknown }).code;
        if ((error as Record<symbol, unknown>)[kIsNodeError] === true && typeof code === 'string')
          nodeStack(error as Error, code);
      }
      throw error;
    }
  }
  (wrappedFn as { withoutStackTrace?: unknown }).withoutStackTrace = fn;
  return wrappedFn;
}
