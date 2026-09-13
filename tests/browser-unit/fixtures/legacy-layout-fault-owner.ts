/// <reference lib="webworker" />
import { nativeSegmentRecords, nativeWriteBytes } from './native-replica-observer.ts';
const channel = new BroadcastChannel('legacy-layout-cut');
const mode = await new Promise<string>((resolve) => {
  channel.onmessage = ({ data }) => {
    if (typeof data.mode === 'string') {
      channel.onmessage = null;
      resolve(data.mode);
    }
  };
});
channel.postMessage({ armed: true });
const createWritable = FileSystemFileHandle.prototype.createWritable;
let hasStage = false;
let cut = false;
FileSystemFileHandle.prototype.createWritable = async function (options) {
  const writer = await createWritable.call(this, options);
  const write = writer.write.bind(writer);
  const close = writer.close.bind(writer);
  writer.write = async (data) => {
    if (this.name.startsWith('segment-')) {
      const records = nativeSegmentRecords(await nativeWriteBytes(data));
      hasStage = records.some(
        (record) =>
          record.path.includes('/stages/') ||
          record.path.includes('/catalog-transactions/') ||
          record.path.includes('/projects/scratch/'),
      );
      if (
        mode === 'marker-quota' &&
        records.some((record) => record.path === '/.rifty/workbench/v2/storage-layout.json')
      ) {
        channel.postMessage({ denied: 'marker-quota' });
        throw new DOMException('diagnosis quota', 'QuotaExceededError');
      }
      if (mode === 'stage-quota' && hasStage)
        throw new DOMException('stage quota', 'QuotaExceededError');
    }
    await write(data);
  };
  writer.close = async () => {
    const selected =
      !cut &&
      this.name === 'HEAD' &&
      (mode === 'proof-before' || mode === 'proof-after' || (mode === 'stage-before' && hasStage));
    if (selected && mode !== 'proof-after') {
      cut = true;
      channel.postMessage({ cut: mode });
      await new Promise<void>(() => {});
    }
    await close();
    if (selected && mode === 'proof-after') {
      cut = true;
      channel.postMessage({ cut: mode });
      await new Promise<void>(() => {});
    }
  };
  return writer;
};
await import('../../../packages/workbench/src/workers/workbench-owner-bootstrap.ts');
