import { describe, expect, it } from 'vitest';
import assert, {
  strict,
  AssertionError,
} from '../../../packages/runtime-js/src/builtins/assert.ts';

describe('node:assert', () => {
  it('ok throws on falsy', () => {
    expect(() => assert.ok(false)).toThrow(AssertionError);
    expect(() => assert.ok(true)).not.toThrow();
  });
  it('strictEqual', () => {
    assert.strictEqual(1, 1);
    expect(() => assert.strictEqual(1, '1' as unknown as number)).toThrow();
  });
  it('deepStrictEqual', () => {
    assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 2] });
    expect(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })).toThrow();
    expect(() => assert.deepStrictEqual({ a: 1 }, { a: 1, b: 2 })).toThrow();
  });
  it('throws() catches expected error type', () => {
    assert.throws(() => {
      throw new TypeError('x');
    }, TypeError);
    expect(() =>
      assert.throws(() => {
        /* nothing */
      }),
    ).toThrow();
  });
  it('strict mode uses strict comparisons', () => {
    strict.equal(1, 1);
    expect(() => strict.equal(1, '1' as unknown as number)).toThrow();
  });
});
