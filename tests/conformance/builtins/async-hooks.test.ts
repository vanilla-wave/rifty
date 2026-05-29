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
