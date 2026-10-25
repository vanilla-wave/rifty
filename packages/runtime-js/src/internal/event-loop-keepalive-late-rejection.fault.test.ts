import { afterEach, describe, expect, it } from 'vitest';
import { awaitDrain, recordRejection, resetKeepalive } from './event-loop-keepalive.ts';

// Fault (ADR-0445, observable-order): Chromium dispatches `unhandledrejection`
// in a task queued behind the drain's first zero-ref sample. Injected here: the
// rejection lands one task after that sample; the drain must report it, never
// settle as a clean exit first.
afterEach(() => {
  resetKeepalive();
});

const hostTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('event-loop drain vs a late unhandledrejection task', () => {
  it('rejects with a rejection delivered one task after the first zero-ref sample', async () => {
    const queue: Array<() => void> = [];
    let outcome = 'pending';
    const drain = awaitDrain({ scheduleMacrotask: (callback) => queue.push(callback) });
    drain.then(
      () => {
        outcome = 'resolved';
      },
      (error: unknown) => {
        outcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
      },
    );

    queue.shift()?.();
    await hostTask();
    recordRejection(new Error('late-rejection'));
    for (let step = 0; step < 20 && outcome === 'pending'; step++) {
      queue.shift()?.();
      await hostTask();
    }

    expect(outcome).toBe('rejected:late-rejection');
  });
});
