import { describe, expect, it } from 'vitest';
import { clampSize, nextSizeFromDelta } from './splitter-size.ts';

describe('clampSize', () => {
  it('returns the value untouched when inside the range', () => {
    expect(clampSize(300, 180, 560)).toBe(300);
  });

  it('clamps below min and above max', () => {
    expect(clampSize(50, 180, 560)).toBe(180);
    expect(clampSize(9999, 180, 560)).toBe(560);
  });

  it('rounds to an integer pixel', () => {
    expect(clampSize(300.7, 180, 560)).toBe(301);
  });

  it('tolerates a reversed min/max pair', () => {
    expect(clampSize(300, 560, 180)).toBe(300);
    expect(clampSize(50, 560, 180)).toBe(180);
  });

  it('falls back to the low bound on NaN (stale/garbage persisted value)', () => {
    expect(clampSize(Number.NaN, 180, 560)).toBe(180);
  });
});

describe('nextSizeFromDelta', () => {
  it('adds a positive delta and clamps', () => {
    expect(nextSizeFromDelta(300, 40, 180, 560)).toBe(340);
    expect(nextSizeFromDelta(540, 100, 180, 560)).toBe(560);
  });

  it('adds a negative delta and clamps', () => {
    expect(nextSizeFromDelta(300, -40, 180, 560)).toBe(260);
    expect(nextSizeFromDelta(200, -100, 180, 560)).toBe(180);
  });
});
