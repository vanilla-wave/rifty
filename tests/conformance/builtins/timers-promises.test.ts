import { describe, expect, it } from 'vitest';
import { timersPromises } from '../../../packages/runtime-js/src/builtins/timers.ts';

const { setTimeout, setImmediate, setInterval, scheduler } = timersPromises;

// `node:timers/promises` — promise-returning timers. opencode imports
// `setTimeout as sleep`; AbortSignal cancellation is part of the contract.
describe('timers/promises', () => {
  it('setTimeout resolves with the value after the delay', async () => {
    expect(await setTimeout(1, 'done')).toBe('done');
  });

  it('setTimeout rejects when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(setTimeout(1000, 'x', { signal: ac.signal })).rejects.toBeTruthy();
  });

  it('setTimeout rejects (and clears its timer) when aborted mid-wait', async () => {
    const ac = new AbortController();
    const p = setTimeout(1000, 'x', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeTruthy();
  });

  it('setImmediate resolves with the value', async () => {
    expect(await setImmediate('imm')).toBe('imm');
  });

  it('setInterval yields the value repeatedly until break', async () => {
    const out: string[] = [];
    for await (const v of setInterval(1, 'tick')) {
      out.push(v);
      if (out.length === 3) break;
    }
    expect(out).toEqual(['tick', 'tick', 'tick']);
  });

  it('scheduler.wait resolves after the delay', async () => {
    await expect(scheduler.wait(1)).resolves.toBeUndefined();
  });
});
