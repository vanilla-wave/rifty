/** Validated Worker launch and stdio plan shared by child_process adapters. */

import { NotImplementedError, type Readable } from '@riftydev/io';
import { type ProcessHandle, type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { dirname, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { buildChildExecutionPlan } from '../internal/node-entry-path.ts';
import { buildConfiguredNodeEntryWorkerEntry } from './node-entry-runtime-config.ts';
import { syncMirror } from './fs-sync-mirror.ts';

type Listener = (...args: unknown[]) => void;

export interface ReadableSource {
  on(event: string | symbol, listener: Listener): unknown;
  off?(event: string | symbol, listener: Listener): unknown;
  removeListener?(event: string | symbol, listener: Listener): unknown;
}

export interface WritableTarget {
  write(chunk: unknown): unknown;
  end?(): unknown;
}

export type SpawnStdioEntry = string | number | ReadableSource | WritableTarget | null | undefined;
export type SpawnStdio = string | readonly SpawnStdioEntry[];

export interface ParentStdio {
  readonly stdin?: ReadableSource;
  readonly stdout?: WritableTarget;
  readonly stderr?: WritableTarget;
}

export interface WorkerStdioPlan {
  readonly ipc: boolean;
  readonly expose: readonly [boolean, boolean, boolean];
  readonly slots: number;
  readonly stdin?: ReadableSource;
  readonly stdout?: WritableTarget;
  readonly stderr?: WritableTarget;
}

interface ActiveProcess {
  readonly pid?: unknown;
  readonly argv?: unknown;
  readonly cwd?: unknown;
  readonly env?: unknown;
  readonly stdin?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
}

export interface ActiveChildProcessContext {
  readonly pid: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly entryPath?: string;
}

function activeProcess(): ActiveProcess | undefined {
  const value = (globalThis as { process?: unknown }).process;
  return typeof value === 'object' && value !== null ? (value as ActiveProcess) : undefined;
}

function readable(value: unknown): ReadableSource | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
    return undefined;
  return typeof (value as { on?: unknown }).on === 'function'
    ? (value as ReadableSource)
    : undefined;
}

function writable(value: unknown): WritableTarget | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
    return undefined;
  return typeof (value as { write?: unknown }).write === 'function'
    ? (value as WritableTarget)
    : undefined;
}

function stringEnv(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

export function activeChildProcessContext(): ActiveChildProcessContext {
  const process = activeProcess();
  const cwd = typeof process?.cwd === 'function' ? process.cwd.call(process) : '/workspace';
  return {
    pid: typeof process?.pid === 'number' ? process.pid : 1,
    cwd: typeof cwd === 'string' ? cwd : '/workspace',
    env: stringEnv(process?.env),
    ...(Array.isArray(process?.argv) && typeof process.argv[1] === 'string'
      ? { entryPath: process.argv[1] }
      : {}),
  };
}

export function activeProcessStdio(): ParentStdio {
  const process = activeProcess();
  return {
    stdin: readable(process?.stdin),
    stdout: writable(process?.stdout),
    stderr: writable(process?.stderr),
  };
}

function invalidStdio(value: unknown, detail = ''): never {
  const error = new TypeError(
    `The argument 'stdio' is invalid${detail === '' ? '' : ` (${detail})`}. Received ${String(value)}`,
  );
  throw Object.assign(error, { code: 'ERR_INVALID_ARG_VALUE' });
}

function unsupportedStdio(value: unknown, fd?: number): never {
  throw new NotImplementedError(
    'child_process.spawn.stdio',
    `stdio mode ${String(value)}${fd === undefined ? '' : ` at fd ${fd}`} is valid in Node but is not wired`,
  );
}

function inheritedReadable(value: ReadableSource | undefined, fd: number): ReadableSource {
  if (value) return value;
  throw new NotImplementedError(
    'child_process.spawn.stdio.inherit',
    `cannot inherit fd ${fd}: current process has no readable stdin`,
  );
}

function inheritedWritable(value: WritableTarget | undefined, fd: number): WritableTarget {
  if (value) return value;
  throw new NotImplementedError(
    'child_process.spawn.stdio.inherit',
    `cannot inherit fd ${fd}: current process has no writable stream`,
  );
}

function input(
  entry: SpawnStdioEntry,
  inherited: ParentStdio,
): { expose: boolean; source?: ReadableSource } {
  if (entry == null || entry === 'pipe') return { expose: true };
  if (entry === 'inherit') return { expose: false, source: inheritedReadable(inherited.stdin, 0) };
  if (entry === 'ignore') return { expose: false };
  if (entry === 'ipc' || entry === 'overlapped' || typeof entry === 'number') {
    return unsupportedStdio(entry, 0);
  }
  if (typeof entry === 'string') return invalidStdio(entry, 'fd 0');
  const source = readable(entry);
  if (!source) return invalidStdio(entry, 'fd 0 requires a readable stream');
  return { expose: false, source };
}

function output(
  entry: SpawnStdioEntry,
  inherited: WritableTarget | undefined,
  fd: 1 | 2,
): { expose: boolean; target?: WritableTarget } {
  if (entry == null || entry === 'pipe') return { expose: true };
  if (entry === 'inherit') return { expose: false, target: inheritedWritable(inherited, fd) };
  if (entry === 'ignore') return { expose: false };
  if (entry === 'ipc' || entry === 'overlapped' || typeof entry === 'number') {
    return unsupportedStdio(entry, fd);
  }
  if (typeof entry === 'string') return invalidStdio(entry, `fd ${fd}`);
  const target = writable(entry);
  if (!target) return invalidStdio(entry, `fd ${fd} requires a writable stream`);
  return { expose: false, target };
}

function missingForkIpc(): never {
  const error = new TypeError(
    "Forked processes must have an IPC channel, missing value 'ipc' in options.stdio",
  );
  throw Object.assign(error, { code: 'ERR_CHILD_PROCESS_IPC_REQUIRED' });
}

/** Validate the complete stdio/IPC request before PID allocation. */
export function resolveWorkerStdio(
  stdio: SpawnStdio | undefined,
  inherited: ParentStdio,
  forkMode: boolean,
  silent: boolean,
): WorkerStdioPlan {
  if (stdio === undefined) {
    if (forkMode && !silent) {
      return {
        ipc: true,
        expose: [false, false, false],
        slots: 4,
        stdin: inheritedReadable(inherited.stdin, 0),
        stdout: inheritedWritable(inherited.stdout, 1),
        stderr: inheritedWritable(inherited.stderr, 2),
      };
    }
    return { ipc: forkMode, expose: [true, true, true], slots: forkMode ? 4 : 3 };
  }
  if (stdio === 'pipe') {
    return { ipc: forkMode, expose: [true, true, true], slots: forkMode ? 4 : 3 };
  }
  if (stdio === 'inherit') {
    return {
      ipc: forkMode,
      expose: [false, false, false],
      slots: forkMode ? 4 : 3,
      stdin: inheritedReadable(inherited.stdin, 0),
      stdout: inheritedWritable(inherited.stdout, 1),
      stderr: inheritedWritable(inherited.stderr, 2),
    };
  }
  if (stdio === 'ignore') {
    return {
      ipc: forkMode,
      expose: [false, false, false],
      slots: forkMode ? 4 : 3,
    };
  }
  if (!Array.isArray(stdio)) return unsupportedStdio(stdio);

  const inPlan = input(stdio[0], inherited);
  const outPlan = output(stdio[1], inherited.stdout, 1);
  const errPlan = output(stdio[2], inherited.stderr, 2);
  let ipc = false;
  for (let fd = 3; fd < stdio.length; fd += 1) {
    const entry = stdio[fd];
    if (entry == null) continue;
    if (entry === 'ipc') {
      if (!forkMode) unsupportedStdio(entry, fd);
      if (ipc) invalidStdio(entry, 'only one IPC pipe is allowed');
      ipc = true;
      continue;
    }
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      readable(entry) ||
      writable(entry)
    ) {
      unsupportedStdio(entry, fd);
    }
    invalidStdio(entry, `fd ${fd}`);
  }
  if (forkMode && !ipc) missingForkIpc();
  return {
    ipc,
    expose: [inPlan.expose, outPlan.expose, errPlan.expose],
    slots: Math.max(3, stdio.length),
    ...(inPlan.source === undefined ? {} : { stdin: inPlan.source }),
    ...(outPlan.target === undefined ? {} : { stdout: outPlan.target }),
    ...(errPlan.target === undefined ? {} : { stderr: errPlan.target }),
  };
}

function detach(source: ReadableSource, event: string, listener: Listener): void {
  if (source.off) source.off(event, listener);
  else source.removeListener?.(event, listener);
}

interface StdioHandle {
  stdout(): Readable;
  stderr(): Readable;
  stdin(): WritableTarget;
  once(event: string | symbol, listener: Listener): unknown;
}

function forward(
  source: ReadableSource,
  target: WritableTarget,
  handle: Pick<StdioHandle, 'once'>,
  endTarget: boolean,
): void {
  const onData: Listener = (chunk) => {
    target.write(chunk);
  };
  const onEnd: Listener = () => {
    if (endTarget) target.end?.();
  };
  const cleanup = (): void => {
    detach(source, 'data', onData);
    detach(source, 'end', onEnd);
  };
  source.on('data', onData);
  source.on('end', onEnd);
  handle.once('close', cleanup);
}

export function forwardWorkerStdio(handle: StdioHandle, plan: WorkerStdioPlan): void {
  if (plan.stdin) forward(plan.stdin, handle.stdin(), handle, true);
  if (plan.stdout) forward(handle.stdout(), plan.stdout, handle, false);
  if (plan.stderr) forward(handle.stderr(), plan.stderr, handle, false);
}

export interface SpawnWorkerChildOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly fork: boolean;
}

/** Translate a validated `node <script>` launch to one real remote-FS Worker. */
export function spawnWorkerChild(
  command: string,
  args: readonly string[],
  options: SpawnWorkerChildOptions,
): ProcessHandle {
  const parent = activeChildProcessContext();
  const plan = buildChildExecutionPlan(parent.cwd, options.cwd, args[0]);
  if (plan.entryPath === undefined) throw new Error('child_process.spawn: missing Node entry path');
  let entryPath = plan.entryPath;
  const requestedEntry = args[0];
  if (
    requestedEntry !== undefined &&
    !isAbsolute(requestedEntry) &&
    !syncMirror().existsSync(entryPath) &&
    parent.entryPath !== undefined &&
    isAbsolute(parent.entryPath)
  ) {
    // Workbench's public project namespace is mounted at `/` while the terminal
    // keeps its shell cwd (for example `/scratch`). The active entry identifies
    // that mount once; descendants keep the observable cwd but resolve a sibling
    // entry in the same public namespace.
    const mountedEntry = normalizePath(joinPath(dirname(parent.entryPath), requestedEntry));
    if (syncMirror().existsSync(mountedEntry)) entryPath = mountedEntry;
  }
  const entry = buildConfiguredNodeEntryWorkerEntry({
    kind: 'program',
    bin: false,
    remoteFs: true,
    ipc: options.fork ? 'json' : 'none',
    nodeServe: true,
  });
  const spec: SpawnWorkerSpec = {
    entry,
    argv: ['rifty', entryPath, ...args.slice(1)],
    env: options.env === undefined ? parent.env : { ...options.env },
    cwd: plan.cwd,
    serve: true,
  };
  return globalProcessManager.spawnWorker(command, spec, parent.pid, {
    cwd: plan.cwd,
    federated: true,
  });
}
