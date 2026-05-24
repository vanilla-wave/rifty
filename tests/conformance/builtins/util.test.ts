import { describe, expect, it } from 'vitest';
import util from '../../../packages/runtime-js/src/builtins/util.ts';

describe('node:util.format', () => {
  it('substitutes %s/%d/%j', () => {
    expect(util.format('hello %s', 'world')).toBe('hello world');
    expect(util.format('n=%d', 5)).toBe('n=5');
    expect(util.format('o=%j', { a: 1 })).toBe('o={"a":1}');
  });
  it('extra args get appended', () => {
    expect(util.format('%s', 'a', 'b')).toBe('a b');
  });
  it('%% escapes percent', () => {
    expect(util.format('100%%')).toBe('100%');
  });
  it('non-string first arg joins all args via inspect/strings', () => {
    expect(util.format(1, 2)).toBe('1 2');
  });
});

describe('node:util.promisify', () => {
  it('converts node-style callback to promise', async () => {
    const fn = (a: number, b: number, cb: (err: unknown, v?: unknown) => void) => cb(null, a + b);
    const p = util.promisify(fn as never);
    await expect(p(1, 2)).resolves.toBe(3);
  });
  it('rejects on error', async () => {
    const fn = (cb: (err: unknown) => void) => cb(new Error('x'));
    await expect(util.promisify(fn as never)()).rejects.toThrow('x');
  });
});

describe('node:util.inherits', () => {
  it('chains prototypes', () => {
    function Parent(this: unknown) {}
    Parent.prototype.greet = () => 'hi';
    function Child(this: unknown) {
      (Parent as unknown as new () => undefined).call(this);
    }
    util.inherits(Child, Parent);
    const c = new (Child as unknown as new () => { greet(): string })();
    expect(c.greet()).toBe('hi');
  });
});

describe('node:util.types', () => {
  it('isPromise / isDate / isUint8Array', () => {
    expect(util.types.isPromise(Promise.resolve())).toBe(true);
    expect(util.types.isDate(new Date())).toBe(true);
    expect(util.types.isUint8Array(new Uint8Array(2))).toBe(true);
    expect(util.types.isPromise(1)).toBe(false);
  });
});
