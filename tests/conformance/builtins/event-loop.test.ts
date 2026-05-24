/**
 * Event-loop ordering tests. nextTick must beat Promise.then; setImmediate fires
 * after both. The Promise.prototype.then patch in `process.ts` enables this in
 * pure-JS environments.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  installProcessGlobals,
  riftyProcess,
} from '../../../packages/runtime-js/src/builtins/process.ts';
import {
  installTimerGlobals,
  setImmediate,
} from '../../../packages/runtime-js/src/builtins/timers.ts';

const origThen = Promise.prototype.then;

beforeAll(() => {
  installProcessGlobals();
  installTimerGlobals();
});

afterAll(() => {
  // Restore Promise.prototype.then for other test files.
  Promise.prototype.then = origThen;
});

describe('event loop', () => {
  it('process.nextTick runs before Promise.then', async () => {
    const order: string[] = [];
    Promise.resolve().then(() => order.push('promise'));
    riftyProcess.nextTick(() => order.push('nextTick'));
    await Promise.resolve();
    await Promise.resolve(); // drain
    expect(order).toEqual(['nextTick', 'promise']);
  });

  it('nextTick queued from inside nextTick still drains', async () => {
    const order: number[] = [];
    riftyProcess.nextTick(() => {
      order.push(1);
      riftyProcess.nextTick(() => order.push(2));
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);
  });

  it('setImmediate fires after the current task', async () => {
    const order: string[] = [];
    setImmediate(() => order.push('immediate'));
    order.push('sync');
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['sync', 'immediate']);
  });
});
