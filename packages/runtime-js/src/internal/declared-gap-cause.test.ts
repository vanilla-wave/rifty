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

describe('declaredGapCause', () => {
  it('returns only real NotImplementedErrors through eight cause links', () => {
    for (let depth = 0; depth <= 8; depth += 1) {
      const gap = new NotImplementedError('package.feature');
      expect(declaredGapCause(wrapped(gap, depth)), `depth ${depth}`).toBe(gap);
    }

    const gap = new NotImplementedError('package.feature');
    expect(declaredGapCause(wrapped(gap, 9))).toBeNull();
    expect(
      declaredGapCause(
        Object.assign(new Error('Not implemented: package.feature'), {
          name: 'NotImplementedError',
          feature: 'package.feature',
        }),
      ),
    ).toBeNull();
  });

  it('does not read a ninth link and absorbs hostile cause getters', () => {
    let ninthReads = 0;
    const depthEight = new Error('depth-eight ordinary');
    Object.defineProperty(depthEight, 'cause', {
      get() {
        ninthReads += 1;
        throw new Error('forbidden ninth cause read');
      },
    });
    expect(declaredGapCause(wrapped(depthEight, 8))).toBeNull();
    expect(ninthReads).toBe(0);

    for (const thrown of [new Error('hostile'), 17, new NotImplementedError('getter.feature')]) {
      let reads = 0;
      const boundary = new Error('getter boundary');
      Object.defineProperty(boundary, 'cause', {
        get() {
          reads += 1;
          throw thrown;
        },
      });
      expect(declaredGapCause(wrapped(boundary, 3))).toBeNull();
      expect(reads).toBe(1);
    }
  });
});
