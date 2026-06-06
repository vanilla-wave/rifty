import { describe, expect, it } from 'vitest';
import { Semaphore } from './semaphore.ts';

/** A manually-resolvable promise, to hold tasks in-flight deterministically. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Semaphore (#24, perf-audit 2026-06-05)', () => {
  it('never exceeds max permits concurrently', async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];

    const tasks = gates.map((g) =>
      sem.run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await g.promise;
        inFlight--;
      }),
    );

    // Let the first batch acquire. Only 2 may be in flight.
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(2);

    // Release one at a time; peak must stay capped at 2.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it('hands a released permit to waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const gate = deferred<void>();

    // First task holds the only permit until `gate` resolves.
    const first = sem.run(async () => {
      order.push(0);
      await gate.promise;
    });
    // These three queue behind it in submission order.
    const rest = [1, 2, 3].map((n) =>
      sem.run(async () => {
        order.push(n);
      }),
    );

    await Promise.resolve();
    expect(order).toEqual([0]); // only the first acquired

    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([0, 1, 2, 3]); // FIFO drain
  });

  it('releases the permit on rejection (finally), so later tasks still run', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // If release() were skipped on rejection, this would deadlock.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects an invalid max (< 1)', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});
