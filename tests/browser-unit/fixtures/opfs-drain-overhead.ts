export interface FlushOverheadSample {
  readonly faithfulOpCount: number;
  readonly faithfulMkdirCount: number;
  readonly singlePendingFlushMeanMs: number;
  readonly batchedPerOpMeanMs: number;
  readonly singlePendingMkdirFlushMeanMs: number;
  readonly batchedMkdirPerOpMeanMs: number;
}

/** Sum each shape's overhead over its actual faithful-loop population. */
export function pendingFlushOverheadMs(sample: FlushOverheadSample): number {
  const writeCalls = sample.faithfulOpCount - sample.faithfulMkdirCount;
  return (
    Math.max(0, sample.singlePendingFlushMeanMs - sample.batchedPerOpMeanMs) * writeCalls +
    Math.max(0, sample.singlePendingMkdirFlushMeanMs - sample.batchedMkdirPerOpMeanMs) *
      sample.faithfulMkdirCount
  );
}
