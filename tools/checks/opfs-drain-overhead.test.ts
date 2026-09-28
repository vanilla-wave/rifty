import { expect, it } from 'vitest';
import { pendingFlushOverheadMs } from '../../tests/browser-unit/fixtures/opfs-drain-overhead.ts';

// Actual Chromium148 Linux observations, CI36365591064 attempts1/2, unchanged550538dd7.
const observations = [
  {
    attempt: 1,
    faithfulMs: 75646,
    faithfulOpCount: 53622,
    faithfulMkdirCount: 26811,
    singlePendingFlushMeanMs: 1.586524999999965,
    batchedPerOpMeanMs: 1.3266000000000349,
    singlePendingMkdirFlushMeanMs: 0.3753250000000116,
    batchedMkdirPerOpMeanMs: 0.36440000000002326,
    // 26,811 writes:6968.8491749981295ms; 26,811 mkdirs:292.9101749996879ms.
    actualPopulationMs: 7261.7593499978175,
  },
  {
    attempt: 2,
    faithfulMs: 94134,
    faithfulOpCount: 53622,
    faithfulMkdirCount: 26811,
    singlePendingFlushMeanMs: 2.1417499999998837,
    batchedPerOpMeanMs: 1.897850000000326,
    singlePendingMkdirFlushMeanMs: 0.4984249999996973,
    batchedMkdirPerOpMeanMs: 0.49285000000032597,
    // 26,811 writes:6539.202899988141ms; 26,811 mkdirs:149.4713249831448ms.
    actualPopulationMs: 6688.674224971286,
  },
];
it.each(observations)(
  'counts each measured flush population once: actual CI attempt $attempt',
  (sample) => {
    expect(pendingFlushOverheadMs(sample)).toBeCloseTo(sample.actualPopulationMs, 6);
    expect(pendingFlushOverheadMs(sample)).toBeLessThanOrEqual(0.1 * sample.faithfulMs);
  },
);

it.each([
  { label: 'write-only', write: 1.1, mkdir: 0 },
  { label: 'mkdir-only', write: 0, mkdir: 1.1 },
  { label: 'common pending-call', write: 0.6, mkdir: 0.6 },
  { label: 'combined sub-budget shapes', write: 0.4, mkdir: 0.7 },
])('rejects real total overhead above10%: $label', ({ write, mkdir }) => {
  // A1000ms baseline, 100write+100mkdir calls: budget100ms.
  const cost = pendingFlushOverheadMs({
    faithfulOpCount: 200,
    faithfulMkdirCount: 100,
    singlePendingFlushMeanMs: 1 + write,
    batchedPerOpMeanMs: 1,
    singlePendingMkdirFlushMeanMs: 1 + mkdir,
    batchedMkdirPerOpMeanMs: 1,
  });
  expect(cost).toBeGreaterThan(100);
});

it('never credits a faster shape against another shape overhead', () => {
  expect(
    pendingFlushOverheadMs({
      faithfulOpCount: 200,
      faithfulMkdirCount: 100,
      singlePendingFlushMeanMs: 2.2,
      batchedPerOpMeanMs: 1,
      singlePendingMkdirFlushMeanMs: 0.1,
      batchedMkdirPerOpMeanMs: 1,
    }),
  ).toBeCloseTo(120, 9);
});
