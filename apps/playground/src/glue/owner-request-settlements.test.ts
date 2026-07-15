import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOwnerRequestSettlements } from './owner-request-settlements.ts';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('owner request settlements', () => {
  it('bounds reads and closes after disposal', async () => {
    vi.useFakeTimers();
    const onDrained = vi.fn();
    const settlements = createOwnerRequestSettlements<string>({
      readTimeout: { ms: 10, error: (id) => new Error(`read timeout ${id}`) },
      onDrained,
    });
    const read = settlements.request('read-1', 'read', () => {});
    const rejected = expect(read).rejects.toThrow('read timeout read-1');

    await vi.advanceTimersByTimeAsync(11);
    await rejected;

    settlements.dispose(new Error('disposed'));
    expect(onDrained).toHaveBeenCalledOnce();
  });

  it('drains an admitted mutation after disposal without arming a read deadline', async () => {
    vi.useFakeTimers();
    const onDrained = vi.fn();
    const settlements = createOwnerRequestSettlements<string>({
      readTimeout: { ms: 10, error: () => new Error('read timeout') },
      onDrained,
    });
    const mutation = settlements.request('mutation-1', 'mutation', () => {});
    let outcome = 'pending';
    void mutation.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    settlements.dispose(new Error('disposed'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcome).toBe('pending');
    expect(onDrained).not.toHaveBeenCalled();

    settlements.resolve('mutation-1', 'ack');
    await expect(mutation).resolves.toBe('ack');
    expect(onDrained).toHaveBeenCalledOnce();
    await expect(settlements.request('mutation-2', 'mutation', () => {})).rejects.toThrow(
      'disposed',
    );
  });

  it('uses certified owner exit as the terminal outcome for mutations', async () => {
    const ownerClosed = deferred();
    const onDrained = vi.fn();
    const settlements = createOwnerRequestSettlements<string>({
      ownerClosed: ownerClosed.promise,
      ownerClosedError: () => new Error('owner exited'),
      onDrained,
    });
    const mutation = settlements.request('mutation-1', 'mutation', () => {});

    ownerClosed.resolve();

    await expect(mutation).rejects.toThrow('owner exited');
    expect(onDrained).toHaveBeenCalledOnce();
  });

  it('shares one owner-exit continuation and detaches drained subscribers', async () => {
    const ownerClosed = deferred();
    const then = vi.spyOn(ownerClosed.promise, 'then');
    const firstExitError = vi.fn(() => new Error('first owner exit'));
    const secondExitError = vi.fn(() => new Error('second owner exit'));
    const first = createOwnerRequestSettlements<string>({
      ownerClosed: ownerClosed.promise,
      ownerClosedError: firstExitError,
      onDrained: () => {},
    });
    const second = createOwnerRequestSettlements<string>({
      ownerClosed: ownerClosed.promise,
      ownerClosedError: secondExitError,
      onDrained: () => {},
    });

    first.dispose(new Error('first disposed'));
    second.dispose(new Error('second disposed'));
    expect(then).toHaveBeenCalledOnce();

    ownerClosed.resolve();
    await Promise.resolve();
    expect(firstExitError).not.toHaveBeenCalled();
    expect(secondExitError).not.toHaveBeenCalled();
  });

  it('preserves the exact synchronous send failure', async () => {
    const onDrained = vi.fn();
    const failure = new Error('send failed exactly');
    const settlements = createOwnerRequestSettlements<string>({ onDrained });
    const mutation = settlements.request('mutation-1', 'mutation', () => {
      throw failure;
    });
    settlements.dispose(new Error('disposed'));

    await expect(mutation).rejects.toBe(failure);
    expect(onDrained).toHaveBeenCalledOnce();
  });

  it('accepts a synchronous owner reply during send', async () => {
    const onDrained = vi.fn();
    const settlements = createOwnerRequestSettlements<string>({ onDrained });
    const mutation = settlements.request('mutation-1', 'mutation', () => {
      settlements.resolve('mutation-1', 'ack');
    });
    settlements.dispose(new Error('disposed'));

    await expect(mutation).resolves.toBe('ack');
    expect(onDrained).toHaveBeenCalledOnce();
  });
});
