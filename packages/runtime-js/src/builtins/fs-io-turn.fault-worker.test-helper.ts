/**
 * Kernel-child half of `fs-io-turn.fault.test.ts`: rifty `fs` over a real SAB sync-RPC
 * ring whose responder is the test's thread. Only the DOM Worker scope is stubbed.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { SabRing, SyncRpcClient } from '@riftydev/kernel';
import { installNodeProcessShim } from '../ipc/install-process.ts';
import { installRemoteSyncFs } from '../ipc/sync-rpc-fs.ts';
import { readFile, stat } from './fs.ts';
import { setImmediate } from './timers.ts';

const data = workerData as { sab: SharedArrayBuffer; capacity: number; mode: string };
const scope = globalThis as unknown as Record<string, unknown>;
scope.WorkerGlobalScope = function WorkerGlobalScope() {};
scope.postMessage = () => {};
const client = new SyncRpcClient(SabRing.attach(data.sab, data.capacity));
installRemoteSyncFs(
  (method, payload) => client.call(method, payload),
  (method, payload) => client.callBinary(method, payload),
);
const log = (message: unknown): void => parentPort?.postMessage(message);

if (data.mode === 'oversize') {
  setImmediate(() => log('immediate queued before the call'));
  readFile('/data/big.bin', (error, bytes) =>
    log(error ? `callback error: ${error.message}` : `callback ${String(bytes?.length)} bytes`),
  );
  log('submitted');
} else if (data.mode === 'dead') {
  stat('/data/f.txt', () => log('callback'));
  log('submitted');
} else if (data.mode === 'dead-exit') {
  const ipc = new MessageChannel();
  ipc.port2.onmessage = (event) => log({ frame: event.data });
  const process = installNodeProcessShim({
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      stdin: new MessageChannel().port1,
      ipc: ipc.port1,
    },
  });
  // Exit in the same tick: the `stat` is submitted, not yet run.
  stat('/data/f.txt', () => log('callback'));
  log('exiting');
  try {
    process.exit(0);
  } catch {
    log('exit returned');
  }
}
