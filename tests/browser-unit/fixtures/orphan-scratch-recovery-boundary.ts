import {
  catalogPath,
  nativeCatalog,
  nativeTree,
  orphanRoot,
  recoveryNamespace,
  retainedRoot,
} from './orphan-scratch-recovery-data.ts';

export const checkpoints = [
  'copy-before-close',
  'copy-after-close',
  'retention-pointer-before-close',
  'retention-pointer-after-close',
  'source-remove-before',
  'source-remove-after',
  'fresh-pointer-before-close',
  'fresh-pointer-after-close',
] as const;
export type RecoveryCheckpoint = (typeof checkpoints)[number];
export type NativeFault =
  | RecoveryCheckpoint
  | 'copy-quota'
  | 'fresh-pointer-permission'
  | 'export-read'
  | 'source-read';

export async function custody() {
  const { raw: catalogBytes, value: catalog } = await nativeCatalog();
  const selected = await navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle(recoveryNamespace));
  const retained: Record<string, Awaited<ReturnType<typeof nativeTree>>> = {};
  try {
    let root = selected;
    for (const part of retainedRoot.split('/').filter(Boolean))
      root = await root.getDirectoryHandle(part);
    for await (const [id, handle] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === 'directory')
        retained[id] = await nativeTree(`${recoveryNamespace}${retainedRoot}/${id}/tree`);
    }
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
  return {
    catalog,
    catalogBytes,
    source: await nativeTree(`${recoveryNamespace}${orphanRoot}`),
    retained,
  };
}

/** Intercepts native file close/remove/read only; all catalog/VFS operations remain real. */
export async function installNativeBoundary(
  fault: NativeFault | undefined,
  reached: (checkpoint: RecoveryCheckpoint) => Promise<void>,
) {
  const origin = await navigator.storage.getDirectory();
  const createWritable = FileSystemFileHandle.prototype.createWritable;
  const getFile = FileSystemFileHandle.prototype.getFile;
  const removeEntry = FileSystemDirectoryHandle.prototype.removeEntry;
  let armed = fault === 'export-read' || fault === 'source-read';
  let deniedReads = 0;
  const hold = async (checkpoint: RecoveryCheckpoint): Promise<never> => {
    armed = false;
    await reached(checkpoint);
    return new Promise<never>(() => {});
  };
  const physicalPath = async (handle: FileSystemHandle) =>
    (await origin.resolve(handle))?.join('/') ?? '';
  const prefix = `${recoveryNamespace}${retainedRoot}/`;
  FileSystemFileHandle.prototype.getFile = async function () {
    const path = await physicalPath(this);
    if (
      armed &&
      ((fault === 'export-read' && path.startsWith(prefix) && path.endsWith('/tree/user.bin')) ||
        (fault === 'source-read' && path === `${recoveryNamespace}${orphanRoot}/user.bin`))
    ) {
      deniedReads += 1;
      throw new DOMException('orphan-native-read-denied', 'NotAllowedError');
    }
    return getFile.call(this);
  };
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const path = await physicalPath(this);
    if (
      armed &&
      fault === 'copy-quota' &&
      path.startsWith(prefix) &&
      path.endsWith('/tree/user.bin')
    )
      throw new DOMException('orphan-native-copy-quota', 'QuotaExceededError');
    const stream = await createWritable.call(this, options);
    let written = '';
    return new Proxy(stream, {
      get(target, key) {
        if (key === 'write')
          return async (data: FileSystemWriteChunkType) => {
            if (typeof data === 'string') written = data;
            else if (data instanceof Uint8Array) written = new TextDecoder().decode(data);
            return target.write(data);
          };
        if (key === 'close')
          return async () => {
            let kind: 'copy' | 'retention-pointer' | 'fresh-pointer' | undefined;
            if (path.startsWith(prefix) && path.endsWith('/tree/user.bin')) kind = 'copy';
            if (path === `${recoveryNamespace}${catalogPath}`) {
              const catalog = JSON.parse(written) as {
                retainedScratch?: unknown[];
                scratch?: unknown;
              };
              if (Array.isArray(catalog.retainedScratch) && catalog.retainedScratch.length > 0)
                kind = catalog.scratch === null ? 'retention-pointer' : 'fresh-pointer';
            }
            if (armed && kind === 'fresh-pointer' && fault === 'fresh-pointer-permission') {
              await target.abort();
              throw new DOMException('orphan-native-fresh-pointer-denied', 'NotAllowedError');
            }
            if (armed && kind !== undefined && fault === `${kind}-before-close`)
              await hold(`${kind}-before-close`);
            await target.close();
            if (armed && kind !== undefined && fault === `${kind}-after-close`)
              await hold(`${kind}-after-close`);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  FileSystemDirectoryHandle.prototype.removeEntry = async function (name, options) {
    const path = `${await physicalPath(this)}/${name}`;
    const source =
      path === `${recoveryNamespace}${orphanRoot}` ||
      path === `${recoveryNamespace}/.rifty/workbench/v1/projects/scratch`;
    if (armed && source && fault === 'source-remove-before') await hold(fault);
    await removeEntry.call(this, name, options);
    if (armed && source && fault === 'source-remove-after') await hold(fault);
  };
  return {
    deniedReads: () => deniedReads,
    arm() {
      armed = true;
    },
    restore() {
      FileSystemFileHandle.prototype.createWritable = createWritable;
      FileSystemFileHandle.prototype.getFile = getFile;
      FileSystemDirectoryHandle.prototype.removeEntry = removeEntry;
    },
  };
}
