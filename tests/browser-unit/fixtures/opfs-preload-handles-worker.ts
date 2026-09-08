/// <reference lib="webworker" />
import { OpfsFsSync, OpfsVfs, initBackend, syncMirror } from '@riftydev/vfs';

declare const self: DedicatedWorkerGlobalScope;

type Mode = 'preload' | 'unreadable' | 'unreadable-bytes' | 'concurrent' | 'native';
const enc = new TextEncoder();

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
}

async function outcome(run: () => unknown): Promise<unknown> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: errorName(error) };
  }
}

async function run(mode: Mode) {
  const root = await navigator.storage.getDirectory();
  const prefix = `preload-${crypto.randomUUID()}`;
  const parent = await root.getDirectoryHandle(prefix, { create: true });
  const a = await parent.getDirectoryHandle('a', { create: true });
  const b = await a.getDirectoryHandle('b', { create: true });
  const names = Array.from({ length: 8 }, (_, index) => `file-${index}.txt`);
  for (const name of names) {
    const file = await b.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(enc.encode(name));
    await writable.close();
  }
  const path = `/${prefix}/a/b/${names[0]}`;
  const calls = { root: 0, directory: 0, fileHandle: 0, getFile: 0 };
  let denyReads = true;
  const restorers: Array<() => void> = [];
  function instrument(prototype: object, name: string, counter: keyof typeof calls) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new Error(`missing native boundary ${name}`);
    }
    const original: (...args: unknown[]) => unknown = descriptor.value;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]) {
        calls[counter] += 1;
        if (mode === 'unreadable' && denyReads && name === 'getFile') {
          return Promise.reject(new DOMException('preload read denied', 'NotAllowedError'));
        }
        return Reflect.apply(original, this, args);
      },
    });
    restorers.push(() => Object.defineProperty(prototype, name, descriptor));
  }
  instrument(StorageManager.prototype, 'getDirectory', 'root');
  instrument(FileSystemDirectoryHandle.prototype, 'getDirectoryHandle', 'directory');
  instrument(FileSystemDirectoryHandle.prototype, 'getFileHandle', 'fileHandle');
  instrument(FileSystemFileHandle.prototype, 'getFile', 'getFile');
  if (mode === 'unreadable-bytes') {
    const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
    if (!descriptor) throw new Error('missing native arrayBuffer boundary');
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      ...descriptor,
      value: function (this: Blob) {
        return denyReads
          ? Promise.reject(new DOMException('preload bytes denied', 'NotReadableError'))
          : Reflect.apply(descriptor.value, this, []);
      },
    });
    restorers.push(() => Object.defineProperty(Blob.prototype, 'arrayBuffer', descriptor));
  }
  try {
    if (mode === 'preload') {
      const start = performance.now();
      await initBackend();
      const fsSync = syncMirror();
      if (!(fsSync instanceof OpfsFsSync)) throw new Error('OPFS backend required');
      const elapsedMs = performance.now() - start;
      const actual = names.map((name) =>
        new TextDecoder().decode(fsSync.readFileBytesSync(`/${prefix}/a/b/${name}`)),
      );
      fsSync.closeAll();
      return { calls, elapsedMs, actual };
    }
    if (mode === 'unreadable' || mode === 'unreadable-bytes') {
      const boot = await outcome(async () => {
        await initBackend();
        const fs = syncMirror();
        if (fs instanceof OpfsFsSync) fs.closeAll();
      });
      const vfs = new OpfsVfs();
      await vfs.init();
      const fs = new OpfsFsSync(root, vfs);
      denyReads = false;
      await fs.refreshIndex();
      denyReads = true;
      const preload = await outcome(() => fs.preloadContent());
      const read = await outcome(() => Array.from(fs.readFileBytesSync(path)));
      const copy = await outcome(() => fs.copyFileSync(path, `/${prefix}/copy.txt`));
      await fs.flush();
      fs.closeAll();
      return { boot, preload, read, copy, copied: fs.existsSync(`/${prefix}/copy.txt`) };
    }
    if (mode === 'concurrent') {
      const vfs = new OpfsVfs();
      await Promise.all(Array.from({ length: 12 }, () => vfs.init()));
      const initialCalls = calls.root;
      const descriptor = Object.getOwnPropertyDescriptor(StorageManager.prototype, 'getDirectory');
      if (!descriptor) throw new Error('missing getDirectory descriptor');
      let deny = true;
      Object.defineProperty(StorageManager.prototype, 'getDirectory', {
        ...descriptor,
        value: function (this: StorageManager) {
          if (deny) return Promise.reject(new DOMException('retry root', 'NotAllowedError'));
          return Reflect.apply(descriptor.value, this, []);
        },
      });
      const retry = new OpfsVfs();
      const rejected = await outcome(() => retry.init());
      deny = false;
      const recovered = await outcome(() => retry.init());
      Object.defineProperty(StorageManager.prototype, 'getDirectory', descriptor);
      return { initialCalls, rejected, recovered };
    }
    const vfs = new OpfsVfs();
    await vfs.init();
    const before = await vfs.readFile(path);
    const nativeFile = await b.getFileHandle(names[0] as string);
    const writable = await nativeFile.createWritable();
    await writable.write('changed');
    await writable.close();
    const fresh = await vfs.readFile(path);
    await vfs.readdir(`/${prefix}/a/b`);
    await a.removeEntry('b', { recursive: true });
    const oldView = await outcome(() => b.getFileHandle(names[0] as string));
    const missing = await outcome(() => vfs.readFile(path));
    const recreated = await a.getDirectoryHandle('b', { create: true });
    const newFile = await recreated.getFileHandle(names[0] as string, { create: true });
    const replacement = await newFile.createWritable();
    await replacement.write('recreated');
    await replacement.close();
    const current = await vfs.readFile(path);
    const invalidReceiver = await outcome(() =>
      Reflect.apply(FileSystemDirectoryHandle.prototype.getFileHandle, {}, ['x']),
    );
    const invalidArgument = await outcome(() => recreated.getFileHandle('a/b'));
    return {
      before: new TextDecoder().decode(before),
      fresh: new TextDecoder().decode(fresh),
      current: new TextDecoder().decode(current),
      oldView,
      missing,
      invalidReceiver,
      invalidArgument,
    };
  } finally {
    for (const restore of restorers.reverse()) restore();
    await root.removeEntry(prefix, { recursive: true });
  }
}

self.onmessage = (event: MessageEvent<{ mode: Mode }>) => {
  void run(event.data.mode).then(
    (result) => self.postMessage({ ok: true, result }),
    (error: unknown) => self.postMessage({ ok: false, error: String(error) }),
  );
};
