/**
 * Fixture for `fs-range-read-ring.fault.test.ts`: the owner realm serving a
 * memory store over a real SAB ring. Its positional read announces itself and
 * then parks on `gateSab`, so the test can kill this realm mid-`HANDLING`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { SabRing } from '../../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcDispatcher } from '../../../../packages/kernel/src/ipc/sync-dispatch.ts';
import { installRuntimeJsFsHandlers } from '../../../../packages/runtime-js/src/ipc/fs-handlers.ts';
import { MemoryFsSync } from '../../../../packages/vfs/src/sync-mirror.ts';

if (parentPort === null) throw new Error('fs-range-owner requires a parent port');
const port = parentPort;
const data = workerData as {
  sab: SharedArrayBuffer;
  payloadCapacity: number;
  gateSab: SharedArrayBuffer;
  path: string;
  size: number;
};

const store = new MemoryFsSync();
store.mkdirSync(data.path.slice(0, data.path.lastIndexOf('/')) || '/', { recursive: true });
store.writeFileSync(data.path, new Uint8Array(data.size).fill(0x61));
const gate = new Int32Array(data.gateSab);
const parked = new Proxy(store, {
  get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    if (key !== 'readFileRangeSync') return value.bind(target);
    return (...args: unknown[]) => {
      port.postMessage({ type: 'handling' });
      Atomics.wait(gate, 0, 0);
      return value.apply(target, args);
    };
  },
});
const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
installRuntimeJsFsHandlers(dispatcher, () => parked);
dispatcher.attach(SabRing.attach(data.sab, data.payloadCapacity));
// The dispatcher's wait does not hold the realm open; a port listener does.
port.on('message', () => {});
port.postMessage({ type: 'ready' });
