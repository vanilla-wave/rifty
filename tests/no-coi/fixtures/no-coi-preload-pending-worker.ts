/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;
let failRead: (() => void) | undefined;
const getFile = FileSystemFileHandle.prototype.getFile;
FileSystemFileHandle.prototype.getFile = function (...args) {
  if (this.name === 'unreadable.txt') {
    self.postMessage({ type: 'preload-blocked' });
    return new Promise<File>((_, reject) => {
      failRead = () => reject(new DOMException('native preload failure', 'NotReadableError'));
    });
  }
  return Reflect.apply(getFile, this, args);
};
self.addEventListener('message', (event) => {
  if (event.data?.type === 'fail-preload') failRead?.();
});
await import('../../../packages/runtime-js/src/worker-entry.ts');
self.postMessage({ type: 'runtime-listener-installed' });
