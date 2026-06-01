import { describe, expect, it } from 'vitest';
import { async_hooks } from '../../../packages/runtime-js/src/builtins/misc-stubs.ts';

/**
 * Regression for the real-express body-parser path: raw-body@2.5.x binds its
 * completion callback through `AsyncResource.runInAsyncScope(cb, thisArg, err,
 * buf)`. A stub that called `fn()` without forwarding args dropped `(err, buf)`,
 * so body-parser's callback fired empty and `req.body` stayed `{}`.
 */
describe('async_hooks.AsyncResource.runInAsyncScope', () => {
  it('forwards thisArg and args, and returns the result', () => {
    const res = new async_hooks.AsyncResource('test');
    const ctx = { v: 10 };
    const out = res.runInAsyncScope(
      function (this: typeof ctx, a: number, b: number) {
        return this.v + a + b;
      },
      ctx,
      2,
      3,
    );
    expect(out).toBe(15);
  });

  it('forwards args even without a thisArg (raw-body callback shape)', () => {
    const res = new async_hooks.AsyncResource('rawbody');
    let seen: unknown[] = [];
    res.runInAsyncScope(
      (...args: unknown[]) => {
        seen = args;
      },
      null,
      null,
      '{"a":1}',
    );
    expect(seen).toEqual([null, '{"a":1}']);
  });
});

/**
 * Synchronous-scope fidelity of `AsyncLocalStorage` — what opencode's
 * `LocalContext.{provide,use}` (`util/local-context.ts`) relies on. Cross-`await`
 * propagation is a documented gap (no native async-context tracking in the
 * realm), so these cases are deliberately synchronous, where rifty matches Node.
 */
describe('async_hooks.AsyncLocalStorage (synchronous scope)', () => {
  it('run sets the store for the callback and restores after; getStore is undefined outside', () => {
    const als = new async_hooks.AsyncLocalStorage<{ id: number }>();
    expect(als.getStore()).toBeUndefined();
    const ret = als.run(
      { id: 1 },
      (a: number, b: number) => {
        expect(als.getStore()).toEqual({ id: 1 });
        return a + b;
      },
      2,
      3,
    );
    expect(ret).toBe(5);
    expect(als.getStore()).toBeUndefined();
  });

  it('nested run restores the outer store', () => {
    const als = new async_hooks.AsyncLocalStorage<number>();
    als.run(1, () => {
      const inner = als.run(2, () => als.getStore());
      expect(inner).toBe(2);
      expect(als.getStore()).toBe(1);
    });
  });

  it('enterWith persists; exit clears within the callback then restores; disable clears', () => {
    const als = new async_hooks.AsyncLocalStorage<number>();
    als.enterWith(9);
    expect(als.getStore()).toBe(9);
    const seen = als.exit(() => als.getStore());
    expect(seen).toBeUndefined();
    expect(als.getStore()).toBe(9);
    als.disable();
    expect(als.getStore()).toBeUndefined();
  });
});
