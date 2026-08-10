import { describe, expect, it } from 'vitest';
import { promisify } from './util.ts';

const custom = Symbol.for('nodejs.util.promisify.custom');

describe('util.promisify custom contract', () => {
  it('publishes Node custom symbol and returns the exact custom function', () => {
    const implementation = async (): Promise<string> => 'custom';
    const original = Object.defineProperty(() => undefined, custom, { value: implementation });

    expect((promisify as unknown as { custom: symbol }).custom).toBe(custom);
    expect(promisify(original)).toBe(implementation);
    expect(Reflect.get(implementation, custom)).toBe(implementation);
  });

  it('marks ordinary wrappers as their own custom implementation', async () => {
    const original = (value: string, callback: (error: null, value: string) => void): void => {
      callback(null, value);
    };
    const wrapped = promisify(original as never);

    expect(Reflect.get(wrapped, custom)).toBe(wrapped);
    await expect(wrapped('ok')).resolves.toBe('ok');
  });

  it('rejects a non-function custom projection synchronously', () => {
    const original = Object.defineProperty(() => undefined, custom, { value: 1 });
    expect(() => promisify(original)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }) as Error,
    );
  });

  it.each([null, false, 0, ''])('ignores falsy custom projection %j', async (customValue) => {
    const original = Object.defineProperty(
      (callback: (error: null, value: string) => void) => callback(null, 'ordinary'),
      custom,
      { value: customValue },
    );
    const wrapped = promisify(original as never);

    expect(wrapped).not.toBe(original);
    await expect(wrapped()).resolves.toBe('ordinary');
  });
});
