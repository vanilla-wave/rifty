/// <reference lib="webworker" />

import { OpfsFsSync, OpfsVfs, detectVfsBackend, initBackend, syncMirror } from '@riftydev/vfs';

declare const self: DedicatedWorkerGlobalScope;

interface PolicyRequest {
  readonly mode: 'direct' | 'selected';
  readonly operation: 'write' | 'read';
  readonly path: string;
  readonly bytes: number[];
  readonly denyStorage?: boolean;
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
    const { mode, operation, path, bytes, denyStorage } = event.data;
    const observed = facts();

    try {
      if (denyStorage) {
        Object.defineProperty(navigator.storage, 'getDirectory', {
          configurable: true,
          value: () => Promise.reject(new DOMException('pickup denied', 'NotAllowedError')),
        });
      }

      let fs: ReturnType<typeof syncMirror>;
      if (mode === 'direct') {
        const vfs = new OpfsVfs();
        await vfs.init();
        fs = await OpfsFsSync.init(vfs);
      } else {
        await initBackend();
        fs = syncMirror();
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
        if (fs instanceof OpfsFsSync) fs.closeAll();
        self.postMessage({
          ok: true,
          facts: observed,
          backend: fs instanceof OpfsFsSync ? 'opfs' : 'memory',
          flushResult,
        });
        return;
      }

      const actual = Array.from(fs.readFileBytesSync(path));
      if (fs instanceof OpfsFsSync) fs.closeAll();
      self.postMessage({
        ok: true,
        facts: observed,
        backend: fs instanceof OpfsFsSync ? 'opfs' : 'memory',
        actual,
      });
    } catch (error) {
      self.postMessage({
        ok: false,
        facts: observed,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  })();
};
