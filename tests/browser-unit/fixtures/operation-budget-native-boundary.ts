/// <reference lib="webworker" />
/** Clock + native OPFS only. Every rifty owner, VFS and scheduler remains real. */
export function manualClock() {
  const nativeSet = globalThis.setTimeout.bind(globalThis);
  const nativeClear = globalThis.clearTimeout.bind(globalThis);
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  globalThis.setTimeout = ((handler: TimerHandler, delay = 0, ...args: unknown[]) => {
    if (typeof handler !== 'function') throw new Error('String clock callback not supported');
    const id = nextId++;
    pending.set(id, { at: now + delay, run: () => handler(...args) });
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    pending.delete(id);
  }) as typeof clearTimeout;
  const pump = async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => nativeSet(resolve, 0));
    await Promise.resolve();
  };
  return {
    pump,
    async advanceTo(target: number) {
      if (target < now) throw new Error('Clock cannot go backwards');
      for (;;) {
        const next = [...pending]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (next === undefined) break;
        now = next[1].at;
        pending.delete(next[0]);
        next[1].run();
        await pump();
      }
      now = target;
      await pump();
    },
    restore() {
      globalThis.setTimeout = nativeSet;
      globalThis.clearTimeout = nativeClear;
    },
  };
}

export type ProofBoundary = 'close' | 'read' | 'cleanup';

export async function nativePause(
  namespace: string,
  boundary: ProofBoundary,
  matches: (path: string) => boolean,
) {
  const getDirectory = navigator.storage.getDirectory.bind(navigator.storage);
  const nativeRoot = await (await getDirectory()).getDirectoryHandle(namespace, { create: true });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paused = new Set<string>();
  const writes: string[] = [];
  const closes: string[] = [];
  const reads: { path: string; text: string }[] = [];
  let released = false;
  const hold = async (path: string, kind: ProofBoundary) => {
    if (!released && boundary === kind && matches(path)) {
      paused.add(path);
      await held;
    }
  };
  const file = (handle: FileSystemFileHandle, path: string): FileSystemFileHandle =>
    new Proxy(handle, {
      get(target, member) {
        if (member === 'getFile')
          return async () => {
            await hold(path, 'read');
            const result = await target.getFile();
            reads.push({ path, text: await result.text() });
            return result;
          };
        if (member === 'createWritable')
          return async (...args: Parameters<FileSystemFileHandle['createWritable']>) => {
            writes.push(path);
            const stream = await target.createWritable(...args);
            return new Proxy(stream, {
              get(writable, key) {
                if (key === 'close')
                  return async () => {
                    await hold(path, 'close');
                    await writable.close();
                    closes.push(path);
                  };
                const value: unknown = Reflect.get(writable, key, writable);
                return typeof value === 'function' ? value.bind(writable) : value;
              },
            });
          };
        const value: unknown = Reflect.get(target, member, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const directory = (handle: FileSystemDirectoryHandle, path: string): FileSystemDirectoryHandle =>
    new Proxy(handle, {
      get(target, member) {
        if (member === 'getDirectoryHandle')
          return async (name: string, options?: FileSystemGetDirectoryOptions) =>
            directory(await target.getDirectoryHandle(name, options), `${path}/${name}`);
        if (member === 'getFileHandle')
          return async (name: string, options?: FileSystemGetFileOptions) =>
            file(await target.getFileHandle(name, options), `${path}/${name}`);
        if (member === 'removeEntry')
          return async (name: string, options?: FileSystemRemoveOptions) => {
            await hold(`${path}/${name}`, 'cleanup');
            return target.removeEntry(name, options);
          };
        const value: unknown = Reflect.get(target, member, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  Object.defineProperty(navigator.storage, 'getDirectory', {
    configurable: true,
    value: async () => directory(await getDirectory(), ''),
  });
  return {
    root: directory(nativeRoot, `/${namespace}`),
    nativeRoot,
    paused,
    writes,
    closes,
    reads,
    release() {
      released = true;
      release();
    },
    restore() {
      released = true;
      release();
      Object.defineProperty(navigator.storage, 'getDirectory', {
        configurable: true,
        value: getDirectory,
      });
    },
  };
}

export function observe<T>(promise: Promise<T>) {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  let value: T | undefined;
  let error: string | undefined;
  void promise.then(
    (result) => {
      state = 'resolved';
      value = result;
    },
    (failure: unknown) => {
      state = 'rejected';
      error = failure instanceof Error ? failure.message : String(failure);
    },
  );
  return { snapshot: () => ({ state, value, error }) };
}
