/// <reference lib="webworker" />

const getFile = FileSystemFileHandle.prototype.getFile;
FileSystemFileHandle.prototype.getFile = function (...args) {
  if (this.name === 'unreadable.txt') {
    return Promise.reject(new DOMException('native preload failure', 'NotReadableError'));
  }
  return Reflect.apply(getFile, this, args);
};
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
