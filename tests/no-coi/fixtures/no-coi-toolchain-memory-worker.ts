/// <reference lib="webworker" />

Object.defineProperty(navigator.storage, 'getDirectory', {
  configurable: true,
  value: () => Promise.reject(new DOMException('forced memory backend', 'NotAllowedError')),
});

await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
