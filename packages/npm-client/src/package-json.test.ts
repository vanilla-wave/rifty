import { describe, expect, it } from 'vitest';
import { serializePackageJson } from './package-json.ts';

describe('serializePackageJson', () => {
  it('owns one recursive key order and trailing newline', () => {
    expect(
      serializePackageJson({
        scripts: { test: 'vitest', build: 'tsc' },
        name: 'fixture',
        nested: [{ z: true, a: null }],
      }),
    ).toBe(
      '{"name":"fixture","nested":[{"a":null,"z":true}],"scripts":{"build":"tsc","test":"vitest"}}\n',
    );
  });

  it.each([null, [], Number.NaN, { value: Number.POSITIVE_INFINITY }, { value: undefined }])(
    'rejects non-manifest or non-JSON input %j',
    (value) => {
      expect(() => serializePackageJson(value)).toThrow(TypeError);
    },
  );

  it('rejects sparse arrays and arrays with extra own state', () => {
    const sparse = new Array<unknown>(1);
    const extra: unknown[] = [];
    Object.defineProperty(extra, 'note', { value: 'lost', enumerable: true });

    expect(() => serializePackageJson({ value: sparse })).toThrow(TypeError);
    expect(() => serializePackageJson({ value: extra })).toThrow(TypeError);
  });

  it('rejects accessors without invoking them', () => {
    let getterCalls = 0;
    const object = {};
    Object.defineProperty(object, 'value', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'lost';
      },
    });
    const array: unknown[] = [];
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'lost';
      },
    });

    expect(() => serializePackageJson(object)).toThrow(TypeError);
    expect(() => serializePackageJson({ value: array })).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });

  it('rejects symbol and non-enumerable own properties', () => {
    const symbolState = { name: 'fixture', [Symbol('lost')]: true };
    const hiddenState = { name: 'fixture' };
    Object.defineProperty(hiddenState, 'lost', { value: true });

    expect(() => serializePackageJson(symbolState)).toThrow(TypeError);
    expect(() => serializePackageJson(hiddenState)).toThrow(TypeError);
  });

  it('rejects non-plain objects but accepts null-prototype JSON records', () => {
    class Manifest {
      readonly name = 'fixture';
    }
    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    customPrototype.name = 'fixture';
    for (const value of [new Date(0), new Manifest(), new Uint8Array([1]), customPrototype]) {
      expect(() => serializePackageJson(value)).toThrow(TypeError);
    }

    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.z = 1;
    nullPrototype.a = 'ok';
    expect(serializePackageJson(nullPrototype)).toBe('{"a":"ok","z":1}\n');
  });

  it('rejects circular values but accepts shared acyclic references', () => {
    const objectCycle: Record<string, unknown> = {};
    objectCycle.self = objectCycle;
    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);

    expect(() => serializePackageJson(objectCycle)).toThrow(TypeError);
    expect(() => serializePackageJson({ value: arrayCycle })).toThrow(TypeError);

    const shared = { b: 2, a: 1 };
    expect(serializePackageJson({ left: shared, right: shared })).toBe(
      '{"left":{"a":1,"b":2},"right":{"a":1,"b":2}}\n',
    );
  });

  it('rejects every unsupported JSON leaf in objects and arrays', () => {
    const unsupported: readonly unknown[] = [
      undefined,
      () => undefined,
      Symbol('value'),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const value of unsupported) {
      expect(() => serializePackageJson({ value })).toThrow(TypeError);
      expect(() => serializePackageJson({ value: [value] })).toThrow(TypeError);
    }
  });
});
