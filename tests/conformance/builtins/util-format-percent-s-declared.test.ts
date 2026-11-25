/**
 * `util.format('%s')` rows declared to differ from Node v24.16.0 (unit
 * `runtime-js/util-format-percent-s` §Out of scope; every host shares this code). Each
 * pins rifty's text; a fix turns it red, and the row joins parity `util/format-percent-s`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import '../../../packages/runtime-js/src/builtins/index.ts';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
import util from '../../../packages/runtime-js/src/builtins/util.ts';
import { ensureVmEngineReady } from '../../../packages/runtime-js/src/builtins/vm/quickjs-loader.ts';

const vm = loadBuiltin('node:vm') as {
  runInNewContext(code: string): unknown;
};
const format = (v: unknown): string => {
  try {
    return util.format('%s', v);
  } catch (e) {
    return `throw ${(e as Error).message}`;
  }
};

beforeAll(async () => {
  await ensureVmEngineReady();
});

describe('util.format %s: declared rows (runtime-js/format-inspect-proxy-traps)', () => {
  it('a trap throwing on the toString/Symbol.toPrimitive read or own check throws', () => {
    // Node (target read without traps) and rifty before the %s dispatch: `{ a: 1 }`.
    const throwing = (trap: 'get' | 'getOwnPropertyDescriptor', key: PropertyKey) =>
      new Proxy(
        { a: 1 },
        {
          [trap](t: object, k: PropertyKey, r?: unknown) {
            if (k === key) throw new Error(String(trap));
            return trap === 'get' ? Reflect.get(t, k, r) : Reflect.getOwnPropertyDescriptor(t, k);
          },
        },
      );
    expect(format(throwing('get', 'toString'))).toBe('throw get');
    expect(format(throwing('get', Symbol.toPrimitive))).toBe('throw get');
    expect(format(throwing('getOwnPropertyDescriptor', 'toString'))).toBe(
      'throw getOwnPropertyDescriptor',
    );
  });

  it('a walk ending at a Proxy over a null-prototype object prints where Node throws', () => {
    // Node: `TypeError: Cannot convert undefined or null to object` — the value is no Proxy,
    // so its walk goes through the chain's Proxy to null; rifty reads a null end as built-in.
    const value = Object.create(new Proxy(Object.create(null), { get: () => () => 1 }));
    expect(format(value)).toBe('{}');
  });
});

describe('util.format %s: declared rows (runtime-js/vm-membrane-percent-s-branch)', () => {
  it('a vm Date or Error takes the String() branch where Node inspects', () => {
    // Node: `1970-01-01T00:00:00.000Z` / the stack; rifty's membrane prototypes have no own
    // `constructor`, so the toString reads as a user one.
    const date = vm.runInNewContext('new Date(0)') as Date;
    expect(format(date)).toBe(String(date));
    expect(format(date)).not.toBe('1970-01-01T00:00:00.000Z');
    const error = vm.runInNewContext('new Error("m")') as Error;
    expect(format(error)).toBe('Error: m');
  });
});
