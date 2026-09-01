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
    const cyclic = new Error('cyclic');
    cyclic.cause = cyclic;
    expect(declaredGapCause(cyclic)).toBeNull();
  });
});
