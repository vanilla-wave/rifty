export interface FlushOverheadSample {
  readonly faithfulOpCount: number;
  readonly faithfulMkdirCount: number;
  readonly singlePendingFlushMeanMs: number;
  readonly batchedPerOpMeanMs: number;
  readonly singlePendingMkdirFlushMeanMs: number;
  readonly batchedMkdirPerOpMeanMs: number;
}

/** Existing two independent bounds expressed as their maximum. */
export function pendingFlushOverheadMs(sample: FlushOverheadSample): number {
  return Math.max(
    Math.max(0, sample.singlePendingFlushMeanMs - sample.batchedPerOpMeanMs) *
      sample.faithfulOpCount,
    Math.max(0, sample.singlePendingMkdirFlushMeanMs - sample.batchedMkdirPerOpMeanMs) *
      sample.faithfulMkdirCount,
  );
}
