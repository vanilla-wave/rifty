/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

const fault = new URL(import.meta.url).searchParams.get('fault');
const createWritable = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = function (...args) {
  if (this.name === 'index.js') {
    if (fault === 'quota')
      return Promise.reject(new DOMException('snapshot native quota probe', 'QuotaExceededError'));
    if (fault === 'hold') {
      self.postMessage({ type: 'snapshot-native-held' });
      return new Promise<FileSystemWritableFileStream>(() => {});
    }
  }
  return Reflect.apply(createWritable, this, args);
};
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
