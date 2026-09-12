/// <reference lib="webworker" />

import {
  MemoryVfs,
  OpfsFsSync,
  OpfsVfs,
  asyncVfs,
  detectVfsBackend,
  initBackend,
  syncMirror,
} from '@riftydev/vfs';

declare const self: DedicatedWorkerGlobalScope;

interface PolicyRequest {
  readonly mode: 'direct' | 'selected';
  readonly operation: 'write' | 'read';
  readonly path: string;
  readonly bytes: number[];
  readonly denyStorage?: boolean;
  readonly disableSyncHandle?: boolean;
}

function facts() {
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBufferType: typeof globalThis.SharedArrayBuffer,
    opfsSyncSupported: OpfsFsSync.isSupported(),
    opfsAsyncSupported: OpfsVfs.isSupported(),
    detected: detectVfsBackend(),
  };
}

self.onmessage = (event: MessageEvent<PolicyRequest>) => {
  void (async () => {
    const { mode, operation, path, bytes, denyStorage, disableSyncHandle } = event.data;
    const workerId = crypto.randomUUID();
    let fs: ReturnType<typeof syncMirror> | undefined;
    let publicAsyncVfs: ReturnType<typeof asyncVfs> = null;
    let initChoice: 'opfs' | 'memory' | null = null;

    try {
      if (disableSyncHandle) {
        const prototype = FileSystemFileHandle.prototype as {
          createSyncAccessHandle?: unknown;
        };
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'createSyncAccessHandle');
        if (descriptor?.configurable !== true) {
          throw new Error('createSyncAccessHandle browser boundary is not configurable');
        }
        Object.defineProperty(prototype, 'createSyncAccessHandle', {
          configurable: true,
          value: undefined,
        });
      }

      const observed = facts();
      if (denyStorage) {
        Object.defineProperty(navigator.storage, 'getDirectory', {
          configurable: true,
          value: () => Promise.reject(new DOMException('pickup denied', 'NotAllowedError')),
        });
      }

      if (mode === 'direct') {
        const vfs = new OpfsVfs();
        await vfs.init();
        fs = await OpfsFsSync.init(vfs);
      } else {
        initChoice = await initBackend();
        fs = syncMirror();
        publicAsyncVfs = asyncVfs();
      }

      if (operation === 'write') {
        fs.mkdirSync('/__rifty_no_coi_opfs__', { recursive: true });
        fs.writeFileSync(path, new Uint8Array(bytes));
        const flush = (fs as { flush?: () => Promise<unknown> }).flush;
        const report = typeof flush === 'function' ? await flush.call(fs) : null;
        const flushResult =
          report && typeof report === 'object' && 'total' in report
            ? {
                total: (report as { total: unknown }).total,
                failures: (report as { failures?: unknown }).failures,
              }
            : report;
        const syncHandlesClosed = fs instanceof OpfsFsSync;
        const selectedPair =
          mode === 'selected'
            ? {
                publicAsyncBackend:
                  publicAsyncVfs instanceof OpfsVfs
                    ? 'opfs'
                    : publicAsyncVfs instanceof MemoryVfs
                      ? 'memory'
                      : null,
                crossSurfaceActual:
                  publicAsyncVfs === null ? null : Array.from(await publicAsyncVfs.readFile(path)),
              }
            : {};
        if (syncHandlesClosed) fs.closeAll();
        self.postMessage({
          ok: true,
          workerId,
          facts: observed,
          initChoice,
          backend: fs instanceof OpfsFsSync ? 'opfs' : 'memory',
          flushResult,
          syncHandlesClosed,
          ...selectedPair,
        });
        return;
      }

      const actual = Array.from(fs.readFileBytesSync(path));
      const syncHandlesClosed = fs instanceof OpfsFsSync;
      if (syncHandlesClosed) fs.closeAll();
      self.postMessage({
        ok: true,
        workerId,
        facts: observed,
        initChoice,
        backend: fs instanceof OpfsFsSync ? 'opfs' : 'memory',
        actual,
        syncHandlesClosed,
      });
    } catch (error) {
      const syncHandlesClosed = fs instanceof OpfsFsSync;
      if (syncHandlesClosed) fs.closeAll();
      self.postMessage({
        ok: false,
        workerId,
        facts: facts(),
        initChoice,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        syncHandlesClosed,
      });
    }
  })();
};
