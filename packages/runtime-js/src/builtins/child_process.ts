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

import { Buffer, EventEmitter, NotImplementedError, Readable, Writable } from '@riftydev/io';
import {
  type ProcessHandle,
  type ProcessIO,
  getKernelDispatcher,
  getKernelWorkerUrl,
  globalProcessManager,
  isSabIpcSupported,
} from '@riftydev/kernel';
import { installRuntimeJsExecSyncHandler } from '../ipc/handlers.ts';
import { execScript } from './child_process-exec.ts';
import { execSync } from './child_process-sync.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { getNodeEntryWorkerUrl } from './node-entry-url.ts';

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
  /** Internal flag set by `fork()` to enable IPC. */
  __fork?: boolean;
}

interface ExecOptions extends SpawnOptions {
  encoding?: string;
  maxBuffer?: number;
}

/**
 * `Writable` whose `write` / `end` throw {@link NotImplementedError}. The
 * in-realm `spawn` fallback has no Worker, hence no stdin destination — throwing
 * is the right signal (CLAUDE.md "no silent stubs"). Overridden on the instance
 * so the throw surfaces at the caller's frame, not as a deferred `'error'` from
 * the buffered `_write` / `_final` pipeline. The Worker path uses a real
 * `Writable` from `handle.stdin()` instead.
 */
class InRealmStdinUnsupported extends Writable {
  override write(): never {
    throw new NotImplementedError(
      'child.stdin.write',
      'in-realm spawn fallback has no worker stdin port — only the SAB-Worker path wires stdin (ADR-0011 phase 2)',
    );
  }
  override end(): never {
    throw new NotImplementedError(
      'child.stdin.end',
      'in-realm spawn fallback has no worker stdin port — only the SAB-Worker path wires stdin (ADR-0011 phase 2)',
    );
  }
}

class ChildProcess extends EventEmitter {
  /** Allocated by `ProcessManager` — PID space is unified across the runtime. */
  readonly pid: number;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /**
   * Write-side of the child's stdin. SAB-Worker path: `handle.stdin()` posts
   * each chunk to the worker's stdin `MessagePort`. In-realm fallback: an
   * {@link InRealmStdinUnsupported} that throws (no worker to route to).
   */
  readonly stdin: Writable;
  killed = false;
  // Mutable so {@link disconnect} can flip it off on the same-realm path,
  // which has no separate channel to close — the gate is the whole story.
  private ipcEnabled: boolean;
  private readonly handle: ProcessHandle;
  /** Bus the child's script subscribes to for parent-sent `'childMessage'`
   * events. Exposed to the spawner via `internalIpc()`. */
  readonly inboundIpc: EventEmitter = new EventEmitter();

  constructor(
    handle: ProcessHandle,
    ipcEnabled: boolean,
    /** Optional pre-allocated stdio (Worker-backed path writes into them so the
     * parent can listen before the worker's first `postMessage` lands, and
     * supplies `stdin` from `handle.stdin()`). In-realm fallback leaves these
     * unset and gets an {@link InRealmStdinUnsupported} throwing on write/end. */
    streams?: { stdout?: Readable; stderr?: Readable; stdin?: Writable },
  ) {
    super();
    this.handle = handle;
    this.pid = handle.pid;
    this.ipcEnabled = ipcEnabled;
    // Handle/Worker events push stdio; neither fallback is a bare source.
    this.stdout = streams?.stdout ?? new Readable({ objectMode: false, read(): void {} });
    this.stderr = streams?.stderr ?? new Readable({ objectMode: false, read(): void {} });
    this.stdin = streams?.stdin ?? new InRealmStdinUnsupported();
    // Surface kernel-tracked exit/close so existing `.on('close', …)` consumers
    // keep working.
    handle.on('exit', (code, signal) => {
      this.emit('exit', code, signal);
    });
    handle.on('close', (code, signal) => {
      this.emit('close', code, signal);
    });
    // ADR-0045: mirror fork-IPC events from the WorkerProcessHandle (`'message'`
    // for `ipc:message` frames, `'disconnect'` on teardown) so Node-shape
    // `child.on('message', …)` consumers keep working.
    if (handle.kind === 'worker') {
      handle.on('message', (msg) => {
        this.emit('message', msg);
      });
      handle.on('disconnect', () => {
        this.emit('disconnect');
      });
    }
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

  /**
   * Send an IPC message to the child (Node `subprocess.send` parity). SAB-Worker
   * path (ADR-0045): posts over the parent↔child IPC port → worker-side
   * `process.on('message', …)`. In-realm fallback: emits on `inboundIpc`, which
   * the script's `__process.onMessage(...)` subscribes to. Returns `false` when
   * IPC is disabled (not `fork()`ed) or the handle already disconnected.
   */
  send(message: unknown): boolean {
    if (!this.ipcEnabled) return false;
    if (this.handle.kind === 'worker') {
      return this.handle.send(message);
    }
    this.inboundIpc.emit('childMessage', message);
    return true;
  }

  /**
   * Disconnect the IPC channel (ADR-0045 / Node parity). SAB-Worker path closes
   * the parent↔child port (worker observes `'disconnect'` on its `process`
   * shim). In-realm fallback has no separate channel — disabling further sends
   * is sufficient.
   */
  disconnect(): void {
    if (this.handle.kind === 'worker') {
      this.handle.disconnect();
      return;
    }
    // In-realm: no channel to close — flip the gate and emit for listeners.
    if (this.ipcEnabled) {
      this.ipcEnabled = false;
      this.emit('disconnect');
    }
  }

  kill(signal = 'SIGTERM'): boolean {
    if (this.handle.exitCode !== null) return false;
    this.killed = true;
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
export function spawn(command: string, args: string[] = [], opts: SpawnOptions = {}): ChildProcess {
  // The generic worker-backed spawn never wired RIFTY_REMOTE_FS, so a spawned
  // worker reads its OWN empty mirror, not the parent/owner store (only the
  // owner `.bin` executor wires it — ADR-0150). Reachable solely from a realm
  // with the kernel + node-entry worker URLs (owner/page); fail LOUD there
  // instead of silently spawning an ENOENT child. The supervised-child realm
  // (URLs unset) falls through to the working same-realm path below, which reads
  // the installed remote mirror.
  // TODO(backlog: runtime-js/generic-spawn-worker-remote-fs)
  if (
    command === 'node' &&
    args[0] !== undefined &&
    isSabIpcSupported() &&
    getKernelWorkerUrl() !== null &&
    getNodeEntryWorkerUrl() !== null
  ) {
    throw new NotImplementedError(
      'child_process.spawn[worker]',
      'generic worker-backed spawn cannot yet read the parent/owner filesystem ' +
        '(RIFTY_REMOTE_FS unwired for the generic path, ADR-0150) — wire the remote ' +
        'sync-FS before routing `node <script>` to a worker child',
    );
  }
  // ADR-0011 fallback: kept for non-isolated test environments, the supervised
  // child realm, and non-`node` commands that need ENOENT.
  return spawnViaSameRealm(command, args, opts);
}

function spawnViaSameRealm(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  // The handler needs the `ProcessHandle` and `ChildProcess`, both built AFTER
  // it's registered. A mutable container lets the handler read them on the next
  // microtask without an extra `await` boundary, which would delay the script
  // body past what existing IPC tests rely on.
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

// `execSync` lives in `./child_process-sync.ts` to keep the SAB-vs-fallback
// branch with its helpers. Re-exported here for the public `child_process`
// surface.
export { execSync };

export const ChildProcess_ = ChildProcess;

const child_process = { spawn, exec, fork, execSync, ChildProcess: ChildProcess_ };
export default child_process;
