import { describe, expect, it } from 'vitest';
import { serializeRuntimeError } from './worker-fs-rpc.ts';

describe('runtime error cause projection', () => {
  it('does not evaluate an accessor cause on a genuine Error', () => {
    let reads = 0;
    const failure = new Error('outer');
    Object.defineProperty(failure, 'cause', {
      get() {
        reads++;
        throw new Error('must not read');
      },
    });
    expect(serializeRuntimeError(failure)).toMatchObject({ name: 'Error', message: 'outer' });
    expect(reads).toBe(0);
  });
  for (const key of ['name', 'message']) {
    it(`does not execute a cause ${key} accessor or lose the outer receipt`, () => {
      let reads = 0;
      const cause = new Error('inner');
      Object.defineProperty(cause, key, {
        get() {
          reads++;
          throw new Error('must not read');
        },
      });
      const serialized = serializeRuntimeError(new Error('outer', { cause }));
      expect(serialized).toMatchObject({ name: 'Error', message: 'outer' });
      expect(serialized.cause).toBeUndefined();
      expect(reads).toBe(0);
    });
  }
  it('bounds metadata inspection when a cause proxy invents a prototype cycle', () => {
    let reads = 0;
    const cause: object = new Proxy(
      {},
      {
        getPrototypeOf() {
          if (++reads > 100) throw new Error('fixture stops an unbounded traversal');
          return cause;
        },
      },
    );
    const serialized = serializeRuntimeError(new Error('outer', { cause }));
    expect(serialized.message).toBe('outer');
    expect(serialized.cause).toBeUndefined();
    expect(reads).toBeLessThan(32);
  });
  it('retains data Error and native DOMException descriptions', () => {
    for (const cause of [
      new TypeError('typed'),
      new DOMException('native occupied', 'NoModificationAllowedError'),
    ]) {
      expect(serializeRuntimeError(new Error('outer', { cause })).cause).toEqual({
        name: cause.name,
        message: cause.message,
      });
    }
  });
});
