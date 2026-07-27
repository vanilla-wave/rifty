import { parentPort, workerData } from 'node:worker_threads';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import {
  type WorkerInitMessage,
  type WorkerSpawnSpec,
  runEntryLifecycle,
} from '../../../packages/kernel/src/worker-entry.ts';
import { runNodeEntry } from '../../../packages/runtime-js/src/builtins/node-entry.ts';
import { installNodeRuntime } from '../../../packages/runtime-js/src/ipc/install-process.ts';

interface WorkerEnvHarnessData {
  readonly files: Readonly<Record<string, string>>;
}

if (parentPort === null) throw new Error('worker-env kernel adapter has no parent port');
const hostPort = parentPort;

const request = workerData as WorkerEnvHarnessData;
const vfs = new MemoryFsSync();
vfs.loadFixture(
  Object.fromEntries(Object.entries(request.files).map(([path, source]) => [`/${path}`, source])),
);
setSyncMirror(vfs);

async function runNodeWorker(spec: WorkerSpawnSpec): Promise<void> {
  const outcome = await runEntryLifecycle(spec, {
    preEntryHook: installNodeRuntime,
    drainHook: null,
    async runEntry(entry) {
      if (entry.kind !== 'url' || entry.url !== 'parity://node-entry') {
        throw new Error('worker-env parity received an unexpected node entry');
      }
      const entryPath = spec.argv[1];
      if (entryPath === undefined) throw new Error('worker-env parity child has no argv[1]');
      await runNodeEntry({ vfs, entryPath, cwd: spec.cwd });
    },
    writeStderr(bytes) {
      spec.stdio.stderr.postMessage(bytes);
    },
  });

  // `worker_threads.Worker` uses serve:true. A clean entry stays alive for its
  // parentPort; only setup failure is reaped by the production kernel contract.
  if (outcome.threw) {
    spec.stdio.ipc.postMessage({ kind: 'control:exiting', code: outcome.code });
    hostPort.postMessage({ type: 'exit', code: outcome.code });
  }
}

hostPort.once('message', (message: unknown) => {
  const init = message as Partial<WorkerInitMessage> | null;
  if (init?.type !== 'init' || init.spec === undefined) {
    throw new TypeError('worker-env kernel adapter expected one init message');
  }
  void runNodeWorker(init.spec);
});
