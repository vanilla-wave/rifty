import type { PersistFailureReport } from '@riftydev/vfs';

/** One durability gate for every owner operation that promises persisted state. */
export async function requireDurableFlush(
  flush: (() => Promise<PersistFailureReport | undefined>) | undefined,
): Promise<void> {
  if (!flush) return;
  const report = await flush();
  if (!report || report.total === 0) return;
  const first = report.failures[0];
  const sample = first ? `; first: ${first.op} ${first.path}: ${first.message}` : '';
  const error = new Error(
    `OPFS write-through drained with ${report.total} unhealed persist failure(s)${sample}`,
  );
  error.name = 'PersistFailureError';
  throw error;
}
