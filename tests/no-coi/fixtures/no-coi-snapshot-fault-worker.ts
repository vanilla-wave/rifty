/// <reference lib="webworker" />
import { observeNativeReplicaWrites } from '../../browser-unit/fixtures/native-replica-observer.ts';
declare const self: DedicatedWorkerGlobalScope;

const fault = new URL(import.meta.url).searchParams.get('fault');
observeNativeReplicaWrites(async (records) => {
  if (
    records.some(
      (record) => record.kind === 'file' && record.path === '/project/node_modules/ms/index.js',
    )
  ) {
    if (fault === 'quota')
      throw new DOMException('snapshot native quota probe', 'QuotaExceededError');
    if (fault === 'hold') {
      self.postMessage({ type: 'snapshot-native-held' });
      await new Promise<void>(() => {});
    }
  }
});
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
