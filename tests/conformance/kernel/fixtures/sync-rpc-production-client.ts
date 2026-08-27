import { parentPort, workerData } from 'node:worker_threads';
import { SabRing } from '../../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcClient } from '../../../../packages/kernel/src/ipc/sync-client.ts';

if (parentPort === null) throw new Error('sync-rpc production client requires a parent port');

Object.assign(globalThis, {
  WorkerGlobalScope: class WorkerGlobalScope {},
  postMessage() {},
});

const data = workerData as { sab: SharedArrayBuffer; payloadCapacity: number };
const client = new SyncRpcClient(SabRing.attach(data.sab, data.payloadCapacity));
try {
  const jsonOne = client.call('echo', { sequence: 1 });
  const binary = (
    client as SyncRpcClient & {
      callBinary(method: string, payload: Uint8Array): unknown;
    }
  ).callBinary('binary-echo', Uint8Array.from([0xff, 0x00, 0x7f]));
  let binaryError: unknown;
  try {
    (
      client as SyncRpcClient & {
        callBinary(method: string, payload: Uint8Array): unknown;
      }
    ).callBinary('binary-failure', Uint8Array.from([1]));
  } catch (error) {
    binaryError = {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      code:
        typeof error === 'object' && error !== null
          ? (error as { readonly code?: unknown }).code
          : undefined,
    };
  }
  const jsonThree = client.call('echo', { sequence: 3 });
  parentPort.postMessage({
    type: 'reply',
    replies: [jsonOne, binary, binaryError, jsonThree],
  });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}
