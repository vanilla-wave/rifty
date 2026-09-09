import type { Page } from '@playwright/test';
import type { NamespaceReply, NamespaceRequest } from './opfs-storage-namespace-worker.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-storage-namespace-worker.ts`;
export const outsideBytes = [0, 1, 127, 128, 254, 255, 13, 10];
export const encoded = (text: string): number[] => Array.from(new TextEncoder().encode(text));

export function runNamespaceWorker(page: Page, request: NamespaceRequest): Promise<NamespaceReply> {
  return page.evaluate(
    ({ url, request }) =>
      new Promise<NamespaceReply>((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('OPFS namespace worker timeout'));
        }, 30_000);
        worker.onmessage = (event: MessageEvent<NamespaceReply>) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage(request);
      }),
    { url: workerUrl, request },
  );
}

export async function seedNamespaceOrigin(page: Page): Promise<void> {
  await page.evaluate(async (outsideBytes) => {
    const root = await navigator.storage.getDirectory();
    async function write(dir: FileSystemDirectoryHandle, name: string, bytes: number[]) {
      const file = await dir.getFileHandle(name, { create: true });
      const writer = await file.createWritable();
      await writer.write(new Uint8Array(bytes));
      await writer.close();
    }
    const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
    await write(root, 'outside-sentinel.bin', outsideBytes);
    await write(root, 'existing.bin', bytes('default-existing'));
    await write(root, 'blocked', bytes('a file must survive root selection'));
    await write(
      await root.getDirectoryHandle('A', { create: true }),
      'existing.bin',
      bytes('A-existing'),
    );
  }, outsideBytes);
}

export function readNativeFiles(
  page: Page,
  paths: readonly string[],
): Promise<Readonly<Record<string, number[] | null>>> {
  return page.evaluate(async (paths) => {
    const root = await navigator.storage.getDirectory();
    const result: Record<string, number[] | null> = {};
    for (const path of paths) {
      try {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop();
        if (name === undefined) throw new Error('Expected a native file path');
        let dir = root;
        for (const part of parts) dir = await dir.getDirectoryHandle(part);
        const file = await (await dir.getFileHandle(name)).getFile();
        result[path] = Array.from(new Uint8Array(await file.arrayBuffer()));
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        result[path] = null;
      }
    }
    return result;
  }, paths);
}

export function nativeRootNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(async () => {
    const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    const names: string[] = [];
    for await (const [name] of root.entries()) names.push(name);
    return names.sort();
  });
}

/** Refuse only an actual native write inside the selected owner's proof directory. */
export async function denyNamespaceProofWrites(
  page: Page,
  namespace: string,
): Promise<() => Promise<void>> {
  const ownerUrl = await page.evaluate(async () => {
    const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
    const { workbenchViteHostAssets } = await import(/* @vite-ignore */ assetsUrl);
    return new URL(workbenchViteHostAssets.workers.owner, location.href).href;
  });
  const prefix = `${namespace}/.rifty/workbench/v1/storage-proof/`;
  const nativeFault = `
(() => {
  const createWritable = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function(options) {
    const origin = await navigator.storage.getDirectory();
    const path = await origin.resolve(this);
    if (path !== null && path.join('/').startsWith(${JSON.stringify(prefix)})) {
      throw new DOMException('namespace-proof-denied:' + path.join('/'), 'NotAllowedError');
    }
    return createWritable.call(this, options);
  };
})();
`;
  const handler = async (route: import('@playwright/test').Route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${nativeFault}\n${await response.text()}` });
  };
  await page.route(ownerUrl, handler);
  return () => page.unroute(ownerUrl, handler);
}

/** Refuse reading one actual acquired-tree entry inside the selected owner Worker. */
export async function denyNamespacePreloadReads(
  page: Page,
  namespace: string,
  mode: 'getFile' | 'arrayBuffer',
): Promise<() => Promise<void>> {
  const ownerUrl = await page.evaluate(async () => {
    const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
    const { workbenchViteHostAssets } = await import(/* @vite-ignore */ assetsUrl);
    return new URL(workbenchViteHostAssets.workers.owner, location.href).href;
  });
  const target = `${namespace}/existing.bin`;
  const nativeFault = `
(() => {
  const getFile = FileSystemFileHandle.prototype.getFile;
  const arrayBuffer = Blob.prototype.arrayBuffer;
  const deniedFiles = new WeakSet();
  const fault = () => new DOMException(${JSON.stringify(`namespace-preload-denied:${mode}:${target}`)}, 'NotAllowedError');
  FileSystemFileHandle.prototype.getFile = async function() {
    const origin = await navigator.storage.getDirectory();
    const path = await origin.resolve(this);
    if (path !== null && path.join('/') === ${JSON.stringify(target)}) {
      if (${JSON.stringify(mode)} === 'getFile') throw fault();
      const file = await getFile.call(this);
      deniedFiles.add(file);
      return file;
    }
    return getFile.call(this);
  };
  Blob.prototype.arrayBuffer = function() {
    return deniedFiles.has(this) ? Promise.reject(fault()) : arrayBuffer.call(this);
  };
})();
`;
  const handler = async (route: import('@playwright/test').Route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${nativeFault}\n${await response.text()}` });
  };
  await page.route(ownerUrl, handler);
  return () => page.unroute(ownerUrl, handler);
}
