import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { declaredGapCause } from './declared-gap-cause.ts';

function wrapped(error: Error, count: number): Error {
  let current = error;
  for (let index = 0; index < count; index += 1) current = new Error('wrapper', { cause: current });
  return current;
}

describe('declaredGapCause', () => {
  it('returns a direct or eight-link named gap', () => {
    const gap = new NotImplementedError('toolchain.threaded-wasm');
    expect(declaredGapCause(gap)).toBe(gap);
    expect(declaredGapCause(wrapped(gap, 8))).toBe(gap);
  });

  it('leaves deeper, ordinary and cyclic errors at their loud outer boundary', () => {
    const gap = new NotImplementedError('toolchain.threaded-wasm');
    expect(declaredGapCause(wrapped(gap, 9))).toBeNull();
    expect(declaredGapCause(new Error('ordinary'))).toBeNull();
    expect(
      declaredGapCause(
        Object.assign(new Error('forged'), {
          name: 'NotImplementedError',
          feature: 'package.feature',
        }),
      ),
    ).toBeNull();
    expect(declaredGapCause(new Error('non-error tail', { cause: 'not an error' }))).toBeNull();
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
    let projected: NotImplementedError | null | undefined;
    let thrown: unknown;
    try {
      projected = declaredGapCause(wrapped(boundary, 8));
    } catch (error) {
      thrown = error;
    }
    expect({
      reads,
      projected,
      thrown:
        thrown instanceof Error ? { name: thrown.name, message: thrown.message } : (thrown ?? null),
    }).toEqual({ reads: 0, projected: null, thrown: null });
  });

  it('keeps the outer boundary when an inspected cause getter throws', () => {
    const outer = new Error('ordinary package loader failure');
    let reads = 0;
    Object.defineProperty(outer, 'cause', {
      get() {
        reads += 1;
        throw new Error(`hostile cause read ${reads}`);
      },
    });
    let projected: NotImplementedError | null | undefined;
    let thrown: unknown;
    try {
      projected = declaredGapCause(outer);
    } catch (error) {
      thrown = error;
    }
    expect({
      reads,
      projected,
      thrown:
        thrown instanceof Error ? { name: thrown.name, message: thrown.message } : (thrown ?? null),
    }).toEqual({ reads: 1, projected: null, thrown: null });
  });
});
