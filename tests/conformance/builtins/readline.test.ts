import { describe, expect, it } from 'vitest';
import { readline } from '../../../packages/runtime-js/src/builtins/null-net-stubs.ts';

/**
 * Loud-throw guarantee for the readline shim: every method must surface
 * `NotImplementedError('readline.<method>')` rather than returning
 * `undefined`. Asserts by `err.name` + `err.feature` so the test does not
 * depend on a particular module-instance of `NotImplementedError` (the
 * runtime-js source imports `@riftydev/io`; this test cannot, since `@riftydev/io`
 * is not linked into `tests/node_modules`).
 */
function expectFeatureThrow(fn: () => unknown, feature: string): void {
  try {
    fn();
    throw new Error(`expected ${feature} to throw NotImplementedError`);
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('NotImplementedError');
    expect((err as Error & { feature?: string }).feature).toBe(feature);
    expect((err as Error).message).toContain(feature);
  }
}

describe('node:readline loud-throw stub', () => {
  it('imports without throwing and exposes expected methods', () => {
    expect(readline).toBeDefined();
    expect(typeof readline.createInterface).toBe('function');
    expect(typeof readline.cursorTo).toBe('function');
    expect(typeof readline.clearLine).toBe('function');
    expect(typeof readline.clearScreenDown).toBe('function');
    expect(typeof readline.emitKeypressEvents).toBe('function');
  });

  it('createInterface throws NotImplementedError', () => {
    expectFeatureThrow(() => readline.createInterface(), 'readline.createInterface');
  });

  it('cursorTo throws NotImplementedError', () => {
    expectFeatureThrow(() => readline.cursorTo(), 'readline.cursorTo');
  });

  it('clearLine throws NotImplementedError', () => {
    expectFeatureThrow(() => readline.clearLine(), 'readline.clearLine');
  });

  it('clearScreenDown throws NotImplementedError', () => {
    expectFeatureThrow(() => readline.clearScreenDown(), 'readline.clearScreenDown');
  });

  it('emitKeypressEvents throws NotImplementedError', () => {
    expectFeatureThrow(() => readline.emitKeypressEvents(), 'readline.emitKeypressEvents');
  });
});
