import { expect, it } from 'vitest';
import {
  type PendingProbeRound,
  pendingFlushOverheadMs,
} from '../../tests/browser-unit/fixtures/opfs-drain-overhead.ts';

// Actual Chromium148 Linux observations, CI36365591064 attempts1/2, unchanged550538dd7.
const observations = [
  {
    attempt: 1,
    faithfulMs: 75646,
    faithfulOpCount: 53622,
    faithfulMkdirCount: 26811,
    pendingProbeRounds: [
      {
        singlePendingFlushMeanMs: 1.586524999999965,
        batchedPerOpMeanMs: 1.3266000000000349,
        singlePendingMkdirFlushMeanMs: 0.3753250000000116,
        batchedMkdirPerOpMeanMs: 0.36440000000002326,
      },
    ],
    // 26,811 writes:6968.8491749981295ms; 26,811 mkdirs:292.9101749996879ms.
    actualPopulationMs: 7261.7593499978175,
  },
  {
    attempt: 2,
    faithfulMs: 94134,
    faithfulOpCount: 53622,
    faithfulMkdirCount: 26811,
    pendingProbeRounds: [
      {
        singlePendingFlushMeanMs: 2.1417499999998837,
        batchedPerOpMeanMs: 1.897850000000326,
        singlePendingMkdirFlushMeanMs: 0.4984249999996973,
        batchedMkdirPerOpMeanMs: 0.49285000000032597,
      },
    ],
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

function round(write: number, mkdir: number): PendingProbeRound {
  return {
    singlePendingFlushMeanMs: 1 + write,
    batchedPerOpMeanMs: 1,
    singlePendingMkdirFlushMeanMs: 1 + mkdir,
    batchedMkdirPerOpMeanMs: 1,
  };
}

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
    pendingProbeRounds: [round(write, mkdir)],
  });
  expect(cost).toBeGreaterThan(100);
});

it('never credits a faster shape against another shape overhead', () => {
  expect(
    pendingFlushOverheadMs({
      faithfulOpCount: 200,
      faithfulMkdirCount: 100,
      pendingProbeRounds: [
        {
          singlePendingFlushMeanMs: 2.2,
          batchedPerOpMeanMs: 1,
          singlePendingMkdirFlushMeanMs: 0.1,
          batchedMkdirPerOpMeanMs: 1,
        },
      ],
    }),
  ).toBeCloseTo(120, 9);
});

// Actual main CI records where ONE 200-iteration probe window caught a runner
// stall and the projection ×26811 tripped the10% budget with the vfs code
// unchanged against the neighbouring green run (132137bca: write delta0.019,
// mkdir delta0.016):
//   run39375394764 (40837803b): mkdir0.9333 vs0.5583 → 11128 > 10846.8
//   run39888233973 (8874e47d6): write2.9911 vs2.0243 → 26330 > 12012.5
const quiet: PendingProbeRound = {
  singlePendingFlushMeanMs: 1.5930500000005123,
  batchedPerOpMeanMs: 1.5736250000004657,
  singlePendingMkdirFlushMeanMs: 0.5248749999993015,
  batchedMkdirPerOpMeanMs: 0.5086999999999534,
};
const stalledWrite: PendingProbeRound = {
  singlePendingFlushMeanMs: 2.991099999998696,
  batchedPerOpMeanMs: 2.024300000001676,
  singlePendingMkdirFlushMeanMs: 0.612675000000745,
  batchedMkdirPerOpMeanMs: 0.5973999999999069,
};
const stalledMkdir: PendingProbeRound = {
  singlePendingFlushMeanMs: 1.7157499999995343,
  batchedPerOpMeanMs: 1.67570000000007,
  singlePendingMkdirFlushMeanMs: 0.933300000000163,
  batchedMkdirPerOpMeanMs: 0.5582750000001397,
};
const population = { faithfulOpCount: 53622, faithfulMkdirCount: 26811 };

it('one-round samples reproduce both red main records', () => {
  expect(
    pendingFlushOverheadMs({ ...population, pendingProbeRounds: [stalledWrite] }),
  ).toBeGreaterThan(0.1 * 120125);
  expect(
    pendingFlushOverheadMs({ ...population, pendingProbeRounds: [stalledMkdir] }),
  ).toBeGreaterThan(0.1 * 108468);
});

it('median over five rounds survives two stalled windows of either shape', () => {
  const cost = pendingFlushOverheadMs({
    ...population,
    pendingProbeRounds: [quiet, stalledWrite, quiet, stalledMkdir, quiet],
  });
  const quietCost = pendingFlushOverheadMs({ ...population, pendingProbeRounds: [quiet] });
  expect(cost).toBeCloseTo(quietCost, 9);
  expect(cost).toBeLessThanOrEqual(0.1 * 97461);
});

it('median keeps a constant per-flush cost present in every round', () => {
  // +0.5ms on every awaited write flush ×26811 = 13405ms > 10% of any observed baseline.
  const costly: PendingProbeRound = {
    ...quiet,
    singlePendingFlushMeanMs: quiet.batchedPerOpMeanMs + 0.5,
  };
  const cost = pendingFlushOverheadMs({
    ...population,
    pendingProbeRounds: [costly, costly, costly, costly, costly],
  });
  expect(cost).toBeGreaterThan(0.1 * 120125);
});

it('median is order-independent and takes the upper middle of an even count', () => {
  const a = pendingFlushOverheadMs({
    ...population,
    pendingProbeRounds: [stalledWrite, quiet, stalledMkdir],
  });
  const b = pendingFlushOverheadMs({
    ...population,
    pendingProbeRounds: [quiet, stalledMkdir, stalledWrite],
  });
  expect(a).toBeCloseTo(b, 9);
  expect(a).toBeCloseTo(
    pendingFlushOverheadMs({ ...population, pendingProbeRounds: [stalledMkdir] }),
    9,
  );
  // Even count: the stricter (upper) middle — a tie never hides cost.
  expect(
    pendingFlushOverheadMs({ ...population, pendingProbeRounds: [quiet, stalledWrite] }),
  ).toBeCloseTo(pendingFlushOverheadMs({ ...population, pendingProbeRounds: [stalledWrite] }), 9);
});

it('refuses an empty round set', () => {
  expect(() => pendingFlushOverheadMs({ ...population, pendingProbeRounds: [] })).toThrow(/round/);
});
