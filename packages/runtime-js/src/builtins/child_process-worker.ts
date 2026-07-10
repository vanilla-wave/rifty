/** Worker-backed `child_process.spawn/fork` over the parent's remote FS (ADR-0202). */

import { NotImplementedError, type Readable } from '@riftydev/io';
import { type ProcessHandle, type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { resolveNodeEntryPath } from '../internal/node-entry-path.ts';
import { getNodeEntryWorkerUrl } from './node-entry-url.ts';
import { riftyProcess } from './process.ts';

type StdioListener = (...args: unknown[]) => void;

export interface StdioReadableSource {
  on(event: string | symbol, listener: StdioListener): unknown;
  off?(event: string | symbol, listener: StdioListener): unknown;
  removeListener?(event: string | symbol, listener: StdioListener): unknown;
}

export interface StdioWritableTarget {
  write(chunk: unknown): unknown;
  end?(): unknown;
}

export type SpawnStdioEntry =
  | string
  | number
  | StdioReadableSource
  | StdioWritableTarget
  | null
  | undefined;
export type SpawnStdio = string | readonly SpawnStdioEntry[];

export interface SpawnWorkerArgs {
  readonly command: string;
  readonly args: readonly string[];
  readonly opts: {
    readonly cwd?: string;
    readonly env?: Record<string, string>;
    readonly __fork?: boolean;
    readonly stdio?: SpawnStdio;
  };
}

export interface ParentStdioTargets {
  readonly stdin?: StdioReadableSource;
  readonly stdout?: StdioWritableTarget;
  readonly stderr?: StdioWritableTarget;
}

export interface WorkerStdioPlan {
  readonly ipc: boolean;
  /** Public ChildProcess properties are non-null only for pipe destinations. */
  readonly expose: {
    readonly stdin: boolean;
    readonly stdout: boolean;
    readonly stderr: boolean;
  };
  readonly stdin?: StdioReadableSource;
  readonly stdout?: StdioWritableTarget;
  readonly stderr?: StdioWritableTarget;
}

interface WorkerStdioHandle {
  stdout(): Readable;
  stderr(): Readable;
  stdin(): StdioWritableTarget;
  once(event: string | symbol, listener: StdioListener): unknown;
}

export interface WorkerChildContext {
  readonly bootstrapUrl: string | URL;
  readonly parentCwd: string;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

export interface BuiltWorkerChildSpec {
  readonly cwd: string;
  readonly spec: SpawnWorkerSpec;
}

interface ActiveProcessShape {
  readonly pid?: unknown;
  readonly env?: unknown;
  readonly stdin?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly cwd?: unknown;
}

function activeProcess(): ActiveProcessShape | undefined {
  return (globalThis as unknown as { process?: ActiveProcessShape }).process ?? riftyProcess;
}

function asReadableSource(value: unknown): StdioReadableSource | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  return typeof (value as { on?: unknown }).on === 'function'
    ? (value as StdioReadableSource)
    : undefined;
}

function asWritableTarget(value: unknown): StdioWritableTarget | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  return typeof (value as { write?: unknown }).write === 'function'
    ? (value as StdioWritableTarget)
    : undefined;
}

/** Current realm's process streams, used for Node's `stdio: 'inherit'`. */
export function activeProcessStdio(): ParentStdioTargets {
  const process = activeProcess();
  return {
    stdin: asReadableSource(process?.stdin),
    stdout: asWritableTarget(process?.stdout),
    stderr: asWritableTarget(process?.stderr),
  };
}

function activePid(): number {
  const pid = activeProcess()?.pid;
  return typeof pid === 'number' ? pid : 1;
}

function activeCwd(): string {
  const process = activeProcess();
  const cwd = process?.cwd;
  if (typeof cwd !== 'function') return '/workspace';
  const value = cwd.call(process);
  return typeof value === 'string' ? value : '/workspace';
}

function stringEnv(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

function activeEnv(): Record<string, string> {
  return stringEnv(activeProcess()?.env);
}

function invalidStdio(value: unknown, detail = ''): never {
  const suffix = detail === '' ? '' : ` (${detail})`;
  const error = new TypeError(
    `The argument 'stdio' is invalid${suffix}. Received ${String(value)}`,
  );
  throw Object.assign(error, { code: 'ERR_INVALID_ARG_VALUE' });
}

function missingForkIpc(): never {
  const error = new TypeError(
    "Forked processes must have an IPC channel, missing value 'ipc' in options.stdio",
  );
  throw Object.assign(error, { code: 'ERR_CHILD_PROCESS_IPC_REQUIRED' });
}

function unsupportedStdio(value: unknown, fd?: number): never {
  const location = fd === undefined ? '' : ` at fd ${fd}`;
  throw new NotImplementedError(
    'child_process.spawn.stdio',
    `stdio mode ${String(value)}${location} is valid in Node but is not wired to a browser Worker`,
  );
}

function inheritedReadable(
  value: StdioReadableSource | undefined,
  fd: number,
): StdioReadableSource {
  if (value) return value;
  throw new NotImplementedError(
    'child_process.spawn.stdio.inherit',
    `cannot inherit fd ${fd}: the current process has no readable stdin`,
  );
}

function inheritedWritable(
  value: StdioWritableTarget | undefined,
  fd: number,
): StdioWritableTarget {
  if (value) return value;
  throw new NotImplementedError(
    'child_process.spawn.stdio.inherit',
    `cannot inherit fd ${fd}: the current process has no writable stream`,
  );
}

function resolveInput(
  entry: SpawnStdioEntry,
  inherited: ParentStdioTargets,
): StdioReadableSource | undefined {
  if (entry == null || entry === 'pipe') return undefined;
  if (entry === 'inherit') return inheritedReadable(inherited.stdin, 0);
  if (entry === 'ipc') return unsupportedStdio(entry, 0);
  if (entry === 'ignore' || entry === 'overlapped' || typeof entry === 'number') {
    return unsupportedStdio(entry, 0);
  }
  if (typeof entry === 'string') return invalidStdio(entry, 'fd 0');
  const source = asReadableSource(entry);
  if (source) return source;
  return invalidStdio(entry, 'fd 0 requires a readable stream');
}

function resolveOutput(
  entry: SpawnStdioEntry,
  inherited: StdioWritableTarget | undefined,
  fd: 1 | 2,
): StdioWritableTarget | undefined {
  if (entry == null || entry === 'pipe') return undefined;
  if (entry === 'inherit') return inheritedWritable(inherited, fd);
  if (entry === 'ipc') return unsupportedStdio(entry, fd);
  if (entry === 'ignore' || entry === 'overlapped' || typeof entry === 'number') {
    return unsupportedStdio(entry, fd);
  }
  if (typeof entry === 'string') return invalidStdio(entry, `fd ${fd}`);
  const target = asWritableTarget(entry);
  if (target) return target;
  return invalidStdio(entry, `fd ${fd} requires a writable stream`);
}

function isKnownExtraFdEntry(entry: SpawnStdioEntry): boolean {
  return (
    entry === 'pipe' ||
    entry === 'inherit' ||
    entry === 'ignore' ||
    entry === 'overlapped' ||
    typeof entry === 'number' ||
    asReadableSource(entry) !== undefined ||
    asWritableTarget(entry) !== undefined
  );
}

/** Validate stdio once, before spawning, and produce the forwarding plan. */
export function resolveWorkerStdio(
  stdio: SpawnStdio | undefined,
  inherited: ParentStdioTargets,
  forkMode: boolean,
  forkSilent = false,
): WorkerStdioPlan {
  if (stdio === undefined) {
    if (forkMode && !forkSilent) {
      return {
        ipc: true,
        expose: { stdin: false, stdout: false, stderr: false },
        stdin: inheritedReadable(inherited.stdin, 0),
        stdout: inheritedWritable(inherited.stdout, 1),
        stderr: inheritedWritable(inherited.stderr, 2),
      };
    }
    return { ipc: forkMode, expose: { stdin: true, stdout: true, stderr: true } };
  }
  if (stdio === 'pipe') {
    return { ipc: forkMode, expose: { stdin: true, stdout: true, stderr: true } };
  }
  if (stdio === 'inherit') {
    return {
      ipc: forkMode,
      expose: { stdin: false, stdout: false, stderr: false },
      stdin: inheritedReadable(inherited.stdin, 0),
      stdout: inheritedWritable(inherited.stdout, 1),
      stderr: inheritedWritable(inherited.stderr, 2),
    };
  }
  if (!Array.isArray(stdio)) {
    if (stdio === 'ignore' || stdio === 'overlapped') return unsupportedStdio(stdio);
    return invalidStdio(stdio);
  }

  const plan: {
    ipc: boolean;
    expose: { stdin: boolean; stdout: boolean; stderr: boolean };
    stdin?: StdioReadableSource;
    stdout?: StdioWritableTarget;
    stderr?: StdioWritableTarget;
  } = {
    ipc: false,
    expose: { stdin: true, stdout: true, stderr: true },
  };
  const stdin = resolveInput(stdio[0], inherited);
  const stdout = resolveOutput(stdio[1], inherited.stdout, 1);
  const stderr = resolveOutput(stdio[2], inherited.stderr, 2);
  if (stdin) {
    plan.stdin = stdin;
    plan.expose.stdin = false;
  }
  if (stdout) {
    plan.stdout = stdout;
    plan.expose.stdout = false;
  }
  if (stderr) {
    plan.stderr = stderr;
    plan.expose.stderr = false;
  }

  for (let fd = 3; fd < stdio.length; fd += 1) {
    const entry = stdio[fd];
    if (entry == null) continue;
    if (entry === 'ipc') {
      if (!forkMode) return unsupportedStdio(entry, fd);
      if (plan.ipc) return invalidStdio(entry, 'only one IPC pipe is allowed');
      plan.ipc = true;
      continue;
    }
    if (isKnownExtraFdEntry(entry)) return unsupportedStdio(entry, fd);
    return invalidStdio(entry, `fd ${fd}`);
  }
  if (forkMode && !plan.ipc) return missingForkIpc();
  return plan;
}

function detach(source: StdioReadableSource, event: string, listener: StdioListener): void {
  if (source.off) source.off(event, listener);
  else source.removeListener?.(event, listener);
}

function forwardReadable(
  source: StdioReadableSource,
  target: StdioWritableTarget,
  handle: Pick<WorkerStdioHandle, 'once'>,
  endTarget: boolean,
): void {
  const onData: StdioListener = (chunk) => {
    target.write(chunk);
  };
  const onEnd: StdioListener = () => {
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

/** Apply a prevalidated plan to the real Worker stdio streams. */
export function forwardChildOutputStdio(
  handle: Pick<WorkerStdioHandle, 'stdout' | 'stderr' | 'once'>,
  plan: WorkerStdioPlan,
): void {
  if (plan.stdout) forwardReadable(handle.stdout(), plan.stdout, handle, false);
  if (plan.stderr) forwardReadable(handle.stderr(), plan.stderr, handle, false);
}

/** Apply a prevalidated plan to the real Worker stdio streams. */
export function forwardWorkerStdio(handle: WorkerStdioHandle, plan: WorkerStdioPlan): void {
  if (plan.stdin) forwardReadable(plan.stdin, handle.stdin(), handle, true);
  forwardChildOutputStdio(handle, plan);
}

/** Pure translation from Node spawn args + parent snapshot to the Worker spec. */
export function buildWorkerChildSpec(
  args: SpawnWorkerArgs,
  context: WorkerChildContext,
): BuiltWorkerChildSpec {
  if (args.command !== 'node') {
    throw new Error(
      `buildWorkerChildSpec: only 'node' is supported; got ${args.command}. Non-node commands must stay on the in-realm fallback.`,
    );
  }
  const scriptPath = args.args[0];
  if (!scriptPath) throw new Error('buildWorkerChildSpec: missing script path (args[0])');

  const cwd = args.opts.cwd ?? context.parentCwd;
  const entryPath = resolveNodeEntryPath(cwd, scriptPath);
  const env = {
    ...(args.opts.env === undefined ? stringEnv(context.parentEnv) : args.opts.env),
    RIFTY_BIN: '0',
    RIFTY_NODE_SERVE: '1',
    RIFTY_REMOTE_FS: '1',
  };
  return {
    cwd,
    spec: {
      entry: { kind: 'url', url: String(context.bootstrapUrl) },
      argv: ['rifty', entryPath, ...args.args.slice(1)],
      env,
      cwd,
      capabilities: { stdin: 'forwarded', runtimeIpc: args.opts.__fork === true },
      serve: true,
    },
  };
}

/** Translate `node <script>` into a server-capable remote-FS Worker. */
export function spawnWorkerChild(args: SpawnWorkerArgs): ProcessHandle {
  const bootstrapUrl = getNodeEntryWorkerUrl();
  if (bootstrapUrl === null) {
    throw new Error(
      'spawnWorkerChild: node-entry worker URL not set — the host must call setNodeEntryWorkerUrl (ADR-0137)',
    );
  }
  const built = buildWorkerChildSpec(args, {
    bootstrapUrl,
    parentCwd: activeCwd(),
    parentEnv: activeEnv(),
  });
  return globalProcessManager.spawnWorker(args.command, built.spec, activePid(), {
    cwd: built.cwd,
  });
}
