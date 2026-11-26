/**
 * Fixture for `fs-range-read-ring.fault.test.ts`: a guest realm whose `node:fs`
 * reads the parent's owner store over a real SAB ring (`SyncRpcClient` +
 * `installRemoteSyncFs`), then runs the listed `readSync` calls into a shared
 * buffer the test inspects.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { SabRing } from '../../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcClient } from '../../../../packages/kernel/src/ipc/sync-client.ts';
import * as fs from '../../../../packages/runtime-js/src/builtins/fs.ts';
import { installRemoteSyncFs } from '../../../../packages/runtime-js/src/ipc/sync-rpc-fs.ts';

if (parentPort === null) throw new Error('fs-range-reader requires a parent port');
const port = parentPort;
Object.assign(globalThis, { WorkerGlobalScope: class WorkerGlobalScope {}, postMessage() {} });

interface Read {
  readonly offset: number;
  readonly length: number;
  readonly position: number | null;
}
const data = workerData as {
  sab: SharedArrayBuffer;
  payloadCapacity: number;
  bufferSab: SharedArrayBuffer;
  path: string;
  reads: readonly Read[];
};

const client = new SyncRpcClient(SabRing.attach(data.sab, data.payloadCapacity));
installRemoteSyncFs(
  (method, payload) => client.call(method, payload),
  (method, payload) => client.callBinary(method, payload),
);
const buffer = new Uint8Array(data.bufferSab);
const fd = fs.openSync(data.path, 'r');
port.postMessage({ type: 'opened' });
for (const read of data.reads) {
  try {
    const n = fs.readSync(fd, buffer, read.offset, read.length, read.position);
    port.postMessage({ type: 'read', n });
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
port.postMessage({ type: 'done' });
