/// <reference lib="webworker" />

declare const self: DedicatedWorkerGlobalScope;
let writable = 0;
let mkdir = 0;
let remove = 0;
let fault = '';
let failures = 0;

const nativeWritable = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = function (...args) {
  writable++;
  if (this.name === fault) {
    failures++;
    return Promise.reject(new DOMException('warm-open native quota probe', 'QuotaExceededError'));
  }
  return Reflect.apply(nativeWritable, this, args);
};
const nativeDirectory = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
FileSystemDirectoryHandle.prototype.getDirectoryHandle = function (...args) {
  if (args[1]?.create) mkdir++;
  return Reflect.apply(nativeDirectory, this, args);
};
const nativeRemove = FileSystemDirectoryHandle.prototype.removeEntry;
FileSystemDirectoryHandle.prototype.removeEntry = function (...args) {
  remove++;
  return Reflect.apply(nativeRemove, this, args);
};
self.addEventListener('message', (event: MessageEvent<{ type?: string; fault?: string }>) => {
  if (event.data.type !== 'warm-open-probe') return;
  if (event.data.fault !== undefined) fault = event.data.fault;
  self.postMessage({ type: 'warm-open-counts', counts: { writable, mkdir, remove, failures } });
});
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
