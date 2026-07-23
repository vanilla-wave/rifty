/**
 * Owner-realm Node worker launchers (ADR-0155): foreground `node <file>` streams
 * terminal I/O and forwards listening IPC; recursive execSync captures exact
 * stdout/stderr bytes. Physical project roots stay in bootstrap config.
 */
import {
  type SpawnWorkerIdentity,
  type SpawnWorkerSpec,
  globalProcessManager,
  spawnKernelWorker,
} from '@riftydev/kernel';
import { buildNodeEntryWorkerEntry } from '@riftydev/runtime-js/builtins/node-entry-url';
import type { InstallRuntimeJsExecSyncOptions } from '@riftydev/runtime-js/ipc/exec-sync-handler';
import type { CommandContext, ProcessExit } from '@riftydev/shell';
import { childTerminalBootstrap } from '../glue/child-terminal.ts';
import { isNodeChildMessage } from '../glue/node-child-ipc.ts';
import { type ForegroundWritable, runForegroundChild } from '../glue/run-foreground-child.ts';

type OwnerExecSyncRunner = NonNullable<InstallRuntimeJsExecSyncOptions['runWorker']>;

interface OwnerExecSyncPort {
  onmessage: ((event: MessageEvent) => void) | null;
  start(): void;
}

interface OwnerExecSyncChild {
  readonly ports: {
    readonly stdout: OwnerExecSyncPort;
    readonly stderr: OwnerExecSyncPort;
  };
  onExit(listener: (code: number) => void): () => void;
}

type OwnerExecSyncSpawn = (
  spec: SpawnWorkerSpec,
  identity: SpawnWorkerIdentity,
) => OwnerExecSyncChild;

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
  spawn: OwnerExecSyncSpawn = spawnKernelWorker,
): OwnerExecSyncRunner {
  let nextNestedPid = 0xc0000000;
  return (spec) => {
    const remoteFsRoot = getActiveProjectRoot();
    const child = spawn(
      {
        entry: buildNodeEntryWorkerEntry(nodeEntryUrl, nodeWorkerRuntimeEnv, {
          kind: 'program',
          bin: false,
          remoteFs: true,
          remoteFsRoot,
          nodeServe: false,
        }),
        argv: spec.argv,
        env: { ...spec.env },
        cwd: spec.cwd,
      },
      { pid: nextNestedPid++, ppid: 1 },
    );
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.ports.stdout.onmessage = (event) => {
      if (event.data instanceof Uint8Array) stdout.push(event.data);
    };
    child.ports.stderr.onmessage = (event) => {
      if (event.data instanceof Uint8Array) stderr.push(event.data);
    };
    child.ports.stdout.start();
    child.ports.stderr.start();
    return new Promise((resolve) => {
      child.onExit((exitCode) => {
        queueMicrotask(() => {
          resolve({
            stdout: concatChunks(stdout),
            stderr: concatChunks(stderr),
            exitCode,
          });
        });
      });
    });
  };
}

export function buildNodeChildSpawnSpec(
  entry: string,
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
): SpawnWorkerSpec {
  return {
    entry: buildNodeEntryWorkerEntry(nodeEntryUrl, nodeWorkerRuntimeEnv, {
      kind: 'program',
      bin: false,
      remoteFs: true,
      ...(remoteFsRoot === undefined ? {} : { remoteFsRoot }),
      nodeServe: true,
      ...(previewScope === undefined ? {} : { previewScope }),
      terminal: childTerminalBootstrap({ isTTY: tty, cols, rows }),
    }),
    argv: ['rifty', entry, ...args],
    // serve:true → kernel keeps it alive; the entry-scoped bootstrap owns the
    // run-vs-serve decision (ADR-0155) without changing observable guest env.
    env: { ...env },
    cwd,
    serve: true,
  };
}

interface NodeReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}
export interface NodeChildHandle {
  readonly kind: string;
  stdout(): NodeReadable;
  stderr(): NodeReadable;
  stdin(): ForegroundWritable;
  on(event: 'exit', listener: (code?: unknown, signal?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
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
  readonly onListening: (sid: string, ports: number[], previewScope?: string) => void;
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
    const handle = spawn(
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
      ),
    );
    // Shared foreground driver (stream/abort/exit). A server child posts
    // `rifty:node-listening` → register a preview slot; the slot is removed on
    // exit. (run-foreground-child owns the exit-before-pre-abort ordering.)
    return runForegroundChild(handle, ctx, {
      onMessage: (m) => {
        if (isNodeChildMessage(m)) hooks.onListening(hooks.sid, m.ports, m.previewScope);
      },
      onExit: () => hooks.onExit(hooks.sid),
    });
  };
}
