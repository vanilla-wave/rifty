import { describe, expect, it, vi } from 'vitest';
import { type OwnerWritePort, commitOwnerWrites } from './owner-write-barrier.ts';

interface Frame {
  readonly id: number;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('owner write barrier', () => {
  it('captures one owner, sends the first frame synchronously, then applies in ack order and flushes once', async () => {
    const firstAck = deferred();
    const secondAck = deferred();
    const flush = deferred();
    const events: string[] = [];
    let lookups = 0;
    let active: OwnerWritePort<Frame>;
    const replacement: OwnerWritePort<Frame> = {
      writeFrameAcked: async (frame) => {
        events.push(`replacement:${frame.id}`);
      },
      flushDurable: async () => {
        events.push('replacement:flush');
      },
    };
    const first: OwnerWritePort<Frame> = {
      writeFrameAcked(frame) {
        events.push(`first:${frame.id}`);
        active = replacement;
        return frame.id === 1 ? firstAck.promise : secondAck.promise;
      },
      flushDurable() {
        events.push('first:flush');
        return flush.promise;
      },
    };
    active = first;

    const commit = commitOwnerWrites(() => {
      lookups += 1;
      return active;
    }, [{ id: 1 }, { id: 2 }]);
    expect(events).toEqual(['first:1']);
    expect(lookups).toBe(1);

    firstAck.resolve();
    await vi.waitFor(() => expect(events).toEqual(['first:1', 'first:2']));
    secondAck.resolve();
    await commit.applied;
    await vi.waitFor(() => expect(events).toEqual(['first:1', 'first:2', 'first:flush']));

    let durable = false;
    void commit.durable.then(() => {
      durable = true;
    });
    await Promise.resolve();
    expect(durable).toBe(false);
    flush.resolve();
    await commit.durable;
    expect(durable).toBe(true);
    expect(lookups).toBe(1);
  });

  it('does not select or flush an owner for an empty batch', async () => {
    const currentOwner = vi.fn<() => OwnerWritePort<Frame>>();
    const commit = commitOwnerWrites(currentOwner, []);

    await commit.applied;
    await commit.durable;
    expect(currentOwner).not.toHaveBeenCalled();
  });

  it('surfaces an apply failure and never flushes a partially applied batch', async () => {
    const flushDurable = vi.fn(async () => {});
    const owner: OwnerWritePort<Frame> = {
      writeFrameAcked: async (frame) => {
        if (frame.id === 2) throw new Error('owner apply failed');
      },
      flushDurable,
    };
    const commit = commitOwnerWrites(() => owner, [{ id: 1 }, { id: 2 }]);

    await expect(commit.applied).rejects.toThrow('owner apply failed');
    await expect(commit.durable).rejects.toThrow('owner apply failed');
    expect(flushDurable).not.toHaveBeenCalled();
  });
});
