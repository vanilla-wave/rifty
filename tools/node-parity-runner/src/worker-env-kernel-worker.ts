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
  NODE_CLI_EVAL_CHILD_LOCAL_VFS_AUDIT,
  NODE_CLI_EVAL_TRANSIENT_DECODER_BYTES,
  NODE_CLI_EVAL_TRANSIENT_DECODER_PATH,
  NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH,
  NODE_CLI_EVAL_VFS_CARRIER_COMPLETE,
  NodeCliEvalVfsObserver,
  nodeCliEvalTransientSourceCarrierMutations,
} from './node-cli-eval-vfs-observer.ts';
import type { NodeCliEvalVfsFault, PhysicalStdioDeliveryFault } from './run-in-rifty.ts';

interface WorkerEnvHarnessData {
  readonly files: Readonly<Record<string, string>>;
  readonly nodeCliEvalVfsAudit: boolean;
  readonly nodeCliEvalVfsFault?: NodeCliEvalVfsFault;
  readonly physicalStdioDeliveryFault?: PhysicalStdioDeliveryFault;
}

if (parentPort === null) throw new Error('worker-env kernel adapter has no parent port');
const hostPort = parentPort;

const request = workerData as WorkerEnvHarnessData;
if (
  request.nodeCliEvalVfsFault !== undefined &&
  request.nodeCliEvalVfsFault !== 'child-local-transient-decoder-file' &&
  request.nodeCliEvalVfsFault !== 'child-local-transient-source-file' &&
  request.nodeCliEvalVfsFault !== 'sab-remote-transient-source-file'
) {
  throw new TypeError('worker-env parity received an unknown node-cli-eval VFS fault');
}
if (
  request.physicalStdioDeliveryFault !== undefined &&
  request.physicalStdioDeliveryFault !== 'stderr-before-two-stdout'
) {
  throw new TypeError('worker-env parity received an unknown stdio delivery fault');
}
if (request.nodeCliEvalVfsAudit) {
  // The disposable adapter is a real node:worker_threads Worker, while
  // SyncRpcClient's production guard targets browser Worker globals. Expose the
  // corresponding physical-worker markers only in eval children so the harness
  // exercises the real SAB client without widening program siblings.
  Object.defineProperties(globalThis, {
    WorkerGlobalScope: {
      value: class WorkerGlobalScope {},
      configurable: true,
    },
    postMessage: {
      value: (message: unknown): void => hostPort.postMessage(message),
      configurable: true,
    },
  });
}
const vfs = new NodeCliEvalVfsObserver();
vfs.loadFixture(
  Object.fromEntries(Object.entries(request.files).map(([path, source]) => [`/${path}`, source])),
);
setSyncMirror(vfs);

resetKeepalive();
installTimerGlobals();
hostProcess.on('unhandledRejection', (reason) => recordRejection(reason));

function createSyncCall(spec: WorkerSpawnSpec): (method: string, payload: unknown) => unknown {
  const ring = SabRing.attach(spec.syncRing, spec.payloadCapacity ?? DEFAULT_PAYLOAD_CAPACITY);
  const syncClient = new SyncRpcClient(ring);
  return (method: string, payload: unknown): unknown => syncClient.call(method, payload);
}

function reportChildLocalVfsAudit(syncCall: (method: string, payload: unknown) => unknown): void {
  syncCall(NODE_CLI_EVAL_CHILD_LOCAL_VFS_AUDIT, {
    actor: 'child-local',
    audit: vfs.audit([]),
  });
}

function installObservedNodeRuntime(spec: WorkerSpawnSpec): void {
  try {
    if (request.nodeCliEvalVfsFault === 'child-local-transient-decoder-file') {
      vfs.beginCarrierObservation('child-local');
      try {
        vfs.writeFileSync(
          NODE_CLI_EVAL_TRANSIENT_DECODER_PATH,
          new TextEncoder().encode(NODE_CLI_EVAL_TRANSIENT_DECODER_BYTES),
        );
        vfs.rmSync(NODE_CLI_EVAL_TRANSIENT_DECODER_PATH, { force: true });
      } finally {
        vfs.endCarrierObservation();
      }
    }
    const launch = readNodeEntryBootstrap().launch;
    const launchKind = (launch as { readonly kind: unknown }).kind;
    if (request.nodeCliEvalVfsFault !== undefined && launchKind !== 'eval') {
      throw new TypeError('node-cli-eval VFS fault requires an eval launch');
    }
    if (launchKind === 'eval') {
      if (request.nodeCliEvalVfsFault === 'child-local-transient-source-file') {
        const source = (launch as unknown as { readonly source?: unknown }).source;
        if (typeof source !== 'string') {
          throw new TypeError('node-cli-eval transient source fault requires string source');
        }
        vfs.beginCarrierObservation('child-local');
        try {
          vfs.writeFileSync(NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH, new TextEncoder().encode(source));
          vfs.rmSync(NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH, { force: true });
        } finally {
          vfs.endCarrierObservation();
        }
      }
    }
    installNodeRuntime(spec);
  } catch (error) {
    if (request.nodeCliEvalVfsAudit) reportChildLocalVfsAudit(createSyncCall(spec));
    throw error;
  }
}

async function runConfiguredNodeEntry(spec: WorkerSpawnSpec): Promise<void> {
  const bootstrap = readNodeEntryBootstrap();
  const launch = bootstrap.launch;
  const launchKind = (launch as { readonly kind: unknown }).kind;
  if (request.nodeCliEvalVfsFault !== undefined && launchKind !== 'eval') {
    throw new TypeError('node-cli-eval VFS fault requires an eval launch');
  }
  if (launchKind === 'eval') {
    const syncCall = createSyncCall(spec);
    publishKernelSyncApi({
      call: syncCall,
    });
    if (
      request.nodeCliEvalVfsFault === 'child-local-transient-source-file' ||
      request.nodeCliEvalVfsFault === 'sab-remote-transient-source-file'
    ) {
      const source = (launch as unknown as { readonly source?: unknown }).source;
      if (typeof source !== 'string') {
        throw new TypeError('node-cli-eval transient source fault requires string source');
      }
      if (request.nodeCliEvalVfsFault === 'child-local-transient-source-file') {
        if (
          JSON.stringify(vfs.mutations()) !==
          JSON.stringify(nodeCliEvalTransientSourceCarrierMutations('child-local', source))
        ) {
          throw new Error('node-cli-eval child-local pre-entry VFS carrier evidence is incomplete');
        }
        syncCall(NODE_CLI_EVAL_VFS_CARRIER_COMPLETE, { actor: 'child-local' });
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
    try {
      await import('../../../packages/workbench/src/workers/node-entry-bootstrap.ts');
    } finally {
      reportChildLocalVfsAudit(syncCall);
    }
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

function installStdioDeliveryFault(spec: WorkerSpawnSpec): Promise<void> | undefined {
  if (request.physicalStdioDeliveryFault === undefined) return undefined;

  const ackKind = 'rifty:parity-stdio-delivery-ack';
  const nativeStdoutPost = spec.stdio.stdout.postMessage.bind(spec.stdio.stdout);
  const nativeStderrPost = spec.stdio.stderr.postMessage.bind(spec.stdio.stderr);
  const heldStdout: Uint8Array[] = [];
  let stderrWrites = 0;
  let acknowledgements = 0;
  let released = false;
  let resolveProof!: () => void;
  let rejectProof!: (error: Error) => void;
  const proof = new Promise<void>((resolve, reject) => {
    resolveProof = resolve;
    rejectProof = reject;
  });

  const fail = (error: Error): never => {
    rejectProof(error);
    throw error;
  };

  const releaseIfProven = (): void => {
    if (released || heldStdout.length !== 2 || stderrWrites !== 1 || acknowledgements !== 1) {
      return;
    }
    for (const chunk of heldStdout) nativeStdoutPost(chunk);
    released = true;
    spec.stdio.stderr.removeEventListener('message', onAck);
    resolveProof();
  };
  const onAck = (event: MessageEvent): void => {
    const frame = event.data;
    if (
      typeof frame !== 'object' ||
      frame === null ||
      Reflect.ownKeys(frame).length !== 1 ||
      (frame as { readonly kind?: unknown }).kind !== ackKind
    ) {
      rejectProof(new TypeError('stdio delivery fault received an invalid parent ACK'));
      spec.stdio.stderr.removeEventListener('message', onAck);
      return;
    }
    acknowledgements++;
    if (acknowledgements !== 1) {
      rejectProof(new Error('stdio delivery fault received duplicate parent ACK'));
      spec.stdio.stderr.removeEventListener('message', onAck);
      return;
    }
    releaseIfProven();
  };
  spec.stdio.stderr.addEventListener('message', onAck);
  spec.stdio.stderr.start();

  Object.defineProperty(spec.stdio.stdout, 'postMessage', {
    configurable: true,
    value(message: unknown): void {
      const bytes =
        message instanceof Uint8Array
          ? message
          : fail(new TypeError('stdio delivery fault expected stdout bytes'));
      if (released || heldStdout.length === 2) {
        fail(new Error('stdio delivery fault received extra stdout'));
      }
      heldStdout.push(new Uint8Array(bytes));
      if (heldStdout.length !== 2) return;
      if (stderrWrites !== 1) {
        fail(new Error('stdio delivery fault received second stdout before stderr'));
      }
      releaseIfProven();
    },
  });
  Object.defineProperty(spec.stdio.stderr, 'postMessage', {
    configurable: true,
    value(message: unknown): void {
      const bytes =
        message instanceof Uint8Array
          ? message
          : fail(new TypeError('stdio delivery fault expected stderr bytes'));
      if (stderrWrites !== 0 || heldStdout.length !== 1 || released) {
        fail(new Error('stdio delivery fault expected stderr between two stdout writes'));
      }
      stderrWrites = 1;
      nativeStderrPost(new Uint8Array(bytes));
    },
  });

  return proof;
}

async function runNodeWorker(spec: WorkerSpawnSpec): Promise<void> {
  const stdioDeliveryProof = installStdioDeliveryFault(spec);
  const stdout = bindWorkerStdioOutput(spec.stdio.stdout, spec.outputState, 'stdout');
  const stderr = bindWorkerStdioOutput(spec.stdio.stderr, spec.outputState, 'stderr');
  if (request.nodeCliEvalVfsAudit) {
    // This starts before runEntryLifecycle publishes/decodes the bootstrap and
    // stays live through process adoption, entry, and failure settlement.
    vfs.startObservation('child-local');
  }
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
    preEntryHook: installObservedNodeRuntime,
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
  await stdioDeliveryProof;

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
