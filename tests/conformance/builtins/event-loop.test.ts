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
  clearImmediate,
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

  // #28 (perf-audit 2026-06-05, ADR-0085): the Map + head-cursor + tail-snapshot
  // drain must preserve the emergent check-phase semantics — a nested setImmediate
  // defers to the NEXT check phase, and clearImmediate removes a still-queued item.
  it('nested setImmediate defers to the next check phase (tail-snapshot)', async () => {
    const order: string[] = [];
    setImmediate(() => {
      order.push('A');
      setImmediate(() => order.push('B-nested'));
      order.push('A-end');
    });
    setImmediate(() => order.push('C'));
    await new Promise((r) => setTimeout(r, 20));
    // Both first-round immediates (A, C) run before the nested one (next check
    // phase). NB: the ascending-id Map rep already orders B-nested last, so this
    // pins the Node-parity contract; the tail-snapshot's role is cross-phase
    // separation, not this single-phase string.
    expect(order).toEqual(['A', 'A-end', 'C', 'B-nested']);
  });

  it('clearImmediate mid-drain removes the still-queued item (Map.delete)', async () => {
    const order: string[] = [];
    // A is queued first; its callback clears B (queued AFTER A, same round) before
    // the FIFO drain reaches B. A holder defers the handle read past assignment.
    const ref: { b?: ReturnType<typeof setImmediate> } = {};
    setImmediate(() => {
      order.push('A');
      clearImmediate(ref.b);
    });
    ref.b = setImmediate(() => order.push('B'));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['A']); // B cleared before it fired
  });

  it('drains a large setImmediate burst FIFO with a mid-burst clear', async () => {
    const order: number[] = [];
    const handles: ReturnType<typeof setImmediate>[] = [];
    const N = 100;
    for (let i = 0; i < N; i++) handles.push(setImmediate(() => order.push(i)));
    clearImmediate(handles[50]); // remove index 50 before the drain
    await new Promise((r) => setTimeout(r, 20));
    const expected = Array.from({ length: N }, (_, i) => i).filter((i) => i !== 50);
    expect(order).toEqual(expected);
  });

  // #27 (perf-audit 2026-06-05): drainNextTicks uses a head cursor (O(n)) instead
  // of shift()-per-item (O(n^2)). These pin the behavior the rewrite must preserve.
  it('drains a large nextTick burst fully and in FIFO order (head-cursor invariance)', async () => {
    const order: number[] = [];
    const N = 500;
    for (let i = 0; i < N; i++) {
      riftyProcess.nextTick((n) => order.push(n as number), i);
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toHaveLength(N);
    expect(order).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it('processes nextTicks enqueued mid-drain within the same drain (no snapshot)', async () => {
    const order: number[] = [];
    // Two seed ticks each re-enqueue a follow-up while the head cursor is mid-array;
    // a snapshot/for-of rewrite or a missing length re-read would drop these.
    riftyProcess.nextTick(() => {
      order.push(1);
      riftyProcess.nextTick(() => order.push(3));
    });
    riftyProcess.nextTick(() => {
      order.push(2);
      riftyProcess.nextTick(() => order.push(4));
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('then-wrapper drains every pending nextTick before its callback (gate preserved)', async () => {
    // The patched Promise.prototype.then must still call drainNextTicks() before
    // EACH then-callback (no empty-queue elision). With multiple pending ticks, all
    // of them must precede the promise callback.
    const order: string[] = [];
    Promise.resolve().then(() => order.push('promise'));
    riftyProcess.nextTick(() => order.push('tickA'));
    riftyProcess.nextTick(() => order.push('tickB'));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['tickA', 'tickB', 'promise']);
  });

  it('re-arms scheduling after a full drain (next burst still fires)', async () => {
    const order: number[] = [];
    riftyProcess.nextTick(() => order.push(1));
    await new Promise((r) => setTimeout(r, 10));
    // Cursor + array were reset; a fresh nextTick must re-schedule its own drain.
    riftyProcess.nextTick(() => order.push(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);
  });
});
