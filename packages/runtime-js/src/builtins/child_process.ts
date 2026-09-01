/**
 * Node-compatible `node:child_process` (subset).
 *
 * Backed by the kernel `ProcessManager` per ADR-0012 — `pid`, `exitCode`,
 * `signalCode`, and the per-process `cwd` are owned by the `ProcessHandle`
 * returned from `globalProcessManager.spawn(...)`. We don't actually spawn an
 * OS process (this is a browser runtime); "spawning a node script" runs the
 * script's source through our loader inside a logical child process tracked
 * by the manager. The script-eval helper lives in `./child_process-exec.ts`.
 *
 * The synchronous behavior (`execSync`) stays in-realm; actual SAB-Atomics
 * sync IPC is ADR-0011's scope.
 *
 * The runtime intentionally does not implement `spawn('bash', …)` — there is
 * no shell. `spawn('node', [script])` runs `script` through our loader.
 */

import { EventEmitter, NotImplementedError, Readable, type Writable } from '@riftydev/io';
import {
  type ProcessHandle,
  type ProcessIO,
  formatProcessSnapshot,
  getKernelDispatcher,
  getKernelWorkerUrl,
  globalProcessManager,
  isSabIpcSupported,
  readRootProcessSnapshot,
} from '@riftydev/kernel';
import { ref as refEventLoop, unref as unrefEventLoop } from '../internal/event-loop-keepalive.ts';
import { buildChildExecutionPlan } from '../internal/node-entry-path.ts';
import { nodeIpcChannel } from '../internal/node-ipc-channel.ts';
import { serializeNodeIpcMessage } from '../internal/node-ipc-serialization.ts';
import { installRuntimeJsExecSyncHandler } from '../ipc/handlers.ts';
import { SameRealmStdinPipe, execScript } from './child_process-exec.ts';
import {
  type BufferedExecutionCallback,
  type BufferedExecutionOutput,
  collectChildProcessOutput,
  normalizeBufferedExecutionOptions,
} from './child_process-output.ts';
import { execSync } from './child_process-sync.ts';
import {
  type SpawnStdio,
  activeChildProcessContext,
  activeProcessStdio,
  forwardWorkerStdio,
  resolveWorkerStdio,
  spawnWorkerChild,
} from './child_process-worker.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { nodeChildSpawnOptions } from './node-entry-runtime-config.ts';
import { getNodeEntryWorkerUrl } from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';

// ADR-0011 phase 3 / ADR-0039: the runtime-js `'execSync'` handler. Kernel ships
// no default handlers after ADR-0039 — execSync is Node-API knowledge and lives
// here. Resolver reads from the VFS sync mirror so the SAB path and in-realm
// fallback share one source of truth; `null` for a missing script lets the
// handler surface a proper `ENOENT`.
//
// #26 PART B (perf): install is deferred out of the module body into a function
// invoked by the `child_process` builtin factory (builtins/index.ts), so cold
// start does no `getKernelDispatcher()` / `register` / runner-alloc work for
// programs that never require child_process. Safe because execSync (the only
// dispatch site, child_process-sync.ts) is reachable ONLY via this module's
// exports, so first-require install always precedes any execSync() call. Runs
// once because `loadBuiltin` caches the factory result; if the builtin is
// re-registered against a fresh dispatcher it reinstalls there — `register` is
// idempotent (replaces), preserving the old "install when the module comes up".

/** Install the runtime-js `'execSync'` handler on the current kernel dispatcher
 * (idempotent; #26 PART B — called by the child_process builtin factory). */
export function ensureExecSyncHandlerInstalled(): void {
  installRuntimeJsExecSyncHandler(getKernelDispatcher(), (path) => {
    const mirror = syncMirror();
    if (!mirror.existsSync(path)) return null;
    return mirror.readFileBytesSync(path);
  });
}

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdio?: SpawnStdio;
  silent?: boolean;
  serialization?: 'json' | 'advanced';
  /** Internal flag set by `fork()` to enable IPC. */
  __fork?: boolean;
}

interface ExecOptions extends SpawnOptions {
  encoding?: string | null;
  killSignal?: number | string;
  maxBuffer?: number;
  timeout?: number;
}

interface ExecFileOptions extends ExecOptions {
  argv0?: string;
  gid?: number;
  shell?: boolean | string;
  signal?: AbortSignal;
  uid?: number;
  windowsHide?: boolean;
  windowsVerbatimArguments?: boolean;
}

class ChildProcess extends EventEmitter {
  /** Allocated by `ProcessManager` — PID space is unified across the runtime. */
  readonly pid: number;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: Writable;
  readonly stdio: readonly (Readable | Writable | null)[];
  killed = false;
  connected = false;
  declare channel?: ReturnType<typeof nodeIpcChannel> | null;
  declare send?: (message: unknown, ...unsupported: unknown[]) => boolean;
  declare disconnect?: () => void;
  private readonly handle: ProcessHandle;
  private readonly ownerProcess: unknown;
  private readonly ownerBootstrap: ReturnType<typeof readActiveNodeProcessBootstrap>;
  #keepaliveHeld = true;
  /** Bus the child's script subscribes to for parent-sent `'childMessage'`
   * events. Exposed to the spawner via `internalIpc()`. */
  readonly inboundIpc: EventEmitter = new EventEmitter();

  constructor(
    handle: ProcessHandle,
    ipcEnabled: boolean,
    streams: {
      readonly stdout: Readable;
      readonly stderr: Readable;
      readonly stdin: Writable;
      readonly expose: readonly [boolean, boolean, boolean];
      readonly slots: number;
    },
  ) {
    super();
    this.handle = handle;
    this.ownerProcess = (globalThis as { process?: unknown }).process;
    this.ownerBootstrap = readActiveNodeProcessBootstrap();
    this.pid = handle.pid;
    this.stdin = (streams.expose[0] ? streams.stdin : null) as unknown as Writable;
    this.stdout = (streams.expose[1] ? streams.stdout : null) as unknown as Readable;
    this.stderr = (streams.expose[2] ? streams.stderr : null) as unknown as Readable;
    const stdio: (Readable | Writable | null)[] = [this.stdin, this.stdout, this.stderr];
    while (stdio.length < streams.slots) stdio.push(null);
    this.stdio = stdio;
    refEventLoop();
    handle.on('exit', (code, signal) => {
      this.finishIpc();
      this.emitToOwner('exit', code, signal);
    });
    handle.on('close', (code, signal) => {
      this.#releaseKeepalive();
      if (!streams.stdout._readableState.ended) streams.stdout.push(null);
      if (!streams.stderr._readableState.ended) streams.stderr.push(null);
      if (handle.kind === 'same-realm') {
        queueMicrotask(() => this.emitToOwner('close', code, signal));
      } else {
        this.emitToOwner('close', code, signal);
      }
    });
    handle.on('peererror', (error) => {
      this.emitToOwner('error', error instanceof Error ? error : new Error(String(error)));
    });
    if (ipcEnabled) {
      this.connected = true;
      this.channel = nodeIpcChannel('child_process');
      this.send = (message: unknown, ...unsupported: unknown[]): boolean => {
        if (unsupported.length > 0) {
          throw new NotImplementedError('child_process.send.arguments');
        }
        if (!this.connected) return false;
        const serialized = serializeNodeIpcMessage(message);
        if (handle.kind === 'worker') return handle.send(serialized);
        queueMicrotask(() => this.inboundIpc.emit('childMessage', serialized));
        return true;
      };
      this.disconnect = (): void => {
        if (!this.connected) return;
        if (handle.kind === 'worker') handle.disconnect();
        this.finishIpc();
      };
      if (handle.kind === 'worker') {
        handle.on('message', (message) => {
          this.emitToOwner('message', serializeNodeIpcMessage(message));
        });
        handle.on('disconnect', () => this.finishIpc());
      }
    }
  }

  private finishIpc(): void {
    if (!this.connected) return;
    this.connected = false;
    this.channel = null;
    this.emitToOwner('disconnect');
  }

  private emitToOwner(event: string, ...args: unknown[]): boolean {
    const realm = globalThis as { process?: unknown };
    const previous = realm.process;
    const previousBootstrap = readActiveNodeProcessBootstrap();
    realm.process = this.ownerProcess;
    setActiveNodeProcessBootstrap(
      this.ownerBootstrap?.process ?? null,
      this.ownerBootstrap?.federated ?? false,
    );
    try {
      return super.emit(event, ...args);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'RIFTY_PROCESS_EXIT'
      ) {
        return true;
      }
      throw error;
    } finally {
      setActiveNodeProcessBootstrap(
        previousBootstrap?.process ?? null,
        previousBootstrap?.federated ?? false,
      );
      realm.process = previous;
    }
  }

  #releaseKeepalive(): void {
    if (!this.#keepaliveHeld) return;
    this.#keepaliveHeld = false;
    unrefEventLoop();
  }

  get exitCode(): number | null {
    return this.handle.exitCode;
  }
  get signalCode(): string | null {
    return this.handle.signalCode;
  }
  /** Per-ADR-0019: cwd is owned by the kernel record. */
  get cwd(): string {
    return this.handle.cwd;
  }

  kill(signal = 'SIGTERM'): boolean {
    if (this.handle.exitCode !== null || this.handle.signalCode !== null) return false;
    this.killed = true;
    if (this.handle.kind === 'same-realm') {
      queueMicrotask(() => {
        if (signal === 'SIGUSR2' && this.inboundIpc.emit('signal', signal)) return;
        this.handle.kill(signal);
      });
      return true;
    }
    return this.handle.kill(signal);
  }
}

/**
 * Runs a JS source file through our module loader as a "child". Recognised
 * command: `'node'` with `args[0]` a VFS script path; any other command emits
 * an error next tick (matches Node's missing-executable behaviour).
 *
 * Kernel allocates the PID and tracks lifecycle; `execScript` drives eval inside
 * the spawn handler. To honour non-{0,1} exit codes (ENOENT-127,
 * `process.exit(N)`) the helper mutates the handle's `exitCode` before returning
 * — `ProcessManager` only sets `exitCode` if still `null` at handler completion.
 */
/**
 * A spawn whose `cwd` cannot be entered never produces a process: Node reports
 * it asynchronously on the returned object (no pid, `'error'` then `'close'`
 * with the negative errno) rather than throwing. Running the entry from a
 * normalized-but-absent directory instead would let a tool with a mistyped or
 * computed cwd read and write the wrong files while reporting success.
 */
function failedSpawn(cwd: string, code: 'ENOENT' | 'ENOTDIR', errno: number): ChildProcess {
  const ended = (): Readable => {
    const stream = new Readable({ read() {} });
    stream.push(null);
    return stream;
  };
  const stdout = ended();
  const stderr = ended();
  const child = Object.assign(new EventEmitter(), {
    // Node leaves `pid` undefined when the process never existed.
    pid: undefined,
    stdin: null,
    stdout,
    stderr,
    stdio: [null, stdout, stderr],
    killed: false,
    connected: false,
    kill: () => false,
  }) as unknown as ChildProcess;
  const error = Object.assign(new Error(`spawn ${code}`), {
    code,
    errno,
    syscall: 'spawn',
    path: cwd,
  });
  queueMicrotask(() => {
    child.emit('error', error);
    child.emit('close', errno, null);
  });
  return child;
}

/** `null` when the child may run; the Node failure otherwise. */
function rejectedChildCwd(cwd: string): ChildProcess | null {
  const stat = syncMirror().statSyncOrNull(cwd);
  if (stat === null) return failedSpawn(cwd, 'ENOENT', -2);
  if (!stat.isDirectory) return failedSpawn(cwd, 'ENOTDIR', -20);
  return null;
}

export function spawn(command: string, args: string[] = [], opts: SpawnOptions = {}): ChildProcess {
  if (opts.serialization === 'advanced') {
    throw new NotImplementedError(
      'child_process.serialization.advanced',
      "Node's advanced IPC serializer is not implemented; use default JSON",
    );
  }
  const stdio = resolveWorkerStdio(
    opts.stdio,
    activeProcessStdio(),
    opts.__fork === true,
    opts.silent === true,
  );
  if (opts.cwd !== undefined) {
    // Only an explicitly requested directory is checked: an inherited cwd is
    // where the parent already runs, and Node does not re-validate it either.
    const requested = buildChildExecutionPlan(activeChildProcessContext().cwd, opts.cwd).cwd;
    const rejected = rejectedChildCwd(requested);
    if (rejected !== null) return rejected;
  }
  const workerRoute =
    command === 'node' &&
    args[0] !== undefined &&
    isSabIpcSupported() &&
    getKernelWorkerUrl() !== null &&
    getNodeEntryWorkerUrl() !== null;
  if (workerRoute) {
    const handle = spawnWorkerChild(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      fork: opts.__fork === true,
    });
    if (handle.kind !== 'worker') throw new Error('child_process.spawn: expected Worker handle');
    const child = new ChildProcess(handle, stdio.ipc, {
      stdin: handle.stdin(),
      stdout: handle.stdout(),
      stderr: handle.stderr(),
      expose: stdio.expose,
      slots: stdio.slots,
    });
    forwardWorkerStdio(handle, stdio);
    return child;
  }
  return spawnViaSameRealm(command, args, opts, stdio);
}

function spawnViaSameRealm(
  command: string,
  args: string[],
  opts: SpawnOptions,
  stdio: ReturnType<typeof resolveWorkerStdio>,
): ChildProcess {
  warnSameRealmFallbackOnce();
  // The handler needs the `ProcessHandle` and `ChildProcess`, both built AFTER
  // it's registered. A mutable container lets the handler read them on the next
  // microtask without an extra `await` boundary, which would delay the script
  // body past what existing IPC tests rely on.
  const wiring: { handle?: ProcessHandle; child?: ChildProcess } = {};
  const stdout = new Readable({ objectMode: false, read() {} });
  const stderr = new Readable({ objectMode: false, read() {} });
  const stdinPipe = new SameRealmStdinPipe();
  const stdin = stdinPipe.writable;
  const parent = activeChildProcessContext();
  const execution = buildChildExecutionPlan(
    parent.cwd,
    opts.cwd,
    command === 'node' ? args[0] : undefined,
  );
  const resolvedArgs =
    execution.entryPath === undefined ? args : [execution.entryPath, ...args.slice(1)];

  const handle = globalProcessManager.spawn(
    command,
    async (io: ProcessIO) => {
      const ownHandle = wiring.handle;
      const child = wiring.child;
      if (!ownHandle || !child) {
        throw new Error('child_process.spawn: wiring not populated before handler ran');
      }
      if (command === 'ps') {
        stdout.push(renderPs(args));
        return;
      }
      if (command === 'kill') {
        runKill(args);
        return;
      }
      await execScript({
        command,
        args: resolvedArgs,
        opts: { ...opts, cwd: execution.cwd, env: opts.env ?? parent.env },
        io,
        ownHandle,
        inboundIpc: child.inboundIpc,
        stdoutPush: (chunk) => stdout.push(chunk),
        stderrPush: (chunk) => stderr.push(chunk),
        outboundMessages: child,
        stdinPipe,
        federated: parent.federated,
      });
    },
    parent.pid,
    nodeChildSpawnOptions(execution.cwd, parent.federated),
  );

  wiring.handle = handle;
  handle.on('stdout', (chunk) => stdout.push(chunk));
  handle.on('stderr', (chunk) => stderr.push(chunk));
  const child = new ChildProcess(handle, stdio.ipc, {
    stdin,
    stdout,
    stderr,
    expose: stdio.expose,
    slots: stdio.slots,
  });
  wiring.child = child;
  if (stdio.stdout) {
    stdout.on('data', (chunk) => stdio.stdout?.write(chunk));
  }
  if (stdio.stderr) {
    stderr.on('data', (chunk) => stdio.stderr?.write(chunk));
  }
  return child;
}

let sameRealmWarningFired = false;

function warnSameRealmFallbackOnce(): void {
  if (globalThis.crossOriginIsolated !== false || sameRealmWarningFired) return;
  sameRealmWarningFired = true;
  console.warn(
    '[rifty:child_process] Falling back to same-realm execution: child shares the parent event loop.',
  );
}

function renderPs(args: readonly string[]): string {
  const output = formatProcessSnapshot(args, readRootProcessSnapshot());
  if (output !== null) return output;
  throw new NotImplementedError('child_process.ps', `unsupported ps form: ps ${args.join(' ')}`);
}

function runKill(args: readonly string[]): void {
  if (args.length !== 2 || args[0] !== '-USR2' || !/^[1-9]\d*$/u.test(args[1] ?? '')) {
    throw new NotImplementedError(
      'child_process.kill',
      `unsupported kill form: kill ${args.join(' ')}`,
    );
  }
  if (!globalProcessManager.kill(Number(args[1]), 'SIGUSR2')) {
    throw Object.assign(new Error(`kill: (${String(args[1])}) - No such process`), {
      code: 'ESRCH',
    });
  }
}

export function exec(
  cmd: string,
  optsOrCb?: ExecOptions | BufferedExecutionCallback,
  cb?: BufferedExecutionCallback,
): ChildProcess {
  const opts: ExecOptions = typeof optsOrCb === 'function' ? {} : (optsOrCb ?? {});
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) ?? (() => {});
  const buffered = normalizeBufferedExecutionOptions(opts);

  const tokens = cmd.split(/\s+/).filter(Boolean);
  const cmdName = tokens[0] ?? '';
  const child = spawn(cmdName, tokens.slice(1), opts);
  collectChildProcessOutput(child, cmd, [], buffered, cbFinal);
  return child;
}

export function execFile(
  file: string,
  argsOrOptions?: string[] | ExecFileOptions | BufferedExecutionCallback | null,
  optionsOrCallback?: ExecFileOptions | BufferedExecutionCallback | null,
  callback?: BufferedExecutionCallback | null,
): ChildProcess {
  validateExecFileString(file, 'file');
  if (file.length === 0) {
    throw Object.assign(new TypeError("The argument 'file' cannot be empty. Received ''"), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  }

  const normalized = normalizeExecFileArguments(argsOrOptions, optionsOrCallback, callback);
  for (let index = 0; index < normalized.args.length; index++) {
    validateExecFileString(normalized.args[index], `args[${index}]`);
  }
  validateExecFilePlatformOptions(normalized.options);
  const buffered = normalizeBufferedExecutionOptions(normalized.options);
  const child = spawn(file, normalized.args, {
    cwd: normalized.options.cwd ?? undefined,
    env: normalized.options.env ?? undefined,
  });
  collectChildProcessOutput(
    child,
    file,
    normalized.args,
    buffered,
    normalized.callback ?? undefined,
  );
  return child;
}

function normalizeExecFileArguments(
  argsOrOptions: string[] | ExecFileOptions | BufferedExecutionCallback | null | undefined,
  optionsOrCallback: ExecFileOptions | BufferedExecutionCallback | null | undefined,
  callback: BufferedExecutionCallback | null | undefined,
): {
  readonly args: string[];
  readonly options: ExecFileOptions;
  readonly callback: BufferedExecutionCallback | null | undefined;
} {
  let args: string[] = [];
  let options: ExecFileOptions = {};
  let resolvedCallback = callback;

  if (Array.isArray(argsOrOptions)) {
    args = [...argsOrOptions];
    if (typeof optionsOrCallback === 'function') resolvedCallback = optionsOrCallback;
    else if (optionsOrCallback !== null && optionsOrCallback !== undefined) {
      validateExecFileOptions(optionsOrCallback);
      options = optionsOrCallback;
    }
  } else if (typeof argsOrOptions === 'function') {
    resolvedCallback = argsOrOptions;
  } else if (argsOrOptions !== null && argsOrOptions !== undefined) {
    if (typeof argsOrOptions !== 'object') {
      throw nodeExecFileTypeError('args', 'object', argsOrOptions);
    }
    validateExecFileOptions(argsOrOptions);
    options = argsOrOptions;
    resolvedCallback =
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : (optionsOrCallback as BufferedExecutionCallback | null | undefined);
  } else if (typeof optionsOrCallback === 'function') {
    resolvedCallback = optionsOrCallback;
  } else if (optionsOrCallback !== null && optionsOrCallback !== undefined) {
    validateExecFileOptions(optionsOrCallback);
    options = optionsOrCallback;
  }

  if (resolvedCallback !== null && resolvedCallback !== undefined) {
    if (typeof resolvedCallback !== 'function') {
      throw nodeExecFileTypeError('callback', 'function', resolvedCallback);
    }
  }
  return { args, options, callback: resolvedCallback };
}

function validateExecFileOptions(value: unknown): asserts value is ExecFileOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw nodeExecFileTypeError('options', 'object', value);
  }
}

function validateExecFileString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw nodeExecFileTypeError(name, 'string', value);
  if (value.includes('\0')) {
    throw Object.assign(
      new TypeError(`The argument '${name}' must be a string without null bytes`),
      {
        code: 'ERR_INVALID_ARG_VALUE',
      },
    );
  }
}

function validateExecFilePlatformOptions(options: ExecFileOptions): void {
  if (options.cwd !== undefined && options.cwd !== null && typeof options.cwd !== 'string') {
    throw nodeExecFileTypeError('options.cwd', 'string', options.cwd);
  }
  if (options.env !== undefined && options.env !== null && typeof options.env !== 'object') {
    throw nodeExecFileTypeError('options.env', 'object', options.env);
  }
  if (options.shell != null && options.shell !== false) {
    throw new NotImplementedError('child_process.execFile.shell');
  }
  for (const [name, value] of [
    ['argv0', options.argv0],
    ['gid', options.gid],
    ['uid', options.uid],
  ] as const) {
    if (value != null) throw new NotImplementedError(`child_process.execFile.${name}`);
  }
  if (options.signal === null) {
    throw nodeExecFileTypeError('options.signal', 'AbortSignal', options.signal);
  }
  if (options.signal !== undefined) {
    throw new NotImplementedError('child_process.execFile.signal');
  }
}

function nodeExecFileTypeError(name: string, expected: string, value: unknown): TypeError {
  return Object.assign(
    new TypeError(
      `The "${name}" argument must be of type ${expected}. Received type ${typeof value}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');
type ExecFilePromiseResult = {
  readonly stdout: BufferedExecutionOutput;
  readonly stderr: BufferedExecutionOutput;
};
type ExecFilePromise = Promise<ExecFilePromiseResult> & { child: ChildProcess };

const promisifiedExecFile = (...args: unknown[]): ExecFilePromise => {
  let resolvePromise!: (value: ExecFilePromiseResult) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<ExecFilePromiseResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  }) as ExecFilePromise;
  const invoke = execFile as unknown as (...invokeArgs: unknown[]) => ChildProcess;
  promise.child = invoke(
    ...args,
    (error: Error | null, stdout: BufferedExecutionOutput, stderr: BufferedExecutionOutput) => {
      if (error !== null) {
        Object.assign(error, { stdout, stderr });
        rejectPromise(error);
        return;
      }
      resolvePromise({ stdout, stderr });
    },
  );
  return promise;
};

Object.defineProperty(promisifiedExecFile, 'name', { value: 'execFile' });
Object.defineProperty(execFile, PROMISIFY_CUSTOM, {
  enumerable: false,
  value: promisifiedExecFile,
});

export function fork(
  modulePath: string,
  args: string[] = [],
  opts: SpawnOptions = {},
): ChildProcess {
  return spawn('node', [modulePath, ...args], { ...opts, __fork: true });
}

// `execSync` lives in `./child_process-sync.ts` to keep the SAB-vs-fallback
// branch with its helpers. Re-exported here for the public `child_process`
// surface.
export { execSync };

export const ChildProcess_ = ChildProcess;

const child_process = { spawn, exec, execFile, fork, execSync, ChildProcess: ChildProcess_ };
export default child_process;
