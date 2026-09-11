/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

const params = new URL(import.meta.url).searchParams;
const delay = Number(params.get('delay') ?? 0);
const nativeGetFile = FileSystemFileHandle.prototype.getFile;
FileSystemFileHandle.prototype.getFile = async function (...args) {
  if (this.name === 'delayed.txt') {
    self.postMessage({ type: 'preload-entered' });
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (params.has('close')) self.close();
  }
  return Reflect.apply(nativeGetFile, this, args);
};
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
