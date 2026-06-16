import { NotImplementedError as IoNotImplementedError } from '@riftydev/io';
import { NotImplementedError as VfsNotImplementedError } from '@riftydev/vfs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureNotImplemented,
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

// T15 boundary capture: the worker error boundary calls captureNotImplemented on
// every surfaced error. It must record by NAME (io + vfs each define their own
// NotImplementedError class, so instanceof against one misses the other) and be a
// no-op for anything else.
describe('captureNotImplemented (boundary)', () => {
  beforeEach(resetTelemetry);

  it('records the feature of an io NotImplementedError', () => {
    captureNotImplemented(new IoNotImplementedError('vm.runInNewContext.timeout'));
    expect(snapshotTelemetry()).toEqual([
      { feature: 'vm.runInNewContext.timeout', kind: 'not-implemented', count: 1 },
    ]);
  });

  it('records a vfs NotImplementedError too (matched by name, not instanceof)', () => {
    // The two classes are distinct; matching by name is what catches both.
    const err = new VfsNotImplementedError('fs.watch');
    expect(err instanceof IoNotImplementedError).toBe(false);
    captureNotImplemented(err);
    expect(snapshotTelemetry()).toEqual([
      { feature: 'fs.watch', kind: 'not-implemented', count: 1 },
    ]);
  });

  it('matches a name-shaped error even without the io/vfs class (cross-realm)', () => {
    // A deserialized worker error has the right name but no real class — still caught.
    const err = Object.assign(new Error('Not implemented: x.y'), {
      name: 'NotImplementedError',
      feature: 'x.y',
    });
    captureNotImplemented(err);
    expect(snapshotTelemetry()).toEqual([{ feature: 'x.y', kind: 'not-implemented', count: 1 }]);
  });

  it('falls back to the message when feature is absent', () => {
    const err = Object.assign(new Error('Not implemented: z'), { name: 'NotImplementedError' });
    captureNotImplemented(err);
    expect(snapshotTelemetry()).toEqual([
      { feature: 'Not implemented: z', kind: 'not-implemented', count: 1 },
    ]);
  });

  it('is a no-op for ordinary errors and non-errors', () => {
    captureNotImplemented(new TypeError('nope'));
    captureNotImplemented('a string');
    captureNotImplemented(undefined);
    expect(snapshotTelemetry()).toEqual([]);
  });
});
