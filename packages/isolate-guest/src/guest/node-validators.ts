/**
 * Node's `internal/validators` + `internal/errors` texts the guest's `http`/`net`
 * members throw (Node v24.16.0): same constructor, `code` and message.
 */
import { describeReceived, inspect } from '@riftydev/runtime-js/internal';

export function nodeError<E extends Error>(
  Ctor: new (message: string) => E,
  code: string,
  message: string,
): E {
  return Object.assign(new Ctor(message), { code });
}

export function invalidArgType(name: string, type: string, value: unknown): TypeError {
  return nodeError(
    TypeError,
    'ERR_INVALID_ARG_TYPE',
    `The "${name}" argument must be of type ${type}. ${describeReceived(value)}`,
  );
}

/** `addNumericalSeparator`: `9007199254740992` → `9_007_199_254_740_992`. */
function withSeparators(digits: string): string {
  let res = '';
  let i = digits.length;
  const start = digits[0] === '-' ? 1 : 0;
  for (; i >= start + 4; i -= 3) res = `_${digits.slice(i - 3, i)}${res}`;
  return `${digits.slice(0, i)}${res}`;
}

export function outOfRange(name: string, range: string, value: number): RangeError {
  const received =
    Number.isInteger(value) && Math.abs(value) > 2 ** 32
      ? withSeparators(String(value))
      : inspect(value);
  return nodeError(
    RangeError,
    'ERR_OUT_OF_RANGE',
    `The value of "${name}" is out of range. It must be ${range}. Received ${received}`,
  );
}

export function validateBoolean(value: unknown, name: string): void {
  if (typeof value !== 'boolean') throw invalidArgType(name, 'boolean', value);
}

export function validateInteger(
  value: unknown,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (typeof value !== 'number') throw invalidArgType(name, 'number', value);
  if (!Number.isInteger(value)) throw outOfRange(name, 'an integer', value);
  if (value < min || value > max) throw outOfRange(name, `>= ${min} && <= ${max}`, value);
}

/** `validateNumber(value, name, min)` with no `max`, the only form the guest needs. */
export function validateNumberAtLeast(value: unknown, name: string, min: number): void {
  if (typeof value !== 'number') throw invalidArgType(name, 'number', value);
  if (value < min || Number.isNaN(value)) throw outOfRange(name, `>= ${min}`, value);
}

export function validateOneOf(value: unknown, name: string, oneOf: readonly string[]): void {
  if (oneOf.includes(value as string)) return;
  let inspected = inspect(value);
  if (inspected.length > 128) inspected = `${inspected.slice(0, 128)}...`;
  const kind = name.includes('.') ? 'property' : 'argument';
  throw nodeError(
    TypeError,
    'ERR_INVALID_ARG_VALUE',
    `The ${kind} '${name}' must be one of: ${oneOf.map((v) => `'${v}'`).join(', ')}. Received ${inspected}`,
  );
}
