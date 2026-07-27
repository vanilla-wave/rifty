/**
 * Owner-realm Node worker launchers (ADR-0155): foreground `node <file>` streams
 * terminal I/O and forwards listening IPC; recursive execSync captures exact
 * stdout/stderr bytes. Physical project roots stay in bootstrap config.
 */
import {
  type KernelEntryCapabilityPorts,
  type ProcessTerminalEventSource,
  type SpawnWorkerSpec,
  globalProcessManager,
  observeProcessTerminalOutcome,
} from '@riftydev/kernel';
import { buildNodeEntryWorkerEntry } from '@riftydev/runtime-js/builtins/node-entry-url';
import type { InstallRuntimeJsExecSyncOptions } from '@riftydev/runtime-js/ipc/exec-sync-handler';
import type { CommandContext, ProcessExit } from '@riftydev/shell';
import { childTerminalBootstrap } from '../glue/child-terminal.ts';
import {
  type ForegroundListeningControl,
  type ForegroundWritable,
  runForegroundChild,
} from '../glue/run-foreground-child.ts';
import { toOwnerProjectPath } from '../workbench/project-file-boundary.ts';
import {
  type ReserveOwnerChildAdmission,
  abortOwnerChildAdmissionAfterSpawn,
  abortOwnerChildAdmissionBeforeSpawn,
  attachOwnerChildCapabilities,
  commitOwnerChildAdmission,
  observeOwnerChildExit,
} from './owner-child-admission.ts';

type OwnerExecSyncRunner = NonNullable<InstallRuntimeJsExecSyncOptions['runWorker']>;

interface NodeReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

interface OwnerExecSyncChild extends ProcessTerminalEventSource {
  readonly stdout: NodeReadable;
  readonly stderr: NodeReadable;
  /** Synchronous kernel teardown; returning certifies the worker is physically gone. */
  terminate(): void;
}

type OwnerExecSyncSpawn = (spec: SpawnWorkerSpec, parentPid: number) => OwnerExecSyncChild;

const spawnOwnerExecSyncChild: OwnerExecSyncSpawn = (spec, parentPid) => {
  const handle = globalProcessManager.spawnWorker('node', spec, parentPid, {
    cwd: spec.cwd,
  });
  if (handle.kind !== 'worker') {
    throw new Error('owner execSync runner expected a Worker process handle');
  }
  return {
    stdout: handle.stdout(),
    stderr: handle.stderr(),
    on(event, listener) {
      return handle.on(event, listener);
    },
    off(event, listener) {
      return handle.off(event, listener);
    },
    terminate() {
      handle.kill('SIGTERM');
    },
  };
};

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** Owner-realm recursive runner; active project root stays out of guest state. */
export function createOwnerExecSyncRunner(
  nodeEntryUrl: string,
  nodeWorkerRuntimeEnv: Readonly<Record<string, string>>,
  getActiveProjectRoot: () => string,
  reserveAdmission: ReserveOwnerChildAdmission,
  spawn: OwnerExecSyncSpawn = spawnOwnerExecSyncChild,
): OwnerExecSyncRunner {
  return async (spec, context) => {
    const remoteFsRoot = getActiveProjectRoot();
    const reservation = await reserveAdmission(toOwnerProjectPath(remoteFsRoot, spec.entryPath));
    let child: OwnerExecSyncChild;
    try {
      child = spawn(
        {
          entry: attachOwnerChildCapabilities(
            buildNodeEntryWorkerEntry(nodeEntryUrl, nodeWorkerRuntimeEnv, {
              kind: 'program',
              bin: false,
              remoteFs: true,
              remoteFsRoot,
              nodeServe: false,
            }),
            reservation.snapshot.capabilityPorts,
          ),
          argv: spec.argv,
          env: { ...spec.env },
          cwd: spec.cwd,
        },
        context?.parentPid ?? 1,
      );
    } catch (error) {
      abortOwnerChildAdmissionBeforeSpawn(reservation, error);
      throw error;
    }
    let resolvePhysicalExit = (): void => {};
    const physicalExit = new Promise<void>((resolve) => {
      resolvePhysicalExit = resolve;
    });
    let resolveResult!: (value: {
      readonly stdout: Uint8Array;
      readonly stderr: Uint8Array;
      readonly exitCode: number;
    }) => void;
    let rejectResult!: (error: Error) => void;
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = new Promise<{
      readonly stdout: Uint8Array;
      readonly stderr: Uint8Array;
      readonly exitCode: number;
    }>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    observeProcessTerminalOutcome(child, (outcome) => {
      resolvePhysicalExit();
      if (outcome.kind === 'peererror') {
        rejectResult(
          outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error)),
        );
        return;
      }
      queueMicrotask(() => {
        resolveResult({
          stdout: concatChunks(stdout),
          stderr: concatChunks(stderr),
          exitCode: typeof outcome.code === 'number' ? outcome.code : 1,
        });
      });
    });
    try {
      child.stdout.on('data', (chunk) => {
        if (chunk instanceof Uint8Array) stdout.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        if (chunk instanceof Uint8Array) stderr.push(chunk);
      });
      commitOwnerChildAdmission(reservation, physicalExit);
    } catch (error) {
      let failure = error;
      let termination: Promise<unknown>;
      try {
        child.terminate();
        termination = Promise.resolve();
      } catch (terminationError) {
        termination = physicalExit;
        failure = new AggregateError(
          [error, terminationError],
          'execSync child setup and termination failed',
        );
      }
      await abortOwnerChildAdmissionAfterSpawn(reservation, failure, termination);
      throw failure;
    }
    return result;
  };
}

export function buildNodeChildSpawnSpec(
  programEntry: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
  nodeEntryUrl: string,
  nodeWorkerRuntimeEnv: Readonly<Record<string, string>>,
  tty = false,
  cols = 80,
  rows = 24,
  previewScope?: string,
  remoteFsRoot?: string,
  capabilityPorts?: KernelEntryCapabilityPorts,
): SpawnWorkerSpec {
  const workerEntry = buildNodeEntryWorkerEntry(nodeEntryUrl, nodeWorkerRuntimeEnv, {
    kind: 'program',
    bin: false,
    remoteFs: true,
    ...(remoteFsRoot === undefined ? {} : { remoteFsRoot }),
    nodeServe: true,
    ...(previewScope === undefined ? {} : { previewScope }),
    terminal: childTerminalBootstrap({ isTTY: tty, cols, rows }),
  });
  return {
    entry:
      capabilityPorts === undefined
        ? workerEntry
        : attachOwnerChildCapabilities(workerEntry, capabilityPorts),
    argv: ['rifty', programEntry, ...args],
    // serve:true → kernel keeps it alive; the entry-scoped bootstrap owns the
    // run-vs-serve decision (ADR-0155) without changing observable guest env.
    env: { ...env },
    cwd,
    serve: true,
  };
}

export interface NodeChildHandle {
  readonly kind: string;
  stdout(): NodeReadable;
  stderr(): NodeReadable;
  stdin(): ForegroundWritable;
  on(event: 'exit', listener: (code?: unknown, signal?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  onListeningControl?: (listener: (control: ForegroundListeningControl) => void) => unknown;
  send(message: unknown): unknown;
  resize(cols: number, rows: number): unknown;
  kill(signal?: string): unknown;
}

export interface NodeRunHooks {
  /** Stable id for this run (registry key + label). */
  readonly sid: string;
  /** Owner-minted provenance bound to this launch, never guest env. */
  readonly previewScope?: string;
  /** Host-only physical root behind the child process's public `/` namespace. */
  readonly remoteFsRoot?: string;
  readonly onListening: (sid: string, pid: number, ports: number[], previewScope?: string) => void;
  readonly onExit: (sid: string) => void;
}
export type OwnerNodeExecutor = (
  entry: string,
  args: readonly string[],
  ctx: CommandContext,
  hooks: NodeRunHooks,
) => Promise<ProcessExit>;

export function createOwnerChildNodeExecutor(
  nodeEntryUrl: string,
  nodeWorkerRuntimeEnv: Readonly<Record<string, string>>,
  reserveAdmission: ReserveOwnerChildAdmission,
  spawn: (spec: SpawnWorkerSpec) => NodeChildHandle = (spec) => {
    const h = globalProcessManager.spawnWorker('node', spec, 1);
    if (h.kind !== 'worker')
      throw new Error(`owner-child-node-executor: expected worker, got ${h.kind}`);
    // After the kind guard TS narrows to WorkerProcessHandle, which structurally
    // satisfies NodeChildHandle: stdout()/stderr() are Readable; on(event,listener)
    // (wide EventEmitter sig) covers the narrowed 'exit'/'message' overloads;
    // send()/kill() return values are assignable to `unknown`. No cast needed
    // (mirrors owner-child-bin-executor).
    return h;
  },
): OwnerNodeExecutor {
  // `async` so a synchronous `spawn` throw (the kind guard / host-boundary
  // failure) surfaces as a rejected promise, not a sync throw. The spawn + the
  // shared driver's listener registration run before the first suspension.
  return async (entry, args, ctx, hooks) => {
    const reservation = await reserveAdmission(entry);
    let handle: NodeChildHandle;
    try {
      handle = spawn(
        buildNodeChildSpawnSpec(
          entry,
          args,
          ctx.env,
          ctx.cwd,
          nodeEntryUrl,
          nodeWorkerRuntimeEnv,
          ctx.isTTY === true,
          ctx.cols ?? 80,
          ctx.rows ?? 24,
          hooks.previewScope,
          hooks.remoteFsRoot,
          reservation.snapshot.capabilityPorts,
        ),
      );
    } catch (error) {
      abortOwnerChildAdmissionBeforeSpawn(reservation, error);
      throw error;
    }
    const physicalExit = observeOwnerChildExit(handle);
    // Shared foreground driver owns stream/abort/exit plus private listening
    // control; preview removal remains ordered before the run settles.
    let running: Promise<ProcessExit>;
    try {
      running = runForegroundChild(handle, ctx, {
        onListening: (control) =>
          hooks.onListening(hooks.sid, control.pid, control.ports, control.previewScope),
        onExit: () => hooks.onExit(hooks.sid),
      });
      commitOwnerChildAdmission(reservation, physicalExit);
    } catch (error) {
      try {
        handle.kill('SIGTERM');
      } catch {
        // Exact physical exit observation below remains authoritative.
      }
      await abortOwnerChildAdmissionAfterSpawn(reservation, error, physicalExit);
      throw error;
    }
    return running;
  };
}
