import { describe, expect, it } from 'vitest';
import { createOwnerMutationCoordinator } from './owner-mutation-coordinator.ts';

interface Frame {
  readonly id: string;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('owner mutation coordinator teardown faults', () => {
  it('rejects after successful protocol completion when snapshot unsubscribe throws', async () => {
    let publish = (): void => {};
    const coordinator = createOwnerMutationCoordinator({
      currentOwner: () => ({
        writeFrameAcked: async () => {},
        flushDurable: async () => {},
      }),
      subscribeSnapshot: (listener) => {
        publish = listener;
        return () => {
          throw new Error('snapshot unsubscribe failed');
        };
      },
      timeoutMs: 50,
      label: 'test mutation',
    });
    const mutation = coordinator.mutate({ id: 'one' }, () => true);
    void mutation.catch(() => {});
    await Promise.resolve();

    expect(() => publish()).not.toThrow();
    await expect(mutation).rejects.toThrow('snapshot unsubscribe failed');
  });

  it('settles cancellation even when unsubscribe throws during dispose', async () => {
    const ack = deferred();
    const coordinator = createOwnerMutationCoordinator<
      Frame,
      {
        writeFrameAcked(frame: Frame): Promise<void>;
        flushDurable(): Promise<void>;
      }
    >({
      currentOwner: () => ({
        writeFrameAcked: () => ack.promise,
        flushDurable: async () => {},
      }),
      subscribeSnapshot: () => () => {
        throw new Error('snapshot unsubscribe failed');
      },
      timeoutMs: 50,
      label: 'test mutation',
    });
    const mutation = coordinator.mutate({ id: 'two' }, () => false);
    void mutation.catch(() => {});

    expect(() => coordinator.dispose(new Error('test coordinator disposed'))).not.toThrow();
    await expect(mutation).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'test coordinator disposed',
      errors: [
        expect.objectContaining({ message: 'test coordinator disposed' }),
        expect.objectContaining({ message: 'snapshot unsubscribe failed' }),
      ],
    });

    ack.resolve();
  });
});
