/// <reference lib="webworker" />
import { installWorkbenchOwnerStorageAuthority } from '../../../packages/workbench/src/workers/workbench-owner-storage.ts';

declare const self: DedicatedWorkerGlobalScope;
let release!: () => void;
async function run(namespace: string) {
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closed!: () => void;
  const lateClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const create = FileSystemFileHandle.prototype.createSyncAccessHandle;
  FileSystemFileHandle.prototype.createSyncAccessHandle = async function () {
    const handle = await create.call(this);
    await held;
    return new Proxy(handle, {
      get(target, key) {
        if (key === 'close')
          return () => {
            target.close();
            closed();
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  try {
    await installWorkbenchOwnerStorageAuthority('preferred', { namespace, ioReportTimeoutMs: 40 });
    throw new Error('Acquisition deadline became a successful owner');
  } catch (error) {
    self.postMessage({
      phase: 'reported',
      name: error instanceof Error ? error.name : '',
      message: String(error),
    });
  }
  await lateClosed;
  FileSystemFileHandle.prototype.createSyncAccessHandle = create;
  const authority = await installWorkbenchOwnerStorageAuthority('required', {
    namespace,
    ioReportTimeoutMs: 100,
  });
  self.postMessage({ phase: 'reacquired', storage: authority.snapshot });
}
self.onmessage = ({ data }: MessageEvent<{ namespace: string; release?: boolean }>) => {
  if (data.release) {
    release();
    return;
  }
  void run(data.namespace).catch((error: unknown) => self.postMessage({ error: String(error) }));
};
