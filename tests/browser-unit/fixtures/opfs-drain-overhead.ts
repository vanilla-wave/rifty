/** One probe round: K single-pending awaited flushes vs K ops under ONE flush,
 * for writes and mkdirs, measured back-to-back on the same drained instance. */
export interface PendingProbeRound {
  readonly singlePendingFlushMeanMs: number;
  readonly batchedPerOpMeanMs: number;
  readonly singlePendingMkdirFlushMeanMs: number;
  readonly batchedMkdirPerOpMeanMs: number;
}

export interface FlushOverheadSample {
  readonly faithfulOpCount: number;
  readonly faithfulMkdirCount: number;
  readonly pendingProbeRounds: ReadonlyArray<PendingProbeRound>;
}

/** Sum each shape's positive per-call delta over its actual faithful-loop
 * population — one round's projection of flush-machinery overhead. */
function roundOverheadMs(sample: FlushOverheadSample, round: PendingProbeRound): number {
  const writeCalls = sample.faithfulOpCount - sample.faithfulMkdirCount;
  return (
    Math.max(0, round.singlePendingFlushMeanMs - round.batchedPerOpMeanMs) * writeCalls +
    Math.max(0, round.singlePendingMkdirFlushMeanMs - round.batchedMkdirPerOpMeanMs) *
      sample.faithfulMkdirCount
  );
}

/** Median over rounds of the per-round projection. A runner stall inside one
 * ~0.6 s probe window shifts that round's mean by ~1 ms and the ×26 811
 * projection by ~27 s (red main runs 39375394764, 39888233973, vfs unchanged);
 * a real per-flush cost is in EVERY round and survives the median. Even
 * counts take the upper middle — the stricter side. */
export function pendingFlushOverheadMs(sample: FlushOverheadSample): number {
  if (sample.pendingProbeRounds.length === 0)
    throw new Error('pendingFlushOverheadMs: no probe rounds');
  const costs = sample.pendingProbeRounds
    .map((round) => roundOverheadMs(sample, round))
    .sort((a, b) => a - b);
  return costs[Math.floor(costs.length / 2)] as number;
}
