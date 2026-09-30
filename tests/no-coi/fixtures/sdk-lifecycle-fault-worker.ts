/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;
const fault = new URL(import.meta.url).searchParams.get('fault');
const nativeAcquire = FileSystemFileHandle.prototype.createSyncAccessHandle;
FileSystemFileHandle.prototype.createSyncAccessHandle = async function (...args) {
  if (this.name === 'writer.lock') {
    if (fault === 'permission')
      throw new DOMException('native permission probe', 'NotAllowedError');
    if (fault === 'unobserved') await new Promise<void>(() => {});
  }
  try {
    return await Reflect.apply(nativeAcquire, this, args);
  } catch (error) {
    if ((error as DOMException).name === 'NoModificationAllowedError')
      self.postMessage({ type: 'native-contention-observed' });
    throw error;
  }
};
const nativeRead = FileSystemFileHandle.prototype.getFile;
FileSystemFileHandle.prototype.getFile = async function (...args) {
  if (this.name === 'HEAD' && fault === 'wait-hydrate') {
    self.postMessage({ type: 'native-hydrate-held' });
    await new Promise<void>(() => {});
  }
  return Reflect.apply(nativeRead, this, args);
};
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
