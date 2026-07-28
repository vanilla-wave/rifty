import { describe, expect, it } from 'vitest';
import type { PlaygroundAppProjectContext } from './playground-app-runtime.ts';
import { rebindAfterPlaygroundTransitionFailure } from './playground-app-transition-recovery.ts';

const RESTORED = Object.freeze({}) as PlaygroundAppProjectContext;

describe('Playground App transition recovery', () => {
  it('preserves the target-open failure after rebinding the restored context', async () => {
    const events: string[] = [];
    const targetFailure = new Error('target open failed');

    const failure = await rebindAfterPlaygroundTransitionFailure(
      targetFailure,
      RESTORED,
      async (context) => {
        expect(context).toBe(RESTORED);
        events.push('bind:restored');
      },
    ).catch((error: unknown) => error);

    expect(failure).toBe(targetFailure);
    expect(events).toEqual(['bind:restored']);
  });

  it('preserves target-open then restored-binding failures in causal order', async () => {
    const events: string[] = [];
    const targetFailure = new Error('target open failed');
    const bindingFailure = new Error('restored binding failed');

    const failure = await rebindAfterPlaygroundTransitionFailure(
      targetFailure,
      RESTORED,
      async (context) => {
        expect(context).toBe(RESTORED);
        events.push('bind:restored');
        throw bindingFailure;
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([targetFailure, bindingFailure]);
    expect(events).toEqual(['bind:restored']);
  });
});
