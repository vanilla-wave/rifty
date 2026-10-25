import { describe, expect, it } from 'vitest';
import { clearRuntimeEsbuild, publishRuntimeEsbuild, readRuntimeEsbuild } from './realm.ts';
const RUNTIME_JS_ROOT_KEY = '__riftyShadowRegistry';
type MaybeGlobal = { __riftyShadowRegistry?: Record<string, unknown>; __riftyEsbuild?: unknown };
function withClean(run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, RUNTIME_JS_ROOT_KEY);
  Reflect.deleteProperty(globalThis, RUNTIME_JS_ROOT_KEY);
  try {
    run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, RUNTIME_JS_ROOT_KEY);
    else Object.defineProperty(globalThis, RUNTIME_JS_ROOT_KEY, previous);
  }
}
describe('esbuild public seam', () => {
  it('returns null before this realm publishes an outer', () => {
    withClean(() => {
      expect(readRuntimeEsbuild()).toBeNull();
    });
  });

  it('publishes under the owner-table key and preserves exact identity', () => {
    withClean(() => {
      const outer = Object.freeze({ version: '0.28.0', build: () => undefined });
      publishRuntimeEsbuild(outer);

      expect(readRuntimeEsbuild()).toBe(outer);
      const root = (globalThis as MaybeGlobal)[RUNTIME_JS_ROOT_KEY] as
        | Record<string, unknown>
        | undefined;
      expect(root?.esbuild).toBe(outer);
      expect((globalThis as MaybeGlobal).__riftyEsbuild).toBeUndefined();
    });
  });

  it('uses owner-table overwrite semantics without mutating either outer', () => {
    withClean(() => {
      const first = Object.freeze({ version: 'first' });
      const second = Object.freeze({ version: 'second' });

      publishRuntimeEsbuild(first);
      publishRuntimeEsbuild(second);

      expect(readRuntimeEsbuild()).toBe(second);
      expect(first).toEqual({ version: 'first' });
      expect(second).toEqual({ version: 'second' });
    });
  });
});

it('withdraws a previous runtime without publishing an absent adapter slot', () => {
  withClean(() => {
    clearRuntimeEsbuild();
    expect(Reflect.has(globalThis, RUNTIME_JS_ROOT_KEY)).toBe(false);
    publishRuntimeEsbuild(Object.freeze({ version: 'prior' }));
    clearRuntimeEsbuild();
    const realm = (globalThis as MaybeGlobal)[RUNTIME_JS_ROOT_KEY];
    expect(realm !== undefined && Reflect.has(realm, 'esbuild')).toBe(false);
    expect(readRuntimeEsbuild()).toBeNull();
  });
});
