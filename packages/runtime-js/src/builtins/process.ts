/**
 * Node-compatible `process` global — the ONE `NodeProcess` class (ADR-0157).
 *
 * Spec-seeded (pid/ppid/argv/env/cwd + stdio MessagePorts + ADR-0045 fork-IPC)
 * AND mutable (chdir/nextTick/hrtime/uptime/exitCode). Built once: the kernel
 * pre-entry seam constructs `new NodeProcess(spec)` for kernel-spawned children
 * (see `ipc/install-process.ts`); the REPL worker uses the no-spec singleton
 * `riftyProcess`. No post-spawn `globalThis.process` swap.
 *
 * `nextTick` is queued via `queueMicrotask`. To match Node's ordering (nextTick
 * always wins over `Promise.then`), `patchPromiseForNextTick` patches
 * `Promise.prototype.then` in the realm so every then-callback drains pending
 * nextTicks before firing — gated to Node workers at the pre-entry seam (WASI
 * realms leave `then` native).
 *
 * Limitation: code that captured the original `.then` before our patch (via
 * `bind`/closure on boot) bypasses the drain. Acceptable for M3; revisit if a
 * real package breaks.
 */
import type { IpcFrame, KernelProcessSpec } from '@riftydev/kernel';
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { NODE_PROCESS_IDENTITY } from './process-identity.ts';

const nextTickQueue: Array<{ fn: (...args: unknown[]) => void; args: unknown[] }> = [];
// Head cursor instead of shift()-per-item: O(n) drain, not O(n^2) (#27, perf-audit
// 2026-06-05). Reset to 0 only after a full drain (see drainNextTicks).
let drainHead = 0;
let promisePatched = false;

/**
 * Per-Worker cwd cell (ADR-0019), a snapshot of the active `ProcessRecord.cwd`.
 * Realm-local module state: one process realm per Worker, so the cell is the
 * single source of truth read by `cwd()`/`getProcessCwd()` and written by
 * `chdir`/`setProcessCwd` AND seeded from `spec.cwd` at construction.
 * Default `/workspace` matches the runtime VFS bootstrap convention.
 */
let currentCwd = '/workspace';

function drainNextTicks(): void {
  // Re-read `.length` each iteration so items enqueued mid-drain (nextTick from
  // inside nextTick) are processed — same as the old shift()-until-empty loop.
  // Do NOT snapshot the array.
  while (drainHead < nextTickQueue.length) {
    const item = nextTickQueue[drainHead++];
    if (!item) continue;
    try {
      item.fn(...item.args);
    } catch (err) {
      // Surface on the ACTIVE realm process (the one user code attached handlers
      // to): the seeded NodeProcess in a kernel child, else the REPL singleton.
      const active = (globalThis as { process?: unknown }).process;
      const target = active instanceof NodeProcess ? active : riftyProcess;
      (target as unknown as EventEmitter).emit('uncaughtException', err);
    }
  }
  // Fully drained: clear the array + cursor so the next nextTick sees length
  // 0->1 and re-arms ensureDrainScheduled. Reached exactly once per drain.
  nextTickQueue.length = 0;
  drainHead = 0;
}

function ensureDrainScheduled(): void {
  if (nextTickQueue.length === 1) {
    queueMicrotask(drainNextTicks);
  }
}

function nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  nextTickQueue.push({ fn, args });
  ensureDrainScheduled();
}

/** Patch `Promise.prototype.then` so nextTick beats `.then` (Node ordering). */
export function patchPromiseForNextTick(): void {
  if (promisePatched) return;
  promisePatched = true;
  const origThen = Promise.prototype.then;
  Promise.prototype.then = function (this: Promise<unknown>, onF, onR) {
    const wrapF =
      typeof onF === 'function'
        ? (value: unknown) => {
            drainNextTicks();
            return (onF as (v: unknown) => unknown)(value);
          }
        : onF;
    const wrapR =
      typeof onR === 'function'
        ? (reason: unknown) => {
            drainNextTicks();
            return (onR as (r: unknown) => unknown)(reason);
          }
        : onR;
    return origThen.call(this, wrapF as never, wrapR as never);
  } as typeof Promise.prototype.then;
}

// --- stdio plumbing (shared by spec + no-spec processes) ---

const STDIO_ENCODER = new TextEncoder();

function encodeChunk(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? STDIO_ENCODER.encode(chunk) : chunk;
}

type StdioCallback = () => void;

interface NodeStdioWriter {
  write(chunk: string | Uint8Array): boolean;
  isTTY: boolean;
  fd: number;
  clearLine?(dir?: number, cb?: StdioCallback): boolean;
  cursorTo?(x: number, yOrCb?: number | StdioCallback, cb?: StdioCallback): boolean;
  moveCursor?(dx: number, dy: number, cb?: StdioCallback): boolean;
  clearScreenDown?(cb?: StdioCallback): boolean;
}

function writeControl(stream: NodeStdioWriter, sequence: string, cb?: StdioCallback): boolean {
  const ok = stream.write(sequence);
  if (cb) queueMicrotask(cb);
  return ok;
}

function attachTtyControls(stream: NodeStdioWriter): NodeStdioWriter {
  stream.clearLine = (dir, cb): boolean => {
    const direction = dir ?? 0;
    const mode = direction < 0 ? 1 : direction > 0 ? 0 : 2;
    return writeControl(stream, `\x1b[${mode}K`, cb);
  };
  stream.cursorTo = (x, yOrCb, cb): boolean => {
    const y = typeof yOrCb === 'number' ? yOrCb : undefined;
    const callback = typeof yOrCb === 'function' ? yOrCb : cb;
    const sequence = y === undefined ? `\x1b[${Math.max(0, x) + 1}G` : `\x1b[${y + 1};${x + 1}H`;
    return writeControl(stream, sequence, callback);
  };
  stream.moveCursor = (dx, dy, cb): boolean => {
    let sequence = '';
    if (dx < 0) sequence += `\x1b[${-dx}D`;
    else if (dx > 0) sequence += `\x1b[${dx}C`;
    if (dy < 0) sequence += `\x1b[${-dy}A`;
    else if (dy > 0) sequence += `\x1b[${dy}B`;
    return writeControl(stream, sequence, cb);
  };
  stream.clearScreenDown = (cb): boolean => writeControl(stream, '\x1b[0J', cb);
  return stream;
}

/** Spec stdout/stderr writer: postMessage bytes to the child's stdio port. */
function makeStdioWriter(port: MessagePort, fd: number, isTTY: boolean): NodeStdioWriter {
  const stream: NodeStdioWriter = {
    isTTY,
    fd,
    write(chunk) {
      const bytes = encodeChunk(chunk);
      // Transfer the buffer only when we own it (TextEncoder output). A passed-in
      // Uint8Array may share its backing buffer with the caller, so copy instead.
      if (typeof chunk === 'string') {
        port.postMessage(bytes, [bytes.buffer]);
      } else {
        const copy = new Uint8Array(bytes);
        port.postMessage(copy, [copy.buffer]);
      }
      return true;
    },
  };
  return isTTY ? attachTtyControls(stream) : stream;
}

export interface NodeStdin extends EventEmitter {
  isTTY: boolean;
  fd: number;
  setEncoding(encoding: string | null): void;
  resume(): void;
  pause(): void;
}

/**
 * Build a `process.stdin` Readable-ish EventEmitter fed by either a kernel
 * stdin MessagePort (spec child) or the host bridge (`writeProcessStdin`, REPL).
 * Returns the stdin + a `push(data)` the host source calls. Pre-listener
 * buffering + utf8 stream-decoding match Node's encoding semantics.
 */
function makeStdinReader(
  port?: MessagePort,
  isTTY = false,
): {
  stdin: NodeStdin;
  push(data: string | Uint8Array): void;
} {
  const stdin = new EventEmitter() as NodeStdin;
  let encoding: string | null = null;
  const pending: Array<string | Uint8Array> = [];
  let decoder = new TextDecoder();

  const normalize = (data: string | Uint8Array): string | Uint8Array | null => {
    if (typeof data === 'string') return data;
    if (encoding && /^utf-?8$/iu.test(encoding)) {
      const text = decoder.decode(data, { stream: true });
      return text.length === 0 ? null : text;
    }
    return data;
  };
  const flush = (): void => {
    if (stdin.listenerCount('data') === 0) return;
    while (pending.length > 0) {
      const chunk = pending.shift();
      if (chunk !== undefined) stdin.emit('data', chunk);
    }
  };
  const push = (data: string | Uint8Array): void => {
    const chunk = normalize(data);
    if (chunk == null) return;
    if (stdin.listenerCount('data') === 0) {
      pending.push(chunk);
      return;
    }
    stdin.emit('data', chunk);
  };

  Object.assign(stdin, {
    isTTY,
    fd: 0,
    setEncoding(next: string | null) {
      encoding = next;
      decoder = new TextDecoder();
    },
    resume() {
      flush();
    },
    pause() {},
  });
  stdin.on('newListener', (event) => {
    if (event === 'data') queueMicrotask(flush);
  });
  stdin.on('end', () => {
    if (!encoding || !/^utf-?8$/iu.test(encoding)) return;
    const tail = decoder.decode();
    if (tail.length === 0) return;
    if (stdin.listenerCount('data') === 0) {
      pending.push(tail);
      return;
    }
    stdin.emit('data', tail);
  });

  if (port) {
    port.onmessage = (ev: MessageEvent): void => {
      const data = ev.data;
      if (typeof data === 'string' || data instanceof Uint8Array) push(data);
    };
    port.start();
  }
  return { stdin, push };
}

function envFlag(env: Readonly<Record<string, string | undefined>>, key: string): boolean {
  return env[key] === '1';
}

/** Wrap an exit code to Node's unsigned 8-bit range (e.g. 257 → 1, -1 → 255). */
export function toUint8ExitCode(n: number): number {
  return ((Math.trunc(n) % 256) + 256) % 256;
}

/**
 * Node's `process.exitCode`/`process.exit(code)` coercion contract: a numeric
 * string coerces to its number; a non-integer number or a non-coercible value
 * throws LOUDLY (Fidelity — never silently swallow an invalid exit code, which is
 * what real Node does at the setter). undefined/null reset to 0.
 */
export function coerceExitCode(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v;
    throw Object.assign(
      new RangeError(`The value of "code" is out of range. It must be an integer. Received ${v}`),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (v.trim() !== '' && Number.isInteger(n)) return n;
    throw Object.assign(
      new RangeError(`The value of "code" is out of range. It must be an integer. Received '${v}'`),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
  throw Object.assign(
    new TypeError(`The "code" argument must be of type number or string. Received ${typeof v}`),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

/**
 * The unified Node `process`. `instanceof EventEmitter` holds so user code doing
 * `process instanceof require('events')` keeps working.
 */
export class NodeProcess extends EventEmitter {
  pid: number;
  ppid: number;
  argv: string[];
  readonly argv0 = NODE_PROCESS_IDENTITY.argv0;
  readonly execPath = NODE_PROCESS_IDENTITY.execPath;
  readonly platform = NODE_PROCESS_IDENTITY.platform;
  readonly arch = NODE_PROCESS_IDENTITY.arch;
  readonly version = NODE_PROCESS_IDENTITY.version;
  // Shallow copy so per-process mutation (e.g. process.versions.x = …) works
  // without throwing and doesn't leak across processes (ADR-0150: each
  // foreground CLI in its own supervised child worker). `Record` (not the narrow
  // literal) so reads of absent keys (e.g. `versions.electron` — yargs) type-check.
  readonly versions: Record<string, string> = { ...NODE_PROCESS_IDENTITY.versions };
  readonly title = NODE_PROCESS_IDENTITY.title;
  env: Record<string, string | undefined>;
  // Node-faithful: assigning an invalid exit code throws at the SETTER (loud),
  // a numeric string coerces; reads return the validated integer.
  #exitCode = 0;
  get exitCode(): number {
    return this.#exitCode;
  }
  set exitCode(v: unknown) {
    this.#exitCode = coerceExitCode(v);
  }
  stdout: NodeStdioWriter;
  stderr: NodeStdioWriter;
  stdin: NodeStdin;
  nextTick = nextTick;

  /** Fork-IPC (ADR-0045) — present only when seeded with a spec ipc port. */
  send?: (message: unknown) => boolean;
  disconnect?: () => void;

  readonly #stdinPush: (data: string | Uint8Array) => void;
  #ipcPort: MessagePort | null = null;
  #ipcDisconnected = false;
  // Frames received before any `'message'` listener attaches (ADR-0045) — flushed
  // in order on the first listener; mirrors makeStdinReader's pending buffer.
  readonly #ipcBacklog: unknown[] = [];

  constructor(spec?: KernelProcessSpec) {
    super();
    if (spec) {
      this.pid = spec.pid;
      this.ppid = spec.ppid;
      this.argv = [...spec.argv];
      // Copy so per-process env mutation does not leak into the published
      // Readonly spec (the kernel threads spec.env by reference).
      this.env = { ...spec.env };
      currentCwd = spec.cwd;
      this.stdout = makeStdioWriter(spec.stdio.stdout, 1, envFlag(spec.env, 'RIFTY_STDOUT_IS_TTY'));
      this.stderr = makeStdioWriter(spec.stdio.stderr, 2, envFlag(spec.env, 'RIFTY_STDERR_IS_TTY'));
      const reader = makeStdinReader(spec.stdio.stdin, envFlag(spec.env, 'RIFTY_STDIN_IS_TTY'));
      this.stdin = reader.stdin;
      this.#stdinPush = reader.push;
      this.#wireIpc(spec.stdio.ipc);
    } else {
      this.pid = 1;
      this.ppid = 0;
      this.argv = ['rifty', 'repl'];
      this.env = Object.create(null);
      this.stdout = {
        write: (chunk) => {
          console.log(chunk);
          return true;
        },
        isTTY: false,
        fd: 1,
      };
      this.stderr = {
        write: (chunk) => {
          console.error(chunk);
          return true;
        },
        isTTY: false,
        fd: 2,
      };
      const reader = makeStdinReader();
      this.stdin = reader.stdin;
      this.#stdinPush = reader.push;
    }
  }

  cwd(): string {
    return currentCwd;
  }

  chdir(dir: string): void {
    if (typeof dir !== 'string') {
      throw Object.assign(new TypeError('chdir: path must be a string'), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    const target = normalizePath(isAbsolute(dir) ? dir : joinPath(currentCwd, dir));
    let stat: { isDirectory: boolean };
    try {
      stat = syncMirror().statSync(target);
    } catch (err) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, chdir '${dir}'`), {
        code: 'ENOENT',
        syscall: 'chdir',
        path: target,
        cause: err,
      });
    }
    if (!stat.isDirectory) {
      throw Object.assign(new Error(`ENOTDIR: not a directory, chdir '${dir}'`), {
        code: 'ENOTDIR',
        syscall: 'chdir',
        path: target,
      });
    }
    currentCwd = target;
  }

  hrtime(time?: [number, number]): [number, number] {
    const ms = performance.now();
    const secs = Math.floor(ms / 1000);
    const ns = Math.floor((ms - secs * 1000) * 1e6);
    if (!time) return [secs, ns];
    const [s0, n0] = time;
    return [secs - s0, ns - n0];
  }

  uptime(): number {
    return performance.now() / 1000;
  }

  exit(code: unknown = 0): never {
    const c = coerceExitCode(code); // coerce string / throw on invalid (Node parity)
    this.#exitCode = c;
    throw Object.assign(new Error(`process.exit(${c})`), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: toUint8ExitCode(c), // OS-style uint8 wrap (process.exit(257) → 1)
    });
  }

  /** Host bridge: deliver terminal/process stdin into this realm's process. */
  pushStdin(data: string | Uint8Array): void {
    this.#stdinPush(data);
  }

  #wireIpc(port: MessagePort): void {
    this.#ipcPort = port;
    // Browsers auto-start a port only with `addEventListener('message')`; using
    // `onmessage = …` requires an explicit `start()` (called below).
    port.onmessage = (ev: MessageEvent): void => {
      const frame = ev.data as IpcFrame | undefined;
      if (!frame || typeof frame !== 'object' || typeof frame.kind !== 'string') return;
      if (frame.kind === 'ipc:message') {
        if (this.listenerCount('message') === 0) {
          this.#ipcBacklog.push(frame.payload);
        } else {
          this.emit('message', frame.payload);
        }
      } else if (frame.kind === 'ipc:disconnect') {
        this.#tearDownIpc();
      }
    };
    port.start();

    // Flush frames buffered before the first listener. `newListener` fires BEFORE
    // the listener is added; defer to a MACROTASK (not a microtask) so the flush
    // lands AFTER the entry module finishes evaluating — Node delivers IPC on the
    // event loop, never mid-eval. A microtask delivered the buffered
    // `{__emnapi__:load}` frame in the gap between Rolldown's `wasi-worker.mjs`
    // attaching `parentPort.on('message')` (top) and setting `globalThis.onmessage`
    // (last line), crashing with "globalThis.onmessage is not a function".
    // TODO(backlog: runtime-js/ipc-backlog-flush-entry-resolution): setTimeout(0)
    // is robust only while the entry body fits one macrotask; the Node-correct
    // release is a kernel post-entry hook firing after the entry module resolves.
    this.on('newListener', (event) => {
      if (event !== 'message' || this.#ipcBacklog.length === 0) return;
      setTimeout(() => {
        for (const payload of this.#ipcBacklog.splice(0)) this.emit('message', payload);
      }, 0);
    });

    this.send = (message: unknown): boolean => {
      if (this.#ipcDisconnected) return false;
      try {
        const frame: IpcFrame = { kind: 'ipc:message', payload: message };
        port.postMessage(frame);
        return true;
      } catch {
        // Port may have been detached by the parent — treat as disconnect.
        this.#tearDownIpc();
        return false;
      }
    };

    this.disconnect = (): void => {
      if (this.#ipcDisconnected) return;
      try {
        port.postMessage({ kind: 'ipc:disconnect' } satisfies IpcFrame);
      } catch {
        /* peer may have closed already */
      }
      this.#tearDownIpc();
    };
  }

  #tearDownIpc(): void {
    if (this.#ipcDisconnected) return;
    this.#ipcDisconnected = true;
    try {
      this.#ipcPort?.close();
    } catch {
      /* peer may have closed */
    }
    this.emit('disconnect');
  }
}

(NodeProcess.prototype as unknown as { hrtime: { bigint: () => bigint } }).hrtime.bigint = () =>
  BigInt(Math.floor(performance.now() * 1e6));

/** REPL/default singleton (no spec). Kernel children get their own seeded one. */
export const riftyProcess = new NodeProcess();

/** Host bridge: deliver terminal/process stdin into the REPL Worker process. */
export function writeProcessStdin(data: string | Uint8Array): void {
  riftyProcess.pushStdin(data);
}

/**
 * Install the no-spec REPL `process` on `globalThis` + patch Promise for nextTick
 * ordering. Idempotent: skips when `globalThis.process` is already a `NodeProcess`
 * (the kernel pre-entry seam already installed the seeded one), so a stray
 * top-level call in a co-bundled chunk cannot clobber it (ADR-0157;
 * backlog: runtime-js/worker-entry-process-globals-side-effect).
 */
export function installProcessGlobals(): void {
  if ((globalThis as { process?: unknown }).process instanceof NodeProcess) return;
  patchPromiseForNextTick();
  (globalThis as unknown as { process: NodeProcess }).process = riftyProcess;
}

/**
 * Test/host helper: override the per-Worker cwd cell, bypassing `chdir`'s VFS
 * validation. Used by the parity-runner so `process.cwd()` sees a stable anchor
 * matching the Node child's `--cwd`. Not Node API — production code uses `chdir`.
 */
export function setProcessCwd(next: string): void {
  currentCwd = next;
}

/** Internal cwd accessor for sibling builtins (e.g. `fs.resolvePath`). */
export function getProcessCwd(): string {
  return currentCwd;
}

export default riftyProcess;
