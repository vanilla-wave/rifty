import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifySubscribers, runCleanupSteps } from './fault-boundary.ts';

afterEach(() => vi.unstubAllGlobals());

describe('workbench host fault boundaries', () => {
  it('reports a throwing subscriber and still invokes every sibling synchronously', () => {
    const failure = new Error('subscriber failed');
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const calls: string[] = [];

    notifySubscribers(
      [
        () => {
          calls.push('first');
          throw failure;
        },
        () => calls.push('second'),
      ],
      { status: 'ready' },
    );

    expect(calls).toEqual(['first', 'second']);
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  it('attempts every cleanup step before throwing one aggregate', () => {
    const calls: string[] = [];

    expect(() =>
      runCleanupSteps(
        [
          () => {
            calls.push('first');
            throw new Error('first failed');
          },
          () => {
            calls.push('second');
            throw new Error('second failed');
          },
          () => calls.push('third'),
        ],
        'test cleanup failed',
      ),
    ).toThrow(AggregateError);
    expect(calls).toEqual(['first', 'second', 'third']);
  });
});
