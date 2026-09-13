/// <reference lib="webworker" />
let headWrites = 0;
const nativeCreateWritable = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = async function (options) {
  if (this.name === 'HEAD') headWrites++;
  return nativeCreateWritable.call(this, options);
};
const channel = new BroadcastChannel('no-coi-layout-proof');
channel.onmessage = ({ data }) => {
  if (data === 'inspect') {
    channel.postMessage({ headWrites });
    channel.close();
  }
};
await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
