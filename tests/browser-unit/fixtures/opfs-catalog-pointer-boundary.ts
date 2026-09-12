export type CatalogPointerBoundary = 'before-close' | 'after-close';

/** Pause only the native atomic-swap close; every VFS/claim/catalog operation is real. */
export function pauseCatalogPointer(
  boundary: CatalogPointerBoundary,
  reached: () => void,
  options: {
    readonly targetPath?: string;
    readonly afterNativeClose?: (handle: FileSystemFileHandle) => void | Promise<void>;
  } = {},
) {
  const targetPath = options.targetPath ?? '/.rifty/workbench/playground/catalog.json';
  const getDirectory = navigator.storage.getDirectory.bind(navigator.storage);
  let armed = false;
  const hold = async (): Promise<never> => {
    armed = false;
    reached();
    return new Promise<never>(() => {});
  };
  const file = (handle: FileSystemFileHandle, path: string): FileSystemFileHandle =>
    new Proxy(handle, {
      get(target, key) {
        if (key === 'createWritable') {
          return async (...args: Parameters<FileSystemFileHandle['createWritable']>) => {
            const writable = await target.createWritable(...args);
            return new Proxy(writable, {
              get(stream, member) {
                if (member === 'close') {
                  return async () => {
                    if (armed && path === targetPath && boundary === 'before-close') await hold();
                    await stream.close();
                    if (path === targetPath && options.afterNativeClose !== undefined) {
                      await options.afterNativeClose(target);
                    }
                    if (armed && path === targetPath && boundary === 'after-close') await hold();
                  };
                }
                const value: unknown = Reflect.get(stream, member, stream);
                return typeof value === 'function' ? value.bind(stream) : value;
              },
            });
          };
        }
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const directory = (handle: FileSystemDirectoryHandle, path: string): FileSystemDirectoryHandle =>
    new Proxy(handle, {
      get(target, key) {
        if (key === 'getDirectoryHandle') {
          return async (name: string, options?: FileSystemGetDirectoryOptions) =>
            directory(await target.getDirectoryHandle(name, options), `${path}/${name}`);
        }
        if (key === 'getFileHandle') {
          return async (name: string, options?: FileSystemGetFileOptions) =>
            file(await target.getFileHandle(name, options), `${path}/${name}`);
        }
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  Object.defineProperty(navigator.storage, 'getDirectory', {
    configurable: true,
    value: async () => directory(await getDirectory(), ''),
  });
  return () => {
    armed = true;
  };
}
