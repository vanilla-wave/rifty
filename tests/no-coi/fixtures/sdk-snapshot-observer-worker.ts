/// <reference lib="webworker" />
import { OpfsFsSync } from '../../../packages/vfs/src/index.ts';
declare const self: DedicatedWorkerGlobalScope;
const nativeFlush = OpfsFsSync.prototype.flush;
OpfsFsSync.prototype.flush = async function (options) {
  const counts: { persisted: number; total: number }[] = [];
  const report = await nativeFlush.call(this, {
    ...options,
    onProgress(count) {
      counts.push(count);
      options?.onProgress?.(count);
    },
  });
  self.postMessage({ type: 'native-flush-receipt', counts, failed: report.total });
  return report;
};
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
