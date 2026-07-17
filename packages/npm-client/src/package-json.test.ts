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
});
