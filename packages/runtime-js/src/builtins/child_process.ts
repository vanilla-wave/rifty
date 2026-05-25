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
 * Acceptance pieces for M6:
 *   - `spawn(cmd, args)` returns a ChildProcess with stdout/stderr/exit events.
 *   - `exec(cmd, cb)` buffers stdout/stderr.
 *   - `fork(modulePath)` adds IPC via `send`/`message`.
 *   - `execSync` synchronously runs and returns stdout.
 *
 * The runtime intentionally does not implement `spawn('bash', …)` — there is
 * no shell. `spawn('node', [script])` runs `script` through our loader.
 */

import { Buffer, EventEmitter, NotImplementedError, Readable } from '@rifty/io';
import {
  type ProcessHandle,
  type ProcessIO,
  getKernelWorkerUrl,
  globalProcessManager,
  isSabIpcSupported,
  setExecSyncScriptResolver,
} from '@rifty/kernel';
import { execScript } from './child_process-exec.ts';
import { execSync } from './child_process-sync.ts';
import { spawnWorkerChild } from './child_process-worker.ts';
import { syncMirror } from './fs-sync-mirror.ts';

// ADR-0011 phase 3: thread the runtime-js sync mirror into the kernel's
// default `execSync` handler. The kernel itself has no VFS dependency
// (vfs → kernel layering allows it, but we avoid coupling the kernel to
// a specific filesystem); the runtime-js layer is the natural place to
// own that wiring. Resolver returns `null` for missing scripts so the
// handler can surface a proper `ENOENT`.
setExecSyncScriptResolver((path) => {
  const mirror = syncMirror();
  if (!mirror.existsSync(path)) return null;
  return mirror.readFileBytesSync(path);
});

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Internal flag set by `fork()` to enable IPC. */
  __fork?: boolean;
}

interface ExecOptions extends SpawnOptions {
  encoding?: string;
  maxBuffer?: number;
}

class ChildProcess extends EventEmitter {
  /** Allocated by `ProcessManager` so PID space is unified across the runtime. */
  readonly pid: number;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: { write(chunk: unknown): never; end(): never };
  killed = false;
  private readonly ipcEnabled: boolean;
  private readonly handle: ProcessHandle;
  /** Bus the child's script subscribes to for `'childMessage'` events sent
   * by the parent. Exposed to the spawner via `internalIpc()`. */
  readonly inboundIpc: EventEmitter = new EventEmitter();

  constructor(
    handle: ProcessHandle,
    ipcEnabled: boolean,
    /** Optional pre-allocated stdio streams (used by the Worker-backed path
     * which writes into them itself so the parent can listen before the
     * worker's first `postMessage` lands). */
    streams?: { stdout?: Readable; stderr?: Readable },
  ) {
    super();
    this.handle = handle;
    this.pid = handle.pid;
    this.ipcEnabled = ipcEnabled;
    this.stdout = streams?.stdout ?? new Readable({ objectMode: false });
    this.stderr = streams?.stderr ?? new Readable({ objectMode: false });
    this.stdin = {
      write: (_chunk: unknown) => {
        throw new NotImplementedError(
          'child.stdin.write',
          'IPC stdin will land with the worker-as-process redesign — see ADR 0011',
        );
      },
      end: () => {
        throw new NotImplementedError(
          'child.stdin.end',
          'IPC stdin will land with the worker-as-process redesign — see ADR 0011',
        );
      },
    };
    // Surface kernel-tracked exit/close on the ChildProcess so existing
    // consumers (which `.on('close', …)`) keep working.
    handle.on('exit', (code, signal) => {
      this.emit('exit', code, signal);
    });
    handle.on('close', (code, signal) => {
      this.emit('close', code, signal);
    });
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

  /** Send IPC message to the child. */
  send(message: unknown): boolean {
    if (!this.ipcEnabled) return false;
    this.inboundIpc.emit('childMessage', message);
    return true;
  }

  kill(signal = 'SIGTERM'): boolean {
    if (this.handle.exitCode !== null) return false;
    this.killed = true;
    return this.handle.kill(signal);
  }
}

/**
 * `spawn` runs a JS source file through our module loader as a "child".
 * Recognised command: `'node'` with `args[0]` being a script path in the VFS.
 * Any other command emits an error after the next tick (matches Node's
 * behaviour for missing executables).
 *
 * The kernel allocates the PID and tracks lifecycle; we drive script eval
 * inside the spawn handler via `execScript`. To honour non-{0,1} exit codes
 * (ENOENT-127, `process.exit(N)`), the helper mutates the handle's
 * `exitCode` field directly before returning — the `ProcessManager` only
 * sets `exitCode` if it's still `null` at handler completion.
 */
export function spawn(command: string, args: string[] = [], opts: SpawnOptions = {}): ChildProcess {
  // ADR-0011 phase 2: when SAB IPC is supported AND the host has wired
  // `setKernelWorkerUrl`, run the child in a real Worker realm. We restrict
  // the SAB path to `node <script>` — non-`node` commands (ENOENT case) and
  // `node` invocations without a script stay on the in-realm fallback so
  // their existing error semantics are preserved (the worker can't model
  // "command not found").
  if (
    command === 'node' &&
    args[0] !== undefined &&
    isSabIpcSupported() &&
    getKernelWorkerUrl() !== null
  ) {
    return spawnViaWorker(command, args, opts);
  }
  // fallback per ADR-0011 — kernel ProcessManager.spawn with same-realm
  // handler. Stays available behind the capability gate for non-isolated
  // test environments and for non-`node` commands that need ENOENT.
  return spawnViaSameRealm(command, args, opts);
}

function spawnViaWorker(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  const stdout = new Readable({ objectMode: false });
  const stderr = new Readable({ objectMode: false });
  // Use placeholder buses; spawnWorkerChild ignores them for now and
  // phase 3 will wire fork-mode IPC into worker-entry.
  const outbound = new EventEmitter();
  const inboundIpc = new EventEmitter();
  const handle = spawnWorkerChild({
    command,
    args,
    opts,
    stdout,
    stderr,
    outboundMessages: outbound,
    inboundIpc,
  });
  return new ChildProcess(handle, opts.__fork ?? false, { stdout, stderr });
}

function spawnViaSameRealm(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  // fallback per ADR-0011 — the handler needs the kernel `ProcessHandle`
  // and our `ChildProcess` wrapper, both constructed AFTER the handler is
  // registered. We pass them through a mutable container so the handler
  // reads them when it runs on the next microtask — no extra `await`
  // boundaries, which would delay the script body past what existing IPC
  // tests rely on.
  const wiring: { handle?: ProcessHandle; child?: ChildProcess } = {};

  const handle = globalProcessManager.spawn(
    command,
    async (io: ProcessIO) => {
      const ownHandle = wiring.handle;
      const child = wiring.child;
      if (!ownHandle || !child) {
        throw new Error('child_process.spawn: wiring not populated before handler ran');
      }
      await execScript({
        command,
        args,
        opts,
        io,
        ownHandle,
        inboundIpc: child.inboundIpc,
        stdoutPush: (c) => child.stdout.push(c),
        stderrPush: (c) => child.stderr.push(c),
        outboundMessages: child,
      });
    },
    /* ppid */ 1,
    { cwd: opts.cwd },
  );

  wiring.handle = handle;
  const child = new ChildProcess(handle, opts.__fork ?? false);
  wiring.child = child;
  return child;
}

export function exec(
  cmd: string,
  optsOrCb?: ExecOptions | ((err: Error | null, stdout: string, stderr: string) => void),
  cb?: (err: Error | null, stdout: string, stderr: string) => void,
): ChildProcess {
  const opts: ExecOptions = typeof optsOrCb === 'function' ? {} : (optsOrCb ?? {});
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) ?? (() => {});

  const tokens = cmd.split(/\s+/).filter(Boolean);
  const cmdName = tokens[0] ?? '';
  const child = spawn(cmdName, tokens.slice(1), opts);
  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout.on('data', (c) => {
    stdoutBuf += typeof c === 'string' ? c : Buffer.from(c as Uint8Array).toString();
  });
  child.stderr.on('data', (c) => {
    stderrBuf += typeof c === 'string' ? c : Buffer.from(c as Uint8Array).toString();
  });
  child.on('close', (code) => {
    const err = code !== 0 ? Object.assign(new Error(`Command failed: ${cmd}`), { code }) : null;
    cbFinal(err, stdoutBuf, stderrBuf);
  });
  return child;
}

export function fork(
  modulePath: string,
  args: string[] = [],
  opts: SpawnOptions = {},
): ChildProcess {
  return spawn('node', [modulePath, ...args], { ...opts, __fork: true });
}

// `execSync` lives in `./child_process-sync.ts` so the SAB-vs-fallback
// branch can stay together with its helpers without pushing this module
// over the 300-line budget. Re-export here so the public `child_process`
// surface still exposes it.
export { execSync };

export const ChildProcess_ = ChildProcess;

const child_process = { spawn, exec, fork, execSync, ChildProcess: ChildProcess_ };
export default child_process;
