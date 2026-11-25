import { inspect } from '../repl/inspect.ts';

/** Node's `ERR_INVALID_ARG_TYPE` "Received …" tail (`internal/errors` determineSpecificType). */
export function describeReceived(value: unknown): string {
  if (value === null) return 'Received null';
  if (value === undefined) return 'Received undefined';
  switch (typeof value) {
    case 'bigint':
      return `Received type bigint (${String(value)}n)`;
    case 'number':
      return `Received type number (${Object.is(value, -0) ? '-0' : String(value)})`;
    case 'boolean':
    case 'symbol':
      return `Received type ${typeof value} (${String(value)})`;
    case 'function':
      return `Received function ${(value as { name: string }).name}`;
    case 'string': {
      const shown = value.length > 28 ? `${value.slice(0, 25)}...` : value;
      return `Received type string (${shown.includes("'") ? JSON.stringify(shown) : `'${shown}'`})`;
    }
    default: {
      const constructor = (value as { constructor?: { name?: unknown } }).constructor;
      if (constructor && 'name' in constructor)
        return `Received an instance of ${constructor.name}`;
      return `Received ${inspect(value, { depth: -1 })}`;
    }
  }
}

/** `TypeError` with Node's `ERR_INVALID_ARG_TYPE` code and message. */
export function invalidArgType(what: string, expected: string, value: unknown): TypeError {
  return Object.assign(
    new TypeError(`The ${what} must be ${expected}. ${describeReceived(value)}`),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

/** `RangeError` with Node's `ERR_OUT_OF_RANGE` code and message for a number or bigint. */
export function outOfRange(name: string, range: string, value: number | bigint): RangeError {
  const received =
    typeof value === 'bigint'
      ? `${value > 2n ** 32n || value < -(2n ** 32n) ? addNumericalSeparator(String(value)) : String(value)}n`
      : Number.isInteger(value) && Math.abs(value) > 2 ** 32
        ? addNumericalSeparator(String(value))
        : Object.is(value, -0)
          ? '-0'
          : String(value);
  return Object.assign(
    new RangeError(
      `The value of "${name}" is out of range. It must be ${range}. Received ${received}`,
    ),
    { code: 'ERR_OUT_OF_RANGE' },
  );
}

/** Node's `addNumericalSeparator` (`8_589_934_592`). */
function addNumericalSeparator(value: string): string {
  let result = '';
  let index = value.length;
  const start = value[0] === '-' ? 1 : 0;
  for (; index >= start + 4; index -= 3) result = `_${value.slice(index - 3, index)}${result}`;
  return `${value.slice(0, index)}${result}`;
}
