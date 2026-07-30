import hostProcess from 'node:process';
import { parentPort, workerData } from 'node:worker_threads';
import { dispatchToPort, listPorts, onRegistryChange, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { SyncRpcFsSync, awaitDrain } from '@riftydev/runtime-js';
import { readNodeEntryBootstrap } from '@riftydev/runtime-js/builtins/node-entry-url';
import { postNodeProcessListeningControl } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { DEFAULT_PAYLOAD_CAPACITY, SabRing } from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcClient } from '../../../packages/kernel/src/ipc/sync-client.ts';
import {
  publishKernelProcessSpec,
  publishKernelSyncApi,
} from '../../../packages/kernel/src/shared-globals.ts';
import {
  type WorkerInitMessage,
  type WorkerSpawnSpec,
  runEntryLifecycle,
} from '../../../packages/kernel/src/worker-entry.ts';
import {
  bindWorkerStdioOutput,
  sealWorkerOutput,
  workerOutputAttestation,
} from '../../../packages/kernel/src/worker-stdio-drain.ts';
import { runNodeEntry } from '../../../packages/runtime-js/src/builtins/node-entry.ts';
import {
  recordRejection,
  resetKeepalive,
} from '../../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import { installNodeRuntime } from '../../../packages/runtime-js/src/ipc/install-process.ts';
import { runNodeProgramLifecycle } from '../../../packages/workbench/src/workers/node-program-lifecycle.ts';
import {
  NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH,
  NODE_CLI_EVAL_VFS_CARRIER_COMPLETE,
  NodeCliEvalVfsObserver,
  nodeCliEvalTransientSourceCarrierMutations,
} from './node-cli-eval-vfs-observer.ts';
import type { NodeCliEvalVfsFault } from './run-in-rifty.ts';

interface WorkerEnvHarnessData {
  readonly files: Readonly<Record<string, string>>;
  readonly nodeCliEvalVfsFault?: NodeCliEvalVfsFault;
}

if (parentPort === null) throw new Error('worker-env kernel adapter has no parent port');
const hostPort = parentPort;

const request = workerData as WorkerEnvHarnessData;
if (
  request.nodeCliEvalVfsFault !== undefined &&
  request.nodeCliEvalVfsFault !== 'child-local-transient-source-file' &&
  request.nodeCliEvalVfsFault !== 'sab-remote-transient-source-file'
) {
  throw new TypeError('worker-env parity received an unknown node-cli-eval VFS fault');
}
const vfs = new NodeCliEvalVfsObserver();
vfs.loadFixture(
  Object.fromEntries(Object.entries(request.files).map(([path, source]) => [`/${path}`, source])),
);
setSyncMirror(vfs);

resetKeepalive();
installTimerGlobals();
hostProcess.on('unhandledRejection', (reason) => recordRejection(reason));

async function runConfiguredNodeEntry(spec: WorkerSpawnSpec): Promise<void> {
  const bootstrap = readNodeEntryBootstrap();
  const launch = bootstrap.launch;
  const launchKind = (launch as { readonly kind: unknown }).kind;
  if (request.nodeCliEvalVfsFault !== undefined && launchKind !== 'eval') {
    throw new TypeError('node-cli-eval VFS fault requires an eval launch');
  }
  if (launchKind === 'eval') {
    const ring = SabRing.attach(spec.syncRing, spec.payloadCapacity ?? DEFAULT_PAYLOAD_CAPACITY);
    const syncClient = new SyncRpcClient(ring);
    const syncCall = (method: string, payload: unknown): unknown =>
      syncClient.call(method, payload);
    publishKernelSyncApi({
      call: syncCall,
    });
    if (request.nodeCliEvalVfsFault !== undefined) {
      const source = (launch as unknown as { readonly source?: unknown }).source;
      if (typeof source !== 'string') {
        throw new TypeError('node-cli-eval transient source fault requires string source');
      }
      if (request.nodeCliEvalVfsFault === 'child-local-transient-source-file') {
        vfs.startObservation();
        vfs.beginCarrierObservation('child-local');
        vfs.writeFileSync(NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH, new TextEncoder().encode(source));
        vfs.rmSync(NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH, { force: true });
        vfs.endCarrierObservation();
        const mutations = vfs.mutations();
        const expected = nodeCliEvalTransientSourceCarrierMutations('child-local', source);
        if (JSON.stringify(mutations) !== JSON.stringify(expected)) {
          throw new Error('node-cli-eval child-local VFS carrier evidence is incomplete');
        }
        syncCall(NODE_CLI_EVAL_VFS_CARRIER_COMPLETE, {
          actor: 'child-local',
          mutations,
        });
      } else {
        const remoteFs = new SyncRpcFsSync(syncCall);
        remoteFs.writeFileSync(
          NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH,
          new TextEncoder().encode(source),
        );
        remoteFs.rmSync(NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH, { force: true });
        syncCall(NODE_CLI_EVAL_VFS_CARRIER_COMPLETE, { actor: 'sab-remote' });
      }
    }
    // Execute the actual Workbench node-entry module. It owns eval-vs-program
    // dispatch, loader eval, print/drain ordering, process adoption, and exit.
    await import('../../../packages/workbench/src/workers/node-entry-bootstrap.ts');
    return;
  }
  const entryPath = spec.argv[1];
  if (entryPath === undefined) throw new Error('worker-env parity child has no argv[1]');
  const runEntry = () =>
    runNodeEntry({
      vfs,
      entryPath,
      cwd: spec.cwd,
      ...(launch.kind === 'program' && launch.bin ? { bin: true } : {}),
    });
  if (launch.kind !== 'program' || !launch.nodeServe) {
    await runEntry();
    return;
  }

  registerNetBuiltins();
  const proc = globalThis.process;
  await runNodeProgramLifecycle({
    runEntry,
    listPorts,
    onPortsChange: onRegistryChange,
    awaitDrain: () => awaitDrain({ capMs: Number.POSITIVE_INFINITY }),
    servePreview: (port) =>
      serveCrossRealmPreview(
        port,
        async (request) => dispatchToPort(port, request),
        launch.previewScope === undefined ? {} : { scope: launch.previewScope },
      ),
    postListening: (ports) => postNodeProcessListeningControl(proc, ports, launch.previewScope),
    readExitCode: () => proc.exitCode,
    exit: (code) => proc.exit(code),
  });
}

async function runNodeWorker(spec: WorkerSpawnSpec): Promise<void> {
  const stdout = bindWorkerStdioOutput(spec.stdio.stdout, spec.outputState, 'stdout');
  const stderr = bindWorkerStdioOutput(spec.stdio.stderr, spec.outputState, 'stderr');
  publishKernelProcessSpec({
    pid: spec.pid,
    ppid: spec.ppid,
    argv: spec.argv,
    env: spec.env,
    cwd: spec.cwd,
    stdio: {
      stdout,
      stderr,
      stdin: spec.stdio.stdin,
      ipc: spec.stdio.ipc,
    },
  });
  const outcome = await runEntryLifecycle(spec, {
    preEntryHook: installNodeRuntime,
    drainHook: null,
    async runEntry(entry) {
      if (entry.kind !== 'url' || entry.url !== 'parity://node-entry') {
        throw new Error('worker-env parity received an unexpected node entry');
      }
      await runConfiguredNodeEntry(spec);
    },
    writeStderr(bytes) {
      stderr.write(bytes);
    },
  });

  // `worker_threads.Worker` uses serve:true. A clean entry stays alive for its
  // parentPort; only setup failure is reaped by the production kernel contract.
  if (outcome.threw) {
    if (sealWorkerOutput(spec.outputState)) {
      hostPort.postMessage({
        type: 'exit',
        code: outcome.code,
        attestation: workerOutputAttestation(spec.outputState),
      });
    }
  }
}

hostPort.once('message', (message: unknown) => {
  const init = message as Partial<WorkerInitMessage> | null;
  if (init?.type !== 'init' || init.spec === undefined) {
    throw new TypeError('worker-env kernel adapter expected one init message');
  }
  void runNodeWorker(init.spec);
});
