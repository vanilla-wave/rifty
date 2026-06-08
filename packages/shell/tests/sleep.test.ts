import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sleep } from '../src/commands/sleep.ts';
import { makeCtx } from './_ctx.ts';

// Fake timers keep this fast: advance the clock instead of waiting real wall time.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('resolves 0 after the requested delay elapses', async () => {
  const { ctx, out, err } = makeCtx();
  const p = sleep(['0.01'], ctx);
  // Before the clock advances the promise must still be pending: the delay races
  // nothing yet, so completion must come strictly from setTimeout firing.
  vi.advanceTimersByTime(10);
  expect(await p).toBe(0);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('an already-aborted signal resolves 130 without advancing the clock', async () => {
  const { ctx } = makeCtx({ signal: AbortSignal.abort() });
  // No vi.advanceTimersByTime: the abort path must short-circuit the setTimeout.
  expect(await sleep(['100'], ctx)).toBe(130);
});

it('aborting mid-delay resolves 130', async () => {
  const ac = new AbortController();
  const { ctx } = makeCtx({ signal: ac.signal });
  const p = sleep(['100'], ctx);
  ac.abort();
  expect(await p).toBe(130);
});

it('sums multiple operands (GNU): suffixes m/h/d scale to seconds', async () => {
  const { ctx } = makeCtx();
  // 1m + 30s + 2s = 92s = 92000ms. Resolves only after the full sum elapses.
  const p = sleep(['1m', '30s', '2s'], ctx);
  vi.advanceTimersByTime(91999);
  let settled = false;
  void p.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  vi.advanceTimersByTime(1);
  expect(await p).toBe(0);
});

it('bad operand: stderr usage error, exit 1, no waiting', async () => {
  const { ctx, out, err } = makeCtx();
  const code = await sleep(['x'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe("sleep: invalid time interval 'x'\n");
});

it('unknown suffix is a usage error (exit 1), not a NotImplementedError', async () => {
  const { ctx, err } = makeCtx();
  expect(await sleep(['5y'], ctx)).toBe(1);
  expect(err()).toBe("sleep: invalid time interval '5y'\n");
});

it('missing operand: usage error, exit 1', async () => {
  const { ctx, err } = makeCtx();
  expect(await sleep([], ctx)).toBe(1);
  expect(err()).toBe('sleep: missing operand\n');
});
