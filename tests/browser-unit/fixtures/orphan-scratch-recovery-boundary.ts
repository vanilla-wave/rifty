import {
  type NativeReplicaRecord,
  nativeSegmentRecords,
  nativeWriteBytes,
} from './native-replica-observer.ts';
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
  const retained: Record<string, Awaited<ReturnType<typeof nativeTree>>> = {};
  const retainedTree = await nativeTree(`${recoveryNamespace}${retainedRoot}`);
  for (const path of retainedTree?.directories ?? []) {
    if (path.includes('/')) continue;
    retained[path] = await nativeTree(`${recoveryNamespace}${retainedRoot}/${path}/tree`);
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
  let armed = fault === 'export-read' || fault === 'source-read';
  let deniedReads = 0;
  let pending: readonly NativeReplicaRecord[] = [];
  const hold = async (checkpoint: RecoveryCheckpoint): Promise<never> => {
    armed = false;
    await reached(checkpoint);
    return new Promise<never>(() => {});
  };
  const selected = async (handle: FileSystemHandle) =>
    (await origin.resolve(handle))?.[0] === recoveryNamespace;
  const prefix = `${retainedRoot}/`;
  FileSystemFileHandle.prototype.getFile = async function () {
    const file = await getFile.call(this);
    if (armed && this.name.startsWith('segment-') && (await selected(this))) {
      const records = nativeSegmentRecords(new Uint8Array(await file.arrayBuffer()));
      if (
        records.some(
          (record) =>
            record.kind === 'file' &&
            ((fault === 'export-read' &&
              record.path.startsWith(prefix) &&
              record.path.endsWith('/tree/user.bin')) ||
              (fault === 'source-read' && record.path === `${orphanRoot}/user.bin`)),
        )
      ) {
        deniedReads += 1;
        throw new DOMException('orphan-native-read-denied', 'NotAllowedError');
      }
    }
    return file;
  };
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const inNamespace = await selected(this);
    const stream = await createWritable.call(this, options);
    const write = stream.write.bind(stream);
    const close = stream.close.bind(stream);
    stream.write = async (data) => {
      if (inNamespace && this.name.startsWith('segment-')) {
        pending = nativeSegmentRecords(await nativeWriteBytes(data));
        if (
          armed &&
          fault === 'copy-quota' &&
          pending.some(
            (record) =>
              record.kind === 'file' &&
              record.path.startsWith(prefix) &&
              record.path.endsWith('/tree/user.bin'),
          )
        )
          throw new DOMException('orphan-native-copy-quota', 'QuotaExceededError');
      }
      await write(data);
    };
    stream.close = async () => {
      let kind: 'copy' | 'retention-pointer' | 'fresh-pointer' | undefined;
      let source = false;
      if (inNamespace && this.name === 'HEAD') {
        if (
          pending.some(
            (record) =>
              record.kind === 'file' &&
              record.path.startsWith(prefix) &&
              record.path.endsWith('/tree/user.bin'),
          )
        )
          kind = 'copy';
        const record = pending.find(
          (record) => record.kind === 'file' && record.path === catalogPath,
        );
        if (record) {
          const catalog = JSON.parse(new TextDecoder().decode(record.bytes)) as {
            retainedScratch?: unknown[];
            scratch?: unknown;
          };
          if (Array.isArray(catalog.retainedScratch) && catalog.retainedScratch.length > 0)
            kind = catalog.scratch === null ? 'retention-pointer' : 'fresh-pointer';
        }
        source = pending.some(
          (record) =>
            record.kind === 'delete' &&
            (record.path === orphanRoot || orphanRoot.startsWith(`${record.path}/`)),
        );
      }
      if (armed && kind === 'fresh-pointer' && fault === 'fresh-pointer-permission') {
        await stream.abort();
        throw new DOMException('orphan-native-fresh-pointer-denied', 'NotAllowedError');
      }
      if (armed && kind !== undefined && fault === `${kind}-before-close`)
        await hold(`${kind}-before-close`);
      if (armed && source && fault === 'source-remove-before') await hold(fault);
      await close();
      if (armed && kind !== undefined && fault === `${kind}-after-close`)
        await hold(`${kind}-after-close`);
      if (armed && source && fault === 'source-remove-after') await hold(fault);
    };
    return stream;
  };
  return {
    deniedReads: () => deniedReads,
    arm() {
      armed = true;
    },
    restore() {
      FileSystemFileHandle.prototype.createWritable = createWritable;
      FileSystemFileHandle.prototype.getFile = getFile;
    },
  };
}
