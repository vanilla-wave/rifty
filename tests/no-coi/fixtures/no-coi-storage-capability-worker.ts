/// <reference lib="webworker" />
const fault = new URL(location.href).searchParams.get('fault');
if (fault === 'createWritable') {
  Reflect.deleteProperty(FileSystemFileHandle.prototype, 'createWritable');
} else if (fault === 'root') {
  Object.defineProperty(navigator.storage, 'getDirectory', {
    value: () =>
      Promise.reject(new DOMException('Storage root denied by the browser', 'UnknownError')),
  });
}
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
