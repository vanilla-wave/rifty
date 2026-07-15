import { describe, expect, it, vi } from 'vitest';

import { createProjectOwnerCoordinator } from './project-owner-coordinator.ts';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('project owner coordinator (concurrent-same-key fault)', () => {
  it('never overlaps or supersedes a current head when a later operation queues', async () => {
    const coordinator = createProjectOwnerCoordinator();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;

    const runOperation = async (name: string, hold?: Promise<void>): Promise<string> => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(`${name}:start`);
      if (hold) await hold;
      order.push(`${name}:end`);
      running--;
      return name;
    };

    const first = coordinator.run(
      () => true,
      async () => {
        firstStarted.resolve();
        return runOperation('first', releaseFirst.promise);
      },
    );
    await firstStarted.promise;
    const second = coordinator.run(
      () => true,
      async () => runOperation('second'),
    );

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'completed', value: 'first' },
      { kind: 'completed', value: 'second' },
    ]);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('skips a canceled intent at the queue head before binding the owner operation', async () => {
    const coordinator = createProjectOwnerCoordinator();
    const headStarted = deferred();
    const releaseHead = deferred();
    let intentCurrent = true;
    const bindCanceledIntent = vi.fn(() => 'stale');

    const head = coordinator.run(
      () => true,
      async () => {
        headStarted.resolve();
        await releaseHead.promise;
      },
    );
    await headStarted.promise;
    const canceled = coordinator.run(() => intentCurrent, bindCanceledIntent);
    const replacement = coordinator.run(
      () => true,
      async () => 'replacement',
    );
    intentCurrent = false;
    releaseHead.resolve();

    await head;
    await expect(canceled).resolves.toEqual({ kind: 'superseded' });
    await expect(replacement).resolves.toEqual({ kind: 'completed', value: 'replacement' });
    expect(bindCanceledIntent).not.toHaveBeenCalled();
  });

  it('continues with the next ticket after an ordinary operation failure', async () => {
    const coordinator = createProjectOwnerCoordinator();
    const failed = coordinator.run(
      () => true,
      async () => {
        throw new Error('retryable owner failure');
      },
    );
    const retried = coordinator.run(
      () => true,
      async () => 'recovered',
    );

    await expect(failed).rejects.toThrow('retryable owner failure');
    await expect(retried).resolves.toEqual({ kind: 'completed', value: 'recovered' });
  });

  it('torn-state fault: rejects queued and future tickets after an unsafe outcome', async () => {
    const coordinator = createProjectOwnerCoordinator();
    const headStarted = deferred();
    const triggerFence = deferred();
    const queuedOperation = vi.fn(() => 'must not bind');

    const unsafe = coordinator.run(
      () => true,
      async (lease) => {
        headStarted.resolve();
        await triggerFence.promise;
        lease.fence(new Error('owner outcome is unsafe'));
      },
    );
    await headStarted.promise;
    const queued = coordinator.run(() => true, queuedOperation);
    const unsafeRejection = expect(unsafe).rejects.toThrow('owner outcome is unsafe');
    const queuedRejection = expect(queued).rejects.toThrow('owner outcome is unsafe');

    triggerFence.resolve();
    await unsafeRejection;
    await queuedRejection;
    await expect(coordinator.run(() => true, queuedOperation)).rejects.toThrow(
      'owner outcome is unsafe',
    );
    expect(queuedOperation).not.toHaveBeenCalled();
  });
});
