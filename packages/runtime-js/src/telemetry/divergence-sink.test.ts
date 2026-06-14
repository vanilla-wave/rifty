import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordDivergence,
  recordNotImplemented,
  resetTelemetry,
  snapshotTelemetry,
} from './divergence-sink.ts';

describe('divergence sink', () => {
  beforeEach(resetTelemetry);

  it('counts hits sorted desc', () => {
    recordNotImplemented('vm.timeout');
    recordNotImplemented('vm.timeout');
    recordDivergence('vm.engine.rewrite-active');
    expect(snapshotTelemetry()).toEqual([
      { feature: 'vm.timeout', kind: 'not-implemented', count: 2 },
      { feature: 'vm.engine.rewrite-active', kind: 'divergence', count: 1 },
    ]);
  });

  it('warnOnce returns true only first time', () => {
    expect(recordDivergence('x', { warnOnce: true })).toBe(true);
    expect(recordDivergence('x', { warnOnce: true })).toBe(false);
  });

  it('resetTelemetry clears counts and warned-set', () => {
    recordNotImplemented('a');
    recordDivergence('a', { warnOnce: true });
    resetTelemetry();
    expect(snapshotTelemetry()).toEqual([]);
    // warned-set cleared too: warnOnce fires fresh after reset
    expect(recordDivergence('a', { warnOnce: true })).toBe(true);
  });

  it('warnOnce is independent per feature', () => {
    expect(recordDivergence('a', { warnOnce: true })).toBe(true);
    expect(recordDivergence('b', { warnOnce: true })).toBe(true);
    expect(recordDivergence('a', { warnOnce: true })).toBe(false);
    expect(recordDivergence('b', { warnOnce: true })).toBe(false);
  });

  it('mixed kinds keep their own counts and ties break by insertion order', () => {
    recordNotImplemented('first'); // count 1
    recordDivergence('second'); // count 1
    recordNotImplemented('first'); // count 2 — moves to front
    expect(snapshotTelemetry()).toEqual([
      { feature: 'first', kind: 'not-implemented', count: 2 },
      { feature: 'second', kind: 'divergence', count: 1 },
    ]);
  });

  it('warnOnce still increments the hit count', () => {
    recordDivergence('z', { warnOnce: true });
    recordDivergence('z', { warnOnce: true });
    expect(snapshotTelemetry()).toEqual([{ feature: 'z', kind: 'divergence', count: 2 }]);
  });
});
