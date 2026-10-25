/// <reference lib="webworker" />
Reflect.deleteProperty(FileSystemFileHandle.prototype, 'createSyncAccessHandle');
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
