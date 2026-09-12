/// <reference lib="webworker" />
import { nativeSegmentRecords, nativeWriteBytes } from './native-replica-observer.ts';

// Pause actual HEAD close containing a real npm file; all owner/npm code remains real.
const channel = new BroadcastChannel('pr323-interrupted-install');
let boundary: 'before' | 'after' = 'after';
channel.onmessage = ({ data }) => {
  if (data.boundary !== 'before' && data.boundary !== 'after') return;
  boundary = data.boundary;
  channel.postMessage({ armed: true });
};
const target = '/.rifty/workbench/v2/projects/saved-interrupted/tree/node_modules/lodash/LICENSE';
const createWritable = FileSystemFileHandle.prototype.createWritable;
let persistedBytes = 0;
FileSystemFileHandle.prototype.createWritable = async function (options) {
  const writer = await createWritable.call(this, options);
  const write = writer.write.bind(writer);
  const close = writer.close.bind(writer);
  writer.write = async (data) => {
    if (this.name.startsWith('segment-')) {
      const file = nativeSegmentRecords(await nativeWriteBytes(data)).find(
        (record) => record.kind === 'file' && record.path === target,
      );
      persistedBytes = file?.bytes?.length ?? 0;
    }
    await write(data);
  };
  writer.close = async () => {
    if (boundary === 'before' && this.name === 'HEAD' && persistedBytes > 0) {
      channel.postMessage({ persistedBytes });
      await new Promise<void>(() => {});
    }
    await close();
    if (boundary === 'after' && this.name === 'HEAD' && persistedBytes > 0) {
      channel.postMessage({ persistedBytes });
      await new Promise<void>(() => {});
    }
  };
  return writer;
};
await import('../../../packages/workbench/src/workers/workbench-owner-bootstrap.ts');
