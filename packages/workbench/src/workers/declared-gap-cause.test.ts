import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { declaredGapCause } from './declared-gap-cause.ts';

function wrapped(error: Error, count: number): Error {
  let current = error;
  for (let index = 0; index < count; index += 1) {
    current = new Error(`wrapper-${index}`, { cause: current });
  }
  return current;
}

type ThrownObservation =
  | { readonly kind: 'error'; readonly name: string; readonly message: string }
  | { readonly kind: 'value'; readonly value: string }
  | null;

function observeProjection(error: unknown): {
  readonly projected: NotImplementedError | null | undefined;
  readonly thrown: ThrownObservation;
} {
  let projected: NotImplementedError | null | undefined;
  let thrown: ThrownObservation = null;
  try {
    projected = declaredGapCause(error);
  } catch (error) {
    thrown =
      error instanceof Error
        ? { kind: 'error', name: error.name, message: error.message }
        : { kind: 'value', value: String(error) };
  }
  return { projected, thrown };
}

describe('declaredGapCause', () => {
  it('returns the first real package gap at every in-bound depth', () => {
    for (let depth = 0; depth <= 8; depth += 1) {
      const gap = new NotImplementedError('package.feature');
      expect(gap).toMatchObject({
        name: 'NotImplementedError',
        message: 'Not implemented: package.feature',
        feature: 'package.feature',
      });
      expect(declaredGapCause(wrapped(gap, depth)), `depth ${depth}`).toBe(gap);
    }

    const innerGap = new NotImplementedError('package.inner');
    const outerGap = new NotImplementedError('package.outer');
    outerGap.cause = innerGap;
    expect(declaredGapCause(wrapped(outerGap, 3))).toBe(outerGap);
  });

  it('leaves deeper, ordinary, cyclic, impostor and non-Error tails unprojected', () => {
    const gap = new NotImplementedError('package.feature');
    expect(declaredGapCause(wrapped(gap, 9))).toBeNull();
    expect(declaredGapCause(new Error('ordinary'))).toBeNull();

    const impostor = Object.assign(new Error('Not implemented: package.feature'), {
      name: 'NotImplementedError',
      feature: 'package.feature',
    });
    expect(declaredGapCause(impostor)).toBeNull();
    expect(declaredGapCause(wrapped(impostor, 2))).toBeNull();

    expect(declaredGapCause(new Error('primitive tail', { cause: 'not an error' }))).toBeNull();
    expect(declaredGapCause(new Error('object tail', { cause: { cause: gap } }))).toBeNull();

    const cyclic = new Error('cyclic');
    cyclic.cause = cyclic;
    expect(declaredGapCause(cyclic)).toBeNull();
    const cycleA = new Error('cycle-a');
    const cycleB = new Error('cycle-b', { cause: cycleA });
    cycleA.cause = cycleB;
    expect(declaredGapCause(cycleA)).toBeNull();
  });

  it('does not read a ninth cause getter after inspecting depth eight', () => {
    let reads = 0;
    const boundary = new Error('depth-eight ordinary');
    Object.defineProperty(boundary, 'cause', {
      get() {
        reads += 1;
        throw new Error(`forbidden ninth cause read ${reads}`);
      },
    });
    const observed = observeProjection(wrapped(boundary, 8));
    expect({ reads, projected: observed.projected, thrown: observed.thrown }).toEqual({
      reads: 0,
      projected: null,
      thrown: null,
    });
  });

  it('does not let inspected throwing getters replace the outer boundary', () => {
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly depth: number;
      readonly thrownValue: unknown;
    }> = [
      { label: 'intermediate Error', depth: 3, thrownValue: new Error('hostile cause error') },
      { label: 'primitive', depth: 4, thrownValue: 17 },
      {
        label: 'real NotImplementedError',
        depth: 5,
        thrownValue: new NotImplementedError('getter.feature'),
      },
    ];
    const observations = cases.map(({ label, depth, thrownValue }) => {
      let reads = 0;
      const boundary = new Error(`${label} boundary`);
      Object.defineProperty(boundary, 'cause', {
        get() {
          reads += 1;
          throw thrownValue;
        },
      });
      const observed = observeProjection(wrapped(boundary, depth));
      return { label, reads, projected: observed.projected, thrown: observed.thrown };
    });
    expect(observations).toEqual(
      cases.map(({ label }) => ({ label, reads: 1, projected: null, thrown: null })),
    );
  });
});
