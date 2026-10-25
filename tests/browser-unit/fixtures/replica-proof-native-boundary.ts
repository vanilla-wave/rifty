import {
  type NativeReplicaRecord,
  nativeSegmentRecords,
  nativeWriteBytes,
} from './native-replica-observer.ts';
import type { ProofBoundary } from './operation-budget-native-boundary.ts';

/** Hold the real HEAD publication or segment read bearing the owner's logical proof. */
export function replicaProofPause(boundary: ProofBoundary) {
  const proto = FileSystemFileHandle.prototype;
  const create = proto.createWritable;
  const getFile = proto.getFile;
  let released = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paused = new Set<string>();
  const reads: { path: string; text: string }[] = [];
  const writes: string[] = [];
  let pending: readonly NativeReplicaRecord[] = [];
  const proof = (record: NativeReplicaRecord) =>
    record.path.includes('/.rifty/workbench/v2/storage-proof/');
  const hold = async (path: string) => {
    paused.add(path);
    await held;
  };
  proto.createWritable = async function (options) {
    const writer = await create.call(this, options);
    const write = writer.write.bind(writer);
    const close = writer.close.bind(writer);
    writer.write = async (data) => {
      if (this.name.startsWith('segment-')) {
        pending = nativeSegmentRecords(await nativeWriteBytes(data));
        writes.push(
          ...pending
            .filter((record) => proof(record) && record.kind === 'file')
            .map((record) => record.path),
        );
      }
      await write(data);
    };
    writer.close = async () => {
      const record = pending.find(
        (record) => proof(record) && record.kind === (boundary === 'cleanup' ? 'delete' : 'file'),
      );
      if (!released && boundary !== 'read' && this.name === 'HEAD' && record)
        await hold(record.path);
      await close();
    };
    return writer;
  };
  proto.getFile = async function () {
    const file = await getFile.call(this);
    if (this.name.startsWith('segment-')) {
      for (const record of nativeSegmentRecords(new Uint8Array(await file.arrayBuffer()))) {
        if (!proof(record) || record.kind !== 'file') continue;
        if (!released && boundary === 'read') await hold(record.path);
        reads.push({ path: record.path, text: new TextDecoder().decode(record.bytes) });
      }
    }
    return file;
  };
  return {
    paused,
    reads,
    writes,
    release() {
      released = true;
      release();
    },
    restore() {
      released = true;
      release();
      proto.createWritable = create;
      proto.getFile = getFile;
    },
  };
}
