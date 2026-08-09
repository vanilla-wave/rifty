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
import {
  type IpcFrame,
  type KernelProcessSpec,
  type KernelStdioOutputWriter,
  decodeIpcFrame,
  globalProcessManager,
} from '@riftydev/kernel';
import { NotImplementedError, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import {
  beginNodeEvalExplicitExit,
  ref as refEventLoop,
  unref as unrefEventLoop,
} from '../internal/event-loop-keepalive.ts';
import { nodeIpcChannel } from '../internal/node-ipc-channel.ts';
import { serializeNodeIpcMessage } from '../internal/node-ipc-serialization.ts';
import { installGlobalAlias } from '../ipc/worker-realm-compat.ts';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import {
  type NodeEntryLaunch,
  type NodeEntryTerminalBootstrap,
  readNodeEntryBootstrapIfPresent,
  snapshotNodeEntryTerminalBootstrap,
} from './node-entry-runtime-config.ts';
import {
  attachNodeProcessBootstrapIdentity,
  readActiveNodeProcessBootstrap,
  readNodeProcessBootstrapIdentity,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import {
  NODE_PROCESS_IDENTITY,
  type NodeProcessRelease,
  createNodeProcessRelease,
} from './process-identity.ts';

const NODE_PROCESS_TERMINAL_BOOTSTRAP = Symbol.for(
  'rifty.runtime-js.process-terminal-bootstrap.v1',
);
const NODE_PROCESS_LISTENING_CONTROL = Symbol.for('rifty.runtime-js.process-listening-control.v1');
const NODE_PROCESS_WORKER_IPC = Symbol.for('rifty.runtime-js.process-worker-ipc.v1');
const NODE_PROCESS_DESCENDANT_AUTHORITY = Symbol.for(
  'rifty.runtime-js.process-descendant-authority.v1',
);
const NODE_PROCESS_BOOTSTRAP_IDENTITY = Symbol.for(
  'rifty.runtime-js.process-bootstrap-identity.v1',
);
const RIFTY_PROCESS_EXIT = 'RIFTY_PROCESS_EXIT';
let processExitErrorTrapInstalled = false;
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

export interface NodeProcessDescendantAuthority {
  kill(pid: number, signal: string): boolean;
  snapshot(): readonly { readonly pid: number }[];
}

function installProcessExitErrorTrap(): void {
  if (processExitErrorTrapInstalled) return;
  const target = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  if (typeof target.addEventListener !== 'function') return;
  processExitErrorTrapInstalled = true;
  target.addEventListener('error', (event) => {
    if (typeof event !== 'object' || event === null) return;
    const error = (event as { error?: unknown }).error;
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === RIFTY_PROCESS_EXIT
    ) {
      (event as { preventDefault?: () => void }).preventDefault?.();
    }
  });
}

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

interface NodeStdioWriter extends EventEmitter {
  write(chunk: string | Uint8Array): boolean;
  isTTY: boolean;
  fd: number;
  columns?: number;
  rows?: number;
  getWindowSize?(): [number, number];
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

function attachTtyControls(
  stream: NodeStdioWriter,
  size: { readonly cols: number; readonly rows: number },
): NodeStdioWriter {
  stream.columns = size.cols;
  stream.rows = size.rows;
  stream.getWindowSize = () => [stream.columns ?? 0, stream.rows ?? 0];
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

function detachTtyControls(stream: NodeStdioWriter): NodeStdioWriter {
  Reflect.deleteProperty(stream, 'columns');
  Reflect.deleteProperty(stream, 'rows');
  Reflect.deleteProperty(stream, 'getWindowSize');
  Reflect.deleteProperty(stream, 'clearLine');
  Reflect.deleteProperty(stream, 'cursorTo');
  Reflect.deleteProperty(stream, 'moveCursor');
  Reflect.deleteProperty(stream, 'clearScreenDown');
  return stream;
}

function applyTtyShape(
  stream: NodeStdioWriter,
  isTTY: boolean,
  size: { readonly cols: number; readonly rows: number },
): void {
  stream.isTTY = isTTY;
  if (isTTY) attachTtyControls(stream, size);
  else detachTtyControls(stream);
}

/** Spec stdout/stderr writer: postMessage bytes to the child's stdio port. */
function makeStdioWriter(
  port: KernelStdioOutputWriter,
  fd: number,
  isTTY: boolean,
  size: { readonly cols: number; readonly rows: number },
): NodeStdioWriter {
  const stream = Object.assign(new EventEmitter(), {
    isTTY,
    fd,
    write(chunk: string | Uint8Array) {
      const bytes = encodeChunk(chunk);
      // A passed-in view may share storage with its caller; the semantic writer
      // owns transport, while this adapter preserves Node's non-detaching write.
      port.write(typeof chunk === 'string' ? bytes : new Uint8Array(bytes));
      return true;
    },
  }) as NodeStdioWriter;
  return isTTY ? attachTtyControls(stream, size) : stream;
}

export interface NodeStdin extends EventEmitter {
  isTTY: boolean;
  fd: number;
  setEncoding(encoding?: string | null): NodeStdin;
  resume(): NodeStdin;
  pause(): NodeStdin;
  read(size?: number): never;
  pipe(destination: unknown): never;
  setRawMode(enabled: boolean): never;
  [Symbol.asyncIterator](): never;
}

type StdinListener = (...args: unknown[]) => void;

function throwStdinGap(feature: string): never {
  throw new NotImplementedError(feature);
}

/** Runtime-owned loud boundary shared by every spec-seeded and host process. */
class NodeStdinEmitter extends EventEmitter implements NodeStdin {
  readonly #onDataListener: () => void;

  declare isTTY: boolean;
  declare fd: number;
  declare setEncoding: NodeStdin['setEncoding'];
  declare resume: NodeStdin['resume'];
  declare pause: NodeStdin['pause'];

  constructor(onDataListener: () => void) {
    super();
    this.#onDataListener = onDataListener;
  }

  override addListener(event: string | symbol, listener: StdinListener): this {
    if (event === 'readable') throwStdinGap('process.stdin.readable');
    const result = super.addListener(event, listener);
    if (event === 'data') this.#onDataListener();
    return result;
  }

  override prependListener(event: string | symbol, listener: StdinListener): this {
    if (event === 'readable') throwStdinGap('process.stdin.readable');
    const result = super.prependListener(event, listener);
    if (event === 'data') this.#onDataListener();
    return result;
  }

  read(): never {
    return throwStdinGap('process.stdin.read');
  }

  pipe(): never {
    return throwStdinGap('process.stdin.pipe');
  }

  setRawMode(): never {
    return throwStdinGap('process.stdin.setRawMode');
  }

  [Symbol.asyncIterator](): never {
    return throwStdinGap('process.stdin[Symbol.asyncIterator]');
  }
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
  let encoding: string | null = null;
  const pending: Array<string | Uint8Array> = [];
  let decoder = new TextDecoder();
  let flowing = false;
  let explicitlyPaused = false;
  let eofReceived = false;
  let endEmitted = false;
  let keepaliveHeld = false;
  const syncKeepalive = (): void => {
    const shouldHold = port !== undefined && flowing && !eofReceived;
    if (shouldHold === keepaliveHeld) return;
    keepaliveHeld = shouldHold;
    if (shouldHold) refEventLoop();
    else unrefEventLoop();
  };
  const stdin = new NodeStdinEmitter(() => {
    if (explicitlyPaused) return;
    flowing = true;
    syncKeepalive();
    queueMicrotask(flush);
  });

  const normalize = (data: string | Uint8Array): string | Uint8Array | null => {
    if (typeof data === 'string') return data;
    if (encoding && /^utf-?8$/iu.test(encoding)) {
      const text = decoder.decode(data, { stream: true });
      return text.length === 0 ? null : text;
    }
    return data;
  };
  function flush(): void {
    while (flowing && pending.length > 0) {
      const data = pending.shift();
      if (data === undefined) continue;
      const chunk = normalize(data);
      if (chunk !== null) stdin.emit('data', chunk);
    }
    if (!flowing || pending.length > 0 || !eofReceived || endEmitted) return;
    if (encoding && /^utf-?8$/iu.test(encoding)) {
      const tail = decoder.decode();
      if (tail.length > 0) stdin.emit('data', tail);
    }
    endEmitted = true;
    stdin.emit('end');
  }
  const push = (data: string | Uint8Array): void => {
    if (eofReceived) return;
    pending.push(data);
    flush();
  };
  const end = (): void => {
    if (eofReceived) return;
    eofReceived = true;
    syncKeepalive();
    flush();
  };

  Object.assign(stdin, {
    isTTY,
    fd: 0,
    setEncoding(next: string | null) {
      const requested = next ?? 'utf8';
      if (!/^utf-?8$/iu.test(requested)) {
        throw new NotImplementedError(`process.stdin.setEncoding('${requested}')`);
      }
      if (encoding === 'utf8') return stdin;
      encoding = 'utf8';
      decoder = new TextDecoder();
      return stdin;
    },
    resume() {
      explicitlyPaused = false;
      flowing = true;
      syncKeepalive();
      flush();
      return stdin;
    },
    pause() {
      explicitlyPaused = true;
      flowing = false;
      syncKeepalive();
      return stdin;
    },
  });
  if (port) {
    port.onmessage = (ev: MessageEvent): void => {
      const data = ev.data;
      if (typeof data === 'string' || data instanceof Uint8Array) push(data);
      else if (isStdinEofFrame(data)) end();
    };
    port.start();
  }
  return { stdin, push };
}

function isStdinEofFrame(value: unknown): value is { readonly kind: 'stdin:eof' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === 'stdin:eof'
  );
}

interface ProcessTerminalBootstrap {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly cols: number;
  readonly rows: number;
}

function processTerminalBootstrap(launch: NodeEntryLaunch | undefined): ProcessTerminalBootstrap {
  if (launch !== undefined) {
    const terminal = launch.kind === 'worker-thread' ? undefined : launch.terminal;
    return (
      terminal ?? {
        stdinIsTTY: false,
        stdoutIsTTY: false,
        stderrIsTTY: false,
        cols: 80,
        rows: 24,
      }
    );
  }
  return {
    stdinIsTTY: false,
    stdoutIsTTY: false,
    stderrIsTTY: false,
    cols: 80,
    rows: 24,
  };
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
  execArgv: string[] = [];
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
  declare readonly release: NodeProcessRelease;
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
  send?: (message: unknown, ...unsupported: unknown[]) => boolean;
  disconnect?: () => void;
  connected?: boolean;
  channel?: ReturnType<typeof nodeIpcChannel> | null;

  readonly #stdinPush: (data: string | Uint8Array) => void;
  #ipcPort: MessagePort | null = null;
  #ipcDisconnected = false;
  #controlClosed = false;
  #publicIpc = false;
  #jsonIpc = false;
  #ipcKeepaliveHeld = false;
  readonly #workerMessageListeners = new Set<(message: unknown) => void>();
  readonly #workerIpcBacklog: unknown[] = [];
  #latestTtyControlSize: { readonly cols: number; readonly rows: number } | null = null;
  #descendantAuthority: NodeProcessDescendantAuthority | null = null;
  // Frames received before any `'message'` listener attaches (ADR-0045) — flushed
  // in order on the first listener; mirrors makeStdinReader's pending buffer.
  readonly #ipcBacklog: unknown[] = [];

  constructor(spec?: KernelProcessSpec) {
    super();
    Object.defineProperty(this, 'release', {
      value: createNodeProcessRelease(),
      writable: false,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(this, NODE_PROCESS_TERMINAL_BOOTSTRAP, {
      value: (terminal: unknown): void => this.#applyTerminalBootstrap(terminal),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    Object.defineProperty(this, NODE_PROCESS_LISTENING_CONTROL, {
      value: (ports: unknown, previewScope: unknown): void =>
        this.#postListeningControl(ports, previewScope),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    Object.defineProperty(this, NODE_PROCESS_WORKER_IPC, {
      value: (): NodeProcessWorkerIpc => ({
        send: (message) => this.#sendWorkerMessage(message),
        onMessage: (listener) => {
          this.#workerMessageListeners.add(listener);
          if (this.#workerIpcBacklog.length > 0) {
            setTimeout(() => {
              for (const message of this.#workerIpcBacklog.splice(0)) {
                for (const current of [...this.#workerMessageListeners]) current(message);
              }
            }, 0);
          }
          return () => this.#workerMessageListeners.delete(listener);
        },
      }),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    Object.defineProperty(this, NODE_PROCESS_DESCENDANT_AUTHORITY, {
      value: (authority: unknown): void => this.#bindDescendantAuthority(authority),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    Object.defineProperty(this, NODE_PROCESS_BOOTSTRAP_IDENTITY, {
      value: (): { readonly pid: number; readonly ppid: number } | null =>
        readNodeProcessBootstrapIdentity(this),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    if (spec) {
      attachNodeProcessBootstrapIdentity(this, spec);
      installProcessExitErrorTrap();
      this.pid = spec.pid;
      this.ppid = spec.ppid;
      this.argv = [...spec.argv];
      const launch = readNodeEntryBootstrapIfPresent()?.launch;
      this.execArgv = launch?.kind === 'eval' ? [...launch.execArgv] : [];
      // Copy so per-process env mutation does not leak into the published
      // Readonly spec (the kernel threads spec.env by reference).
      this.env = { ...spec.env };
      currentCwd = spec.cwd;
      const terminal = processTerminalBootstrap(launch);
      const size = { cols: terminal.cols, rows: terminal.rows };
      this.stdout = makeStdioWriter(spec.stdio.stdout, 1, terminal.stdoutIsTTY, size);
      this.stderr = makeStdioWriter(spec.stdio.stderr, 2, terminal.stderrIsTTY, size);
      const reader = makeStdinReader(spec.stdio.stdin, terminal.stdinIsTTY);
      this.stdin = reader.stdin;
      this.#stdinPush = reader.push;
      if (
        launch?.kind === 'eval' ||
        (launch?.kind === 'program' && (launch.ipc ?? 'none') === 'none')
      ) {
        this.#wireControl(spec.stdio.ipc);
      } else if (launch?.kind === 'worker-thread') {
        this.#wireWorkerIpc(spec.stdio.ipc);
      } else {
        this.#publicIpc = true;
        this.#jsonIpc = launch?.kind === 'program';
        this.connected = true;
        this.channel = nodeIpcChannel('process');
        this.#wireIpc(spec.stdio.ipc);
      }
    } else {
      this.pid = 1;
      this.ppid = 0;
      this.argv = ['rifty', 'repl'];
      this.env = Object.create(null);
      this.stdout = Object.assign(new EventEmitter(), {
        write: (chunk: string | Uint8Array) => {
          console.log(chunk);
          return true;
        },
        isTTY: false,
        fd: 1,
      }) as NodeStdioWriter;
      this.stderr = Object.assign(new EventEmitter(), {
        write: (chunk: string | Uint8Array) => {
          console.error(chunk);
          return true;
        },
        isTTY: false,
        fd: 2,
      }) as NodeStdioWriter;
      const reader = makeStdinReader();
      this.stdin = reader.stdin;
      this.#stdinPush = reader.push;
    }
  }

  override addListener(event: string | symbol, listener: StdinListener): this {
    const result = super.addListener(event, listener);
    if (event === 'message') this.#syncIpcKeepalive();
    return result;
  }

  override prependListener(event: string | symbol, listener: StdinListener): this {
    const result = super.prependListener(event, listener);
    if (event === 'message') this.#syncIpcKeepalive();
    return result;
  }

  override removeListener(event: string | symbol, listener: StdinListener): this {
    const result = super.removeListener(event, listener);
    if (event === 'message') this.#syncIpcKeepalive();
    return result;
  }

  override removeAllListeners(event?: string | symbol): this {
    const result = super.removeAllListeners(event);
    if (event === undefined || event === 'message') this.#syncIpcKeepalive();
    return result;
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
    const exitCode = toUint8ExitCode(c);
    const exitError = Object.assign(new Error(`process.exit(${c})`), {
      code: RIFTY_PROCESS_EXIT,
      exitCode, // OS-style uint8 wrap (process.exit(257) → 1)
    });
    const evalLifecycleOwned = beginNodeEvalExplicitExit(exitError, () => {
      this.#requestSelfExit(exitCode);
      return exitError;
    });
    if (!evalLifecycleOwned && this.#ipcPort !== null) this.#requestSelfExit(exitCode);
    throw exitError;
  }

  kill(pid: number, signal = 'SIGTERM'): boolean {
    if (pid !== this.pid || signal !== 'SIGUSR2') {
      throw new NotImplementedError(
        'process.kill',
        'only process.kill(process.pid, "SIGUSR2") is implemented',
      );
    }
    return this.#requestSelfSignal(signal);
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
      const frame = this.#receiveControlFrame(ev.data);
      if (frame === null) return;
      if (frame.kind === 'ipc:message') {
        if (this.#ipcDisconnected) return;
        const payload = this.#jsonIpc ? serializeNodeIpcMessage(frame.payload) : frame.payload;
        if (this.listenerCount('message') === 0) {
          this.#ipcBacklog.push(payload);
        } else {
          this.emit('message', payload);
        }
      } else if (frame.kind === 'ipc:tty-resize') {
        this.#resizeTty(frame.cols, frame.rows);
      } else if (frame.kind === 'ipc:disconnect') {
        this.#disconnectIpc();
      } else if (frame.kind === 'control:signal') {
        this.#receiveSignal(frame.signal);
      } else if (frame.kind === 'control:kill-tree') {
        this.#killDescendant(frame.pid, frame.signal);
      } else {
        this.#rejectControlFrame();
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

    this.send = (message: unknown, ...unsupported: unknown[]): boolean => {
      if (unsupported.length > 0) throw new NotImplementedError('process.send.arguments');
      if (this.#ipcDisconnected) return false;
      const payload = this.#jsonIpc ? serializeNodeIpcMessage(message) : message;
      try {
        const frame: IpcFrame = { kind: 'ipc:message', payload };
        port.postMessage(frame);
        return true;
      } catch {
        // Port may have been detached by the parent — treat as disconnect.
        this.#closeControl();
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
      this.#disconnectIpc();
    };
  }

  /** Control-only lane for a plain spawn: no public process.send/disconnect. */
  #wireControl(port: MessagePort): void {
    this.#ipcPort = port;
    port.onmessage = (event: MessageEvent): void => {
      const frame = this.#receiveControlFrame(event.data);
      if (frame === null) return;
      if (frame.kind === 'ipc:tty-resize') {
        this.#resizeTty(frame.cols, frame.rows);
      } else if (frame.kind === 'control:signal') {
        this.#receiveSignal(frame.signal);
      } else if (frame.kind === 'control:kill-tree') {
        this.#killDescendant(frame.pid, frame.signal);
      } else {
        this.#rejectControlFrame();
      }
    };
    port.start();
  }

  /** Structured-clone worker_threads lane with no public process IPC surface. */
  #wireWorkerIpc(port: MessagePort): void {
    this.#ipcPort = port;
    port.onmessage = (event: MessageEvent): void => {
      const frame = this.#receiveControlFrame(event.data);
      if (frame === null) return;
      if (frame.kind === 'ipc:message') {
        if (this.#workerMessageListeners.size === 0) this.#workerIpcBacklog.push(frame.payload);
        else {
          for (const listener of [...this.#workerMessageListeners]) listener(frame.payload);
        }
      } else if (frame.kind === 'ipc:tty-resize') {
        this.#resizeTty(frame.cols, frame.rows);
      } else if (frame.kind === 'control:signal') {
        this.#receiveSignal(frame.signal);
      } else if (frame.kind === 'control:kill-tree') {
        this.#killDescendant(frame.pid, frame.signal);
      } else {
        this.#rejectControlFrame();
      }
    };
    port.start();
  }

  #sendWorkerMessage(message: unknown): boolean {
    if (this.#controlClosed || this.#ipcPort === null) return false;
    try {
      this.#ipcPort.postMessage({ kind: 'ipc:message', payload: message } satisfies IpcFrame);
      return true;
    } catch {
      this.#closeControl();
      return false;
    }
  }

  #receiveSignal(signal: string): void {
    if (signal !== 'SIGUSR2') {
      throw new NotImplementedError('process.signal', `signal ${signal} is not implemented`);
    }
    if (this.listenerCount(signal) === 0) {
      this.#requestSelfSignal(signal);
      return;
    }
    this.emit(signal);
  }

  #requestSelfSignal(signal: string): boolean {
    if (this.#controlClosed || this.#ipcPort === null) return false;
    try {
      this.#ipcPort.postMessage({ kind: 'control:self-signal', signal } satisfies IpcFrame);
      return true;
    } catch {
      this.#closeControl();
      return false;
    }
  }

  #requestSelfExit(code: number): void {
    if (this.#controlClosed || this.#ipcPort === null) {
      throw new Error('process exit requires an active control port');
    }
    try {
      this.#ipcPort.postMessage({ kind: 'control:self-exit', code } satisfies IpcFrame);
    } catch (error) {
      this.#closeControl();
      throw error;
    }
  }

  #receiveControlFrame(value: unknown): IpcFrame | null {
    try {
      return decodeIpcFrame(value);
    } catch {
      this.#rejectControlFrame();
      return null;
    }
  }

  #rejectControlFrame(): void {
    this.#requestSelfExit(1);
  }

  #killDescendant(pid: number, signal: string): void {
    const authority = this.#descendantAuthority ?? globalProcessManager;
    // Absence proves a federated descendant is already physically retired.
    if (!authority.kill(pid, signal) && authority.snapshot().some((row) => row.pid === pid)) {
      throw new Error(`process control could not kill descendant PID ${pid}`);
    }
  }

  #bindDescendantAuthority(authority: unknown): void {
    if (this.#descendantAuthority !== null) {
      throw new Error('process descendant process authority is already bound');
    }
    if (typeof authority !== 'object' || authority === null) {
      throw new TypeError('process descendant authority must be an object');
    }
    const kill = Reflect.get(authority, 'kill');
    const snapshot = Reflect.get(authority, 'snapshot');
    if (typeof kill !== 'function' || typeof snapshot !== 'function') {
      throw new TypeError('process descendant authority requires kill() and snapshot()');
    }
    this.#descendantAuthority = Object.freeze({
      kill: (pid: number, signal: string): boolean =>
        Reflect.apply(kill, authority, [pid, signal]) as boolean,
      snapshot: (): readonly { readonly pid: number }[] =>
        Reflect.apply(snapshot, authority, []) as readonly { readonly pid: number }[],
    });
  }

  #resizeTty(cols: number, rows: number): void {
    if (!Number.isSafeInteger(cols) || cols <= 0 || !Number.isSafeInteger(rows) || rows <= 0) {
      throw new RangeError(`TTY resize must use positive integer cells; received ${cols}x${rows}`);
    }
    this.#latestTtyControlSize = { cols, rows };
    let changed = false;
    for (const stream of [this.stdout, this.stderr]) {
      if (!stream.isTTY || (stream.columns === cols && stream.rows === rows)) continue;
      stream.columns = cols;
      stream.rows = rows;
      changed = true;
      stream.emit('resize');
    }
    if (changed) this.emit('SIGWINCH');
  }

  #applyTerminalBootstrap(terminal: unknown): void {
    const snapshot = snapshotNodeEntryTerminalBootstrap(terminal, 'process terminal bootstrap');
    const size = this.#latestTtyControlSize ?? { cols: snapshot.cols, rows: snapshot.rows };
    this.stdin.isTTY = snapshot.stdinIsTTY;
    applyTtyShape(this.stdout, snapshot.stdoutIsTTY, size);
    applyTtyShape(this.stderr, snapshot.stderrIsTTY, size);
  }

  #postListeningControl(ports: unknown, previewScope: unknown): void {
    if (
      !Array.isArray(ports) ||
      ports.some(
        (port) => !Number.isSafeInteger(port) || (port as number) <= 0 || (port as number) > 65_535,
      ) ||
      new Set(ports).size !== ports.length
    ) {
      throw new TypeError('process listening control ports must be unique valid TCP ports');
    }
    if (
      previewScope !== undefined &&
      (typeof previewScope !== 'string' || previewScope.length === 0)
    ) {
      throw new TypeError('process listening control previewScope must be a non-empty string');
    }
    if (this.#controlClosed || this.#ipcPort === null) {
      throw new Error('process listening control channel is closed');
    }
    try {
      this.#ipcPort.postMessage({
        kind: 'control:listening',
        ports: [...(ports as number[])],
        ...(previewScope === undefined ? {} : { previewScope }),
      } satisfies IpcFrame);
    } catch (error) {
      this.#closeControl();
      throw error;
    }
  }

  #disconnectIpc(): void {
    if (this.#ipcDisconnected) return;
    this.#ipcDisconnected = true;
    this.#ipcBacklog.length = 0;
    this.#syncIpcKeepalive();
    if (this.#publicIpc) {
      this.connected = false;
      this.channel = null;
      this.emit('disconnect');
    }
  }

  #syncIpcKeepalive(): void {
    const shouldHold = this.#jsonIpc && !this.#ipcDisconnected && this.listenerCount('message') > 0;
    if (shouldHold === this.#ipcKeepaliveHeld) return;
    this.#ipcKeepaliveHeld = shouldHold;
    if (shouldHold) refEventLoop();
    else unrefEventLoop();
  }

  #closeControl(): void {
    if (this.#controlClosed) return;
    this.#controlClosed = true;
    try {
      this.#ipcPort?.close();
    } catch {
      /* peer may have closed */
    }
    this.#workerMessageListeners.clear();
    this.#workerIpcBacklog.length = 0;
    this.#disconnectIpc();
  }
}

/** Apply an exact entry envelope's PTY metadata before that entry runs user code. */
export function applyNodeProcessTerminalBootstrap(
  process: unknown,
  terminal: NodeEntryTerminalBootstrap,
): void {
  if ((typeof process !== 'object' && typeof process !== 'function') || process === null) {
    throw new TypeError('process terminal bootstrap target must be an object');
  }
  const receiver = Reflect.get(process, NODE_PROCESS_TERMINAL_BOOTSTRAP);
  if (typeof receiver !== 'function') {
    throw new TypeError('process terminal bootstrap target is not a runtime-owned NodeProcess');
  }
  (receiver as (value: unknown) => void)(terminal);
}

/** Runtime-host adapter: publish private listening state without guest IPC. */
export function postNodeProcessListeningControl(
  process: unknown,
  ports: readonly number[],
  previewScope?: string,
): void {
  if ((typeof process !== 'object' && typeof process !== 'function') || process === null) {
    throw new TypeError('process listening control target must be an object');
  }
  const receiver = Reflect.get(process, NODE_PROCESS_LISTENING_CONTROL);
  if (typeof receiver !== 'function') {
    throw new TypeError('process listening control target is not a runtime-owned NodeProcess');
  }
  (receiver as (value: unknown, scope: unknown) => void)(ports, previewScope);
}

/** Bind the private descendant manager before guest code (ADR-0334). */
export function bindNodeProcessDescendantAuthority(
  process: unknown,
  authority: NodeProcessDescendantAuthority,
): void {
  if ((typeof process !== 'object' && typeof process !== 'function') || process === null) {
    throw new TypeError('process descendant authority target must be an object');
  }
  const receiver = Reflect.get(process, NODE_PROCESS_DESCENDANT_AUTHORITY);
  if (typeof receiver !== 'function') {
    throw new TypeError('process descendant authority target is not a runtime-owned NodeProcess');
  }
  (receiver as (value: unknown) => void)(authority);
}

/**
 * Adopt the kernel bundle's spec-seeded process into this node-entry bundle.
 * One-shot before guest code (ADR-0334).
 */
export function adoptNodeProcessBootstrap(
  process: unknown,
  authority: NodeProcessDescendantAuthority,
): void {
  const active = readActiveNodeProcessBootstrap();
  if (active !== null) {
    if (active.process !== process || active.identity === null || !active.federated) {
      throw new Error('node process bootstrap is already adopted by another process');
    }
    bindNodeProcessDescendantAuthority(process, authority);
    return;
  }
  if ((typeof process !== 'object' && typeof process !== 'function') || process === null) {
    throw new TypeError('node process bootstrap target must be an object');
  }
  const identityReceiver = Reflect.get(process, NODE_PROCESS_BOOTSTRAP_IDENTITY);
  if (typeof identityReceiver !== 'function') {
    throw new TypeError('node process bootstrap target is not a runtime-owned NodeProcess');
  }
  const identity = (identityReceiver as () => unknown)();
  if (
    typeof identity !== 'object' ||
    identity === null ||
    !Number.isSafeInteger(Reflect.get(identity, 'pid')) ||
    (Reflect.get(identity, 'pid') as number) <= 0 ||
    !Number.isSafeInteger(Reflect.get(identity, 'ppid')) ||
    (Reflect.get(identity, 'ppid') as number) < 0
  ) {
    throw new TypeError('node process bootstrap target has no trusted process identity');
  }
  const pid = Reflect.get(identity, 'pid') as number;
  const ppid = Reflect.get(identity, 'ppid') as number;
  bindNodeProcessDescendantAuthority(process, authority);
  attachNodeProcessBootstrapIdentity(process, { pid, ppid });
  setActiveNodeProcessBootstrap(process, true);
}

export interface NodeProcessWorkerIpc {
  send(message: unknown): boolean;
  onMessage(listener: (message: unknown) => void): () => void;
}

/** Runtime-only worker_threads structured-clone lane; not guest process IPC. */
export function nodeProcessWorkerIpc(process: unknown): NodeProcessWorkerIpc {
  if ((typeof process !== 'object' && typeof process !== 'function') || process === null) {
    throw new TypeError('worker IPC target must be an object');
  }
  const receiver = Reflect.get(process, NODE_PROCESS_WORKER_IPC);
  if (typeof receiver !== 'function') {
    throw new TypeError('worker IPC target is not a runtime-owned NodeProcess');
  }
  return (receiver as () => NodeProcessWorkerIpc)();
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
  // A kernel-installed binding is realm-private authority. A later idempotent
  // call must not let a guest-replaced public global replace or downgrade it.
  if (readActiveNodeProcessBootstrap() !== null) return;
  const active = (globalThis as { process?: unknown }).process;
  if (active instanceof NodeProcess) {
    setActiveNodeProcessBootstrap(active);
    return;
  }
  patchPromiseForNextTick();
  (globalThis as unknown as { process: NodeProcess }).process = riftyProcess;
  setActiveNodeProcessBootstrap(riftyProcess);
  // `global === globalThis` via the single helper — Node's descriptor
  // (writable+enumerable+configurable), not a private non-enumerable alias.
  installGlobalAlias();
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
