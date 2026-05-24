/**
 * Node-compatible `node:child_process` (subset).
 *
 * Backed by the kernel `ProcessManager`. We don't actually spawn an OS process
 * — the playground runs in a browser. Instead, "spawning a node script" runs
 * the script's source through our own loader inside a logical child process
 * tracked by the manager.
 *
 * Acceptance pieces for M6:
 *   - `spawn(cmd, args)` returns a ChildProcess with stdout/stderr/exit events.
 *   - `exec(cmd, cb)` buffers stdout/stderr.
 *   - `fork(modulePath)` adds IPC via `send`/`message`.
 *   - `execSync` synchronously runs and returns stdout. (Implemented via the
 *     synchronous path: child handler runs synchronously in our model.)
 *
 * The runtime intentionally does not implement `spawn('bash', …)` — there is
 * no shell. `spawn('node', [script])` runs `script` through our loader.
 */

import { NotImplementedError } from '@rifty/io';
import { Buffer } from './buffer.ts';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { Readable } from './stream.ts';

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
  readonly pid: number;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: { write(chunk: unknown): never; end(): never };
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  private readonly ipcEnabled: boolean;
  /** Bus the child's script subscribes to for `'childMessage'` events sent
   * by the parent. Exposed to the spawner via `internalIpc()`. */
  readonly inboundIpc: EventEmitter = new EventEmitter();

  constructor(pid: number, ipcEnabled: boolean) {
    super();
    this.pid = pid;
    this.ipcEnabled = ipcEnabled;
    this.stdout = new Readable({ objectMode: false });
    this.stderr = new Readable({ objectMode: false });
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
  }

  /** Send IPC message to the child. */
  send(message: unknown): boolean {
    if (!this.ipcEnabled) return false;
    this.inboundIpc.emit('childMessage', message);
    return true;
  }

  kill(signal = 'SIGTERM'): boolean {
    if (this.exitCode !== null) return false;
    this.signalCode = signal;
    this.killed = true;
    this.exitCode = null;
    queueMicrotask(() => {
      this.emit('exit', null, signal);
      this.emit('close', null, signal);
    });
    return true;
  }

  /** Internal: called by the spawner to wire up the child's IO. */
  _wireChild(onStdout: Readable, onStderr: Readable, inbound: EventEmitter): void {
    onStdout.on('data', (chunk) => this.stdout.push(chunk));
    onStderr.on('data', (chunk) => this.stderr.push(chunk));
    onStdout.on('end', () => this.stdout.push(null));
    onStderr.on('end', () => this.stderr.push(null));
    if (this.ipcEnabled) {
      inbound.on('childMessage', (msg) => this.inboundIpc.emit('message', msg));
    }
  }

  _exit(code: number | null, signal: string | null = null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

let nextPid = 1000;

/**
 * `spawn` runs a JS source file through our module loader as a "child".
 * Recognised command: `'node'` with `args[0]` being a script path in the VFS.
 * Any other command emits an error after the next tick (matches Node's
 * behaviour for missing executables).
 */
export function spawn(command: string, args: string[] = [], opts: SpawnOptions = {}): ChildProcess {
  const child = new ChildProcess(nextPid++, opts.__fork ?? false);

  queueMicrotask(() => {
    if (command !== 'node') {
      child.stderr.push(`spawn ${command} ENOENT\n`);
      child._exit(127, null);
      return;
    }
    const scriptPath = args[0];
    if (!scriptPath) {
      child.stderr.push('node: missing script\n');
      child._exit(1, null);
      return;
    }
    try {
      const source = syncMirror().readFileBytesSync(scriptPath);
      const code = Buffer.from(source).toString();
      // Run script in a fresh-ish scope with our own console replacements.
      const fn = new Function(
        '__stdout_write',
        '__stderr_write',
        '__process',
        `${code}\n//# sourceURL=${scriptPath}`,
      ) as (
        write: (chunk: string) => void,
        ewrite: (chunk: string) => void,
        proc: unknown,
      ) => unknown;
      const childProcess: {
        argv: string[];
        env: Record<string, string>;
        stdout: { write(c: string): void };
        stderr: { write(c: string): void };
        send?: (msg: unknown) => boolean;
        on?: (event: string, cb: (msg: unknown) => void) => void;
        onMessage?: (cb: (msg: unknown) => void) => () => void;
        exit?: (code: number) => never;
      } = {
        argv: ['rifty', scriptPath, ...args.slice(1)],
        env: opts.env ?? {},
        stdout: { write: (c: string) => child.stdout.push(c) },
        stderr: { write: (c: string) => child.stderr.push(c) },
      };
      if (opts.__fork) {
        // Wire fork IPC: child.send goes to parent via the Worker handle's
        // 'message' event; parent → child arrives on `__process.on('message',…)`.
        const inboundIpc = child.inboundIpc;
        childProcess.send = (msg) => {
          child.emit('message', msg);
          return true;
        };
        const onMessage = (cb: (msg: unknown) => void) => {
          const wrapped = (m: unknown) => cb(m);
          inboundIpc.on('childMessage', wrapped);
          return () => inboundIpc.off('childMessage', wrapped);
        };
        childProcess.onMessage = onMessage;
        childProcess.on = (event, cb) => {
          if (event === 'message') onMessage(cb);
        };
        childProcess.exit = (code) => {
          child.stdout.push(null);
          child.stderr.push(null);
          child._exit(code, null);
          throw Object.assign(new Error('__process.exit'), { code: 'RIFTY_PROCESS_EXIT' });
        };
      }
      const result = fn(
        (c) => child.stdout.push(c),
        (c) => child.stderr.push(c),
        childProcess,
      );
      Promise.resolve(result).then(
        () => {
          child.stdout.push(null);
          child.stderr.push(null);
          child._exit(0, null);
        },
        (err) => {
          child.stderr.push(err instanceof Error ? `${err.stack ?? err.message}\n` : String(err));
          child.stdout.push(null);
          child.stderr.push(null);
          child._exit(1, null);
        },
      );
    } catch (err) {
      child.stderr.push(err instanceof Error ? `${err.stack ?? err.message}\n` : String(err));
      child._exit(1, null);
    }
  });

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

/**
 * `execSync` actually runs the script synchronously since our spawn is
 * basically a function call. Returns stdout as a Buffer.
 */
export function execSync(cmd: string, _opts?: ExecOptions): Uint8Array {
  const tokens = cmd.split(/\s+/).filter(Boolean);
  if (tokens[0] !== 'node' || tokens.length < 2) {
    throw Object.assign(new Error(`execSync only supports 'node <script>': got ${cmd}`), {
      code: 'EUNSUPPORTED',
    });
  }
  const scriptPath = tokens[1]!;
  let stdout = '';
  const source = syncMirror().readFileBytesSync(scriptPath);
  const fn = new Function(
    '__stdout_write',
    `${Buffer.from(source).toString()}\n//# sourceURL=${scriptPath}`,
  ) as (w: (c: string) => void) => unknown;
  fn((c) => {
    stdout += c;
  });
  return Buffer.from(stdout);
}

export const ChildProcess_ = ChildProcess;

const child_process = { spawn, exec, fork, execSync, ChildProcess: ChildProcess_ };
export default child_process;
