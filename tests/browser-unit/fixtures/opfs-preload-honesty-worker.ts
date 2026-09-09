/// <reference lib="webworker" />
import { installOpfsFs } from '@riftydev/vfs/internal';

declare const self: DedicatedWorkerGlobalScope;

export interface PreloadRequest {
  readonly fault: 'none' | 'preload' | 'metadata-preload';
  readonly operation: 'copy' | 'retry' | 'rename' | 'rename-denied';
}

function failure(error: unknown) {
  return {
    name: error instanceof Error ? error.name : '',
    message: error instanceof Error ? error.message : String(error),
    code:
      error instanceof Error && typeof Reflect.get(error, 'code') === 'string'
        ? (Reflect.get(error, 'code') as string)
        : '',
    path:
      error instanceof Error && typeof Reflect.get(error, 'path') === 'string'
        ? (Reflect.get(error, 'path') as string)
        : '',
  };
}

function attempt(operation: () => number[] | null) {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

async function probe(request: PreloadRequest): Promise<Record<string, unknown>> {
  const origin = await navigator.storage.getDirectory();
  const selected = await origin.getDirectoryHandle('preload-A');
  const nativeGetFile = FileSystemFileHandle.prototype.getFile;
  let attempts = 0;
  let denials = 0;
  FileSystemFileHandle.prototype.getFile = async function () {
    const path = await selected.resolve(this);
    if (path?.join('/') === 'tree/z-user.bin') {
      attempts += 1;
      if (request.fault === 'metadata-preload' || (request.fault === 'preload' && attempts === 2)) {
        denials += 1;
        throw new DOMException('controlled native source read refusal', 'NotAllowedError');
      }
    }
    return nativeGetFile.call(this);
  };
  let pair: Awaited<ReturnType<typeof installOpfsFs>> | undefined;
  const result: Record<string, unknown> = {};
  try {
    pair = await installOpfsFs(selected);
    const fs = pair.fsSync;
    const read = (path: string) => attempt(() => Array.from(fs.readFileBytesSync(path)));
    result.initialized = true;
    result.sourceAttempts = attempts;
    result.denials = denials;
    result.sourceSize = fs.statSync('/tree/z-user.bin').size;
    result.initial = {
      source: read('/tree/z-user.bin'),
      empty: read('/tree/empty.bin'),
      healthy: read('/tree/a-healthy.bin'),
    };
    if (request.operation !== 'rename-denied')
      FileSystemFileHandle.prototype.getFile = nativeGetFile;
    if (request.operation === 'copy') {
      result.copyExisting = attempt(() => {
        fs.copyFileSync('/tree/z-user.bin', '/existing.bin');
        return null;
      });
      result.copyMissing = attempt(() => {
        fs.copyFileSync('/tree/z-user.bin', '/missing.bin');
        return null;
      });
      result.cp = attempt(() => {
        fs.cpSync('/tree', '/copy-tree', { recursive: true });
        return null;
      });
      result.directoryTarget = attempt(() => {
        fs.copyFileSync('/tree/z-user.bin', '/tree');
        return null;
      });
      result.absentParent = attempt(() => {
        fs.copyFileSync('/tree/z-user.bin', '/absent/file.bin');
        return null;
      });
      fs.copyFileSync('/tree/empty.bin', '/empty-copy.bin');
      fs.copyFileSync('/tree/a-healthy.bin', '/healthy-copy.bin');
    } else if (request.operation === 'retry') {
      await fs.preloadContent();
      result.afterRetry = read('/tree/z-user.bin');
      fs.copyFileSync('/tree/z-user.bin', '/retry-copy.bin');
    } else {
      result.rename = attempt(() => {
        fs.renameSync('/tree', '/moved-tree');
        return null;
      });
      result.movedBeforeFlush = read('/moved-tree/z-user.bin');
    }
    const flushed = await fs.flush();
    result.flush = { total: flushed.total, failures: flushed.failures };
    if (request.operation === 'rename') {
      result.movedAfterFlush = read('/moved-tree/z-user.bin');
      result.copyAfterRename = attempt(() => {
        fs.copyFileSync('/moved-tree/z-user.bin', '/existing.bin');
        return null;
      });
      const copyFlush = await fs.flush();
      result.copyFlush = { total: copyFlush.total, failures: copyFlush.failures };
    }
  } catch (error) {
    result.error = failure(error);
  } finally {
    FileSystemFileHandle.prototype.getFile = nativeGetFile;
    pair?.fsSync.closeAll();
  }
  const readNative = async (path: string) => {
    let dir = origin;
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (name === undefined) throw new Error('Expected native file path');
    try {
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      return Array.from(
        new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      throw error;
    }
  };
  const physical: Record<string, number[] | null> = {};
  for (const path of [
    '/preload-A/tree/z-user.bin',
    '/preload-A/existing.bin',
    '/preload-A/missing.bin',
    '/preload-A/copy-tree/a-healthy.bin',
    '/preload-A/copy-tree/empty.bin',
    '/preload-A/copy-tree/z-user.bin',
    '/preload-A/healthy-copy.bin',
    '/preload-A/empty-copy.bin',
    '/preload-A/retry-copy.bin',
    '/preload-A/moved-tree/z-user.bin',
    '/outside-sentinel.bin',
    '/preload-B/z-user.bin',
  ])
    physical[path] = await readNative(path);
  result.native = physical;
  return result;
}

self.onmessage = (event: MessageEvent<PreloadRequest>) => {
  void probe(event.data).then(
    (result) => self.postMessage(result),
    (error: unknown) => self.postMessage({ error: failure(error) }),
  );
};
