/**
 * Run case code through the rifty module loader and capture stdout.
 *
 * Scope: the loader is the rifty path under test. Default modes do not replace
 * global `process` or `Promise.prototype.then`. Stdin/TTY/exec-sync modes install
 * an isolated worker-style process and restore its exact descriptor in `finally`.
 * Promise/nextTick behavior stays in conformance's controlled patch scope. The
 * parity runner temporarily mirrors the Worker's tracked timer globals so detached timer
 * chains participate in the real keepalive drain. It otherwise focuses on
 * module-shape semantics: `node:path`, `node:buffer`, `node:util`,
 * `node:querystring`, `node:events`, `node:url`, etc.
 *
 * Console is replaced for the duration of the case, then restored.
 */
import { Worker } from 'node:worker_threads';
import {
  NodeProcess,
  applyNodeProcessTerminalBootstrap,
  getProcessCwd,
  setProcessCwd,
} from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import type { TransformSourceHook } from '@riftydev/runtime-js/loader';
import { asyncVfs, syncMirror } from '@riftydev/vfs';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { transform as transformWithHostEsbuild } from 'esbuild';
import { refreshRuntimeJsProcessBuiltin } from '../../../packages/runtime-js/src/builtins/index.ts';
import type { NodeEntryBootstrapPayload } from '../../../packages/runtime-js/src/builtins/node-entry-url.ts';
// vm-engine relative source imports (same `tools/`-harness precedent as
// `formatArgs` below): `setVmEngineOverride` lets the runner reset the engine
// selection between cases, and `ensureVmEngineReady` preloads the QuickJS WASM
// module once so a case opting into the `quickjs` engine (via
// `globalThis.__RIFTY_VM_ENGINE`) can run `vm.*` SYNCHRONOUSLY (the engine reads
// `getQuickJsModuleSync()`). Both are memoised/idempotent — one-time cost.
import { setVmEngineOverride } from '../../../packages/runtime-js/src/builtins/vm/engine-config.ts';
import { ensureVmEngineReady } from '../../../packages/runtime-js/src/builtins/vm/quickjs-loader.ts';
import {
  awaitDrain,
  resetKeepalive,
} from '../../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import { formatArgs } from '../../../packages/runtime-js/src/repl/inspect.ts';
import { type ParityCase, caseCwd } from './types.ts';

/**
 * Normalised shape returned by the injected `__riftyHttpRequest` driver. Both
 * the Node-side (real `http.request`) and the rifty-side (`dispatchToPort`)
 * implementations resolve to this shape so the case `code` can be byte-for-byte
 * identical across runtimes. Mirrored on the Node side in `run-in-node.ts`.
 */
interface RiftyHttpResponse {
  status: number;
  statusText: string;
  contentType: string | null;
  body: string;
}

declare global {
  // `var` is required for a global augmentation — `const`/`let` are not allowed
  // in `declare global`. Injected by `installHttpMode`, cleared on teardown.
  var __riftyHttpRequest:
    | ((port: number, path: string, init?: RequestInit) => Promise<RiftyHttpResponse>)
    | undefined;
  /** Injected only for the OS-PTY/process-control parity case. */
  var __riftyTtyResize: ((cols: number, rows: number) => void) | undefined;
}

const TIMER_GLOBAL_KEYS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
] as const;

type Cleanup = () => void;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Fault-safe LIFO ownership for the process-global resources used by one case. */
class CleanupStack {
  readonly #entries: Cleanup[] = [];
  #disposed = false;

  defer(cleanup: Cleanup): void {
    if (this.#disposed) throw new Error('cannot acquire a resource after cleanup');
    this.#entries.push(cleanup);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const errors: Error[] = [];
    while (this.#entries.length > 0) {
      try {
        this.#entries.pop()?.();
      } catch (error) {
        errors.push(asError(error));
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'parity harness cleanup failed');
  }
}

const NO_FAILURE = Symbol('no parity case failure');

function disposePreservingFailure(
  cleanups: CleanupStack,
  failure: unknown | typeof NO_FAILURE,
): void {
  try {
    cleanups.dispose();
  } catch (cleanupError) {
    if (failure === NO_FAILURE) throw cleanupError;
    const cleanupErrors =
      cleanupError instanceof AggregateError
        ? cleanupError.errors.map(asError)
        : [asError(cleanupError)];
    throw new AggregateError(
      [asError(failure), ...cleanupErrors],
      'parity case failed and cleanup also failed',
    );
  }
}

/** Mirror worker bootstrap timers for one case, then restore the harness realm exactly. */
function installCaseTimerGlobals(): () => void {
  const previous = TIMER_GLOBAL_KEYS.map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
  }));
  const cleanups = new CleanupStack();
  for (const { key, descriptor } of previous) {
    cleanups.defer(() => restoreGlobalDescriptor(key, descriptor));
  }
  let failure: unknown | typeof NO_FAILURE = NO_FAILURE;
  try {
    installTimerGlobals();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (failure !== NO_FAILURE) disposePreservingFailure(cleanups, failure);
  }
  return () => cleanups.dispose();
}

function restoreGlobalDescriptor(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

interface SeededProcessMode {
  feedStdin(chunks: readonly Uint8Array[]): Promise<void>;
  writeConsoleStdout(text: string): void;
  writeConsoleStderr(text: string): void;
  drainStdio(): Promise<void>;
  stdoutText(): string;
  teardown(): void;
}

const STDIO_DRAIN_KIND = 'rifty:parity-stdio-drain';

interface StdioDrainFrame {
  readonly kind: typeof STDIO_DRAIN_KIND;
  readonly id: number;
}

function isStdioDrainFrame(value: unknown): value is StdioDrainFrame {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StdioDrainFrame>;
  return candidate.kind === STDIO_DRAIN_KIND && Number.isSafeInteger(candidate.id);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const chunk of chunks) size += chunk.byteLength;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Own one stdio peer: collect bytes FIFO and prove the queue drained before close. */
class StdioPortCapture {
  readonly #chunks: Uint8Array[] = [];
  readonly #source: MessagePort;
  readonly #peer: MessagePort;
  readonly #label: 'stdout' | 'stderr';
  #drainId = 0;
  #drained = false;
  #fault: Error | undefined;
  #pending:
    | {
        readonly id: number;
        readonly resolve: () => void;
        readonly reject: (error: Error) => void;
      }
    | undefined;

  constructor(source: MessagePort, peer: MessagePort, label: 'stdout' | 'stderr') {
    this.#source = source;
    this.#peer = peer;
    this.#label = label;
  }

  start(): void {
    this.#peer.onmessage = (event: MessageEvent): void => {
      const value = event.data;
      if (value instanceof Uint8Array) {
        this.#chunks.push(new Uint8Array(value));
        return;
      }
      if (isStdioDrainFrame(value) && value.id === this.#pending?.id) {
        const pending = this.#pending;
        this.#pending = undefined;
        this.#drained = true;
        pending.resolve();
        return;
      }
      this.#fail(new TypeError(`rifty parity ${this.#label} port received a malformed frame`));
    };
    this.#peer.onmessageerror = (): void => {
      this.#fail(new Error(`rifty parity ${this.#label} port could not deserialize a frame`));
    };
    this.#peer.start();
  }

  drain(): Promise<void> {
    if (this.#fault) return Promise.reject(this.#fault);
    if (this.#drained) return Promise.resolve();
    if (this.#pending) {
      return Promise.reject(new Error(`rifty parity ${this.#label} drain already pending`));
    }
    return new Promise<void>((resolve, reject) => {
      const id = ++this.#drainId;
      this.#pending = { id, resolve, reject };
      try {
        this.#source.postMessage({ kind: STDIO_DRAIN_KIND, id } satisfies StdioDrainFrame);
      } catch (error) {
        this.#pending = undefined;
        const fault = asError(error);
        this.#fault = fault;
        reject(fault);
      }
    });
  }

  bytes(): Uint8Array {
    if (!this.#drained) throw new Error(`rifty parity ${this.#label} read before drain`);
    return concatBytes(this.#chunks);
  }

  dispose(): void {
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.reject(new Error(`rifty parity ${this.#label} drain cancelled during teardown`));
    this.#peer.onmessage = null;
    this.#peer.onmessageerror = null;
  }

  #fail(error: Error): void {
    this.#fault ??= error;
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.reject(this.#fault);
  }
}

export interface RunInRiftyOptions {
  /** Same-realm fault-injection seam for the browser MessageChannel boundary. */
  readonly createMessageChannel?: () => MessageChannel;
  /** Receiver-side deadline for processing the stdin EOF transport frame. */
  readonly stdinTimeoutMs?: number;
  /** Parent-owned execution deadline; settlement still awaits Worker termination. */
  readonly caseTimeoutMs?: number;
}

const DEFAULT_STDIN_TIMEOUT_MS = 2_000;
const DEFAULT_CASE_TIMEOUT_MS = 30_000;
const HOST_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const HOST_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);

interface SerializedWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

type RiftyWorkerResponse =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly error: SerializedWorkerError };

function timeoutMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer; received ${value}`);
  }
  return value;
}

function isPhysicalWorkerCase(testCase: ParityCase): boolean {
  return testCase.kind === 'worker-env' || testCase.kind === 'child-worker';
}

function expectedPhysicalWorkerCount(testCase: ParityCase): number {
  const count = testCase.expectedPhysicalWorkers;
  if (!Number.isSafeInteger(count) || (count as number) <= 0) {
    throw new TypeError('physical Worker parity requires a positive expectedPhysicalWorkers');
  }
  return count as number;
}

function isSeededProcessCase(testCase: ParityCase): boolean {
  return (
    testCase.stdin !== undefined || isPhysicalWorkerCase(testCase) || testCase.kind === 'tty-resize'
  );
}

function isStdinEofFrame(value: unknown): value is { readonly kind: 'stdin:eof' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === 'stdin:eof'
  );
}

/** One isolated worker-style process for stdin/TTY cases; owns every port/global it installs. */
function installSeededProcessMode(
  cwd: string,
  tty: boolean,
  createMessageChannel: () => MessageChannel,
  stdinTimeoutMs: number,
): SeededProcessMode {
  const priorProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const priorResize = Object.getOwnPropertyDescriptor(globalThis, '__riftyTtyResize');
  const priorCwd = getProcessCwd();
  const cleanups = new CleanupStack();
  // Registered before acquisition so partial MessageChannel construction still
  // restores the ambient realm. Each step is independent: one teardown fault
  // cannot suppress port closure or the remaining global restores.
  cleanups.defer(() => refreshRuntimeJsProcessBuiltin());
  cleanups.defer(() => setProcessCwd(priorCwd));
  cleanups.defer(() => restoreGlobalDescriptor('__riftyTtyResize', priorResize));
  cleanups.defer(() => restoreGlobalDescriptor('process', priorProcess));

  const ownChannel = (): MessageChannel => {
    const channel = createMessageChannel();
    cleanups.defer(() => channel.port1.close());
    cleanups.defer(() => channel.port2.close());
    return channel;
  };

  let stdout: MessageChannel;
  let stderr: MessageChannel;
  let stdin: MessageChannel;
  let ipc: MessageChannel;
  let stdoutCapture: StdioPortCapture;
  let stderrCapture: StdioPortCapture;
  let seeded: NodeProcess | undefined;
  let cancelFeed: (() => void) | undefined;
  let acknowledgeFeed: (() => void) | undefined;
  let feedStarted = false;
  let failure: unknown | typeof NO_FAILURE = NO_FAILURE;

  try {
    stdout = ownChannel();
    stdoutCapture = new StdioPortCapture(stdout.port1, stdout.port2, 'stdout');
    cleanups.defer(() => stdoutCapture.dispose());
    stdoutCapture.start();
    stderr = ownChannel();
    stderrCapture = new StdioPortCapture(stderr.port1, stderr.port2, 'stderr');
    cleanups.defer(() => stderrCapture.dispose());
    stderrCapture.start();
    stdin = ownChannel();
    ipc = ownChannel();
    seeded = new NodeProcess({
      pid: 2,
      ppid: 1,
      argv: ['node', '/work/main.js'],
      env: {},
      cwd,
      stdio: {
        stdout: {
          write: (bytes) => stdout.port1.postMessage(bytes),
        },
        stderr: {
          write: (bytes) => stderr.port1.postMessage(bytes),
        },
        stdin: stdin.port1,
        ipc: ipc.port1,
      },
    });
    if (tty) {
      applyNodeProcessTerminalBootstrap(seeded, {
        stdinIsTTY: true,
        stdoutIsTTY: true,
        stderrIsTTY: true,
        cols: 80,
        rows: 24,
      });
    }
    // The runtime's receiver was installed by NodeProcess above. Register the
    // harness ACK second on the hidden transport port, so EOF is acknowledged
    // only after the runtime receiver processed the frame. Never observe feed
    // completion through public process.stdin listeners: listenerCount(),
    // removeAllListeners(), and removeListener meta-events belong to the guest.
    const onStdinFrameProcessed = (event: MessageEvent): void => {
      if (isStdinEofFrame(event.data)) acknowledgeFeed?.();
    };
    stdin.port1.addEventListener('message', onStdinFrameProcessed);
    cleanups.defer(() => stdin.port1.removeEventListener('message', onStdinFrameProcessed));
    cleanups.defer(() => {
      seeded?.removeAllListeners();
      seeded?.stdout.removeAllListeners();
      seeded?.stderr.removeAllListeners();
      seeded?.stdin.removeAllListeners();
    });
    Object.defineProperty(globalThis, 'process', {
      value: seeded,
      writable: true,
      enumerable: priorProcess?.enumerable ?? false,
      configurable: true,
    });
    if (tty) {
      Object.defineProperty(globalThis, '__riftyTtyResize', {
        value: (cols: number, rows: number): void => {
          ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols, rows });
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    refreshRuntimeJsProcessBuiltin();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (failure !== NO_FAILURE) disposePreservingFailure(cleanups, failure);
  }

  let tornDown = false;
  cleanups.defer(() => cancelFeed?.());
  return {
    feedStdin(chunks): Promise<void> {
      if (!seeded) return Promise.reject(new Error('seeded process is unavailable'));
      if (tornDown) return Promise.reject(new Error('seeded process is already torn down'));
      if (feedStarted) return Promise.reject(new Error('seeded process stdin was already fed'));
      feedStarted = true;
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timers: { feed?: ReturnType<typeof setTimeout> } = {};
        const settle = (error?: unknown): void => {
          if (settled) return;
          settled = true;
          if (timers.feed !== undefined) HOST_CLEAR_TIMEOUT(timers.feed);
          acknowledgeFeed = undefined;
          cancelFeed = undefined;
          if (error === undefined) resolve();
          else reject(asError(error));
        };
        acknowledgeFeed = () => settle();
        cancelFeed = () => settle(new Error('rifty stdin parity feed cancelled during teardown'));
        timers.feed = HOST_SET_TIMEOUT(
          () =>
            settle(
              new Error(
                `rifty stdin parity transport did not process EOF within ${stdinTimeoutMs}ms`,
              ),
            ),
          stdinTimeoutMs,
        );
        try {
          for (const chunk of chunks) stdin.port2.postMessage(chunk);
          stdin.port2.postMessage({ kind: 'stdin:eof' });
        } catch (error) {
          settle(error);
        }
      });
    },
    writeConsoleStdout(text): void {
      if (!seeded) throw new Error('seeded process is unavailable');
      seeded.stdout.write(text);
    },
    writeConsoleStderr(text): void {
      if (!seeded) throw new Error('seeded process is unavailable');
      seeded.stderr.write(text);
    },
    async drainStdio(): Promise<void> {
      await Promise.all([stdoutCapture.drain(), stderrCapture.drain()]);
    },
    stdoutText(): string {
      return new TextDecoder().decode(stdoutCapture.bytes());
    },
    teardown(): void {
      if (tornDown) return;
      tornDown = true;
      cleanups.dispose();
    },
  };
}

/**
 * Install (and uninstall) the opt-in `kind: 'http'` net-registration mode.
 *
 * Returns a teardown that removes the injected global and unregisters any ports
 * the case bound, so the process-wide port registry does not leak state across
 * cases. Importing `@riftydev/net/register-builtins` is a side-effecting forward
 * import that plugs the `node:http` / `node:net` / `node:https` factories into
 * the shared `@riftydev/io` builtin registry — this is what makes
 * `require('node:http')` resolve on the rifty side.
 */
async function installHttpMode(): Promise<() => void> {
  await import('@riftydev/net/register-builtins');
  const { dispatchToPort, listPorts, unregisterPort } = await import('@riftydev/net/registry');
  // The cross-realm bind-claim (ADR-0186) defers `listen()`'s `'listening'`/cb by
  // a window so a sibling realm can deny. The parity harness is single-realm (no
  // denier), and these cases issue the request INSIDE the listen callback — run
  // the claim at 0 so the cb fires within the harness host-timer grace instead of
  // after `__riftyHttpRequest` is cleared. Restored on teardown.
  const { getDefaultClaimWindowMs, setDefaultClaimWindowMs, releasePort } = await import(
    '@riftydev/net'
  );
  const prevClaimWindow = getDefaultClaimWindowMs();
  const priorRequest = Object.getOwnPropertyDescriptor(globalThis, '__riftyHttpRequest');
  const priorPorts = new Set(listPorts());
  const cleanups = new CleanupStack();
  cleanups.defer(() => setDefaultClaimWindowMs(prevClaimWindow));
  cleanups.defer(() => restoreGlobalDescriptor('__riftyHttpRequest', priorRequest));
  cleanups.defer(() => {
    // Only this case's binds are owned here. A pre-existing registry entry is
    // ambient harness state and must survive an HTTP parity case unchanged.
    for (const port of listPorts()) {
      if (priorPorts.has(port)) continue;
      releasePort(port);
      unregisterPort(port);
    }
  });
  let failure: unknown | typeof NO_FAILURE = NO_FAILURE;
  try {
    setDefaultClaimWindowMs(0);
    globalThis.__riftyHttpRequest = async (port, path, init) => {
      const resp = await dispatchToPort(
        port,
        new Request(`http://preview.local:${port}${path}`, init),
      );
      return {
        status: resp.status,
        statusText: resp.statusText,
        contentType: resp.headers.get('content-type'),
        body: await resp.text(),
      };
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (failure !== NO_FAILURE) disposePreservingFailure(cleanups, failure);
  }
  return () => cleanups.dispose();
}

/**
 * Install the opt-in `kind: 'sqlite'` `node:sqlite` registration mode (ADR-0065).
 *
 * Mirrors {@link installHttpMode} for `@riftydev/net`'s `node:http`: the side-
 * effecting forward import of `@riftydev/net/sqlite/register-builtins` plugs the
 * sql.js-backed `DatabaseSync` factory into the shared `@riftydev/io` builtin
 * registry so `require('node:sqlite')` resolves on the rifty side. It THEN
 * awaits `initSqliteEngine()` — the synchronous `DatabaseSync` constructor the
 * case `code` calls needs the WASM engine already brought up (the one async
 * step the otherwise-synchronous surface depends on, ADR-0065 D1). There is no
 * teardown: the registry factory is process-wide and idempotent, and the engine
 * bring-up is memoised, so leaving both in place is correct across cases.
 */
async function installSqliteMode(): Promise<void> {
  await import('@riftydev/net/sqlite/register-builtins');
  const { initSqliteEngine } = await import('@riftydev/net/sqlite/engine');
  await initSqliteEngine();
}

/**
 * Physical kernel-backed Worker mode for ADR-0267 env parity.
 *
 * The normal parity runner intentionally uses runtime-js's same-realm fallback;
 * that fallback has no separate process realm and therefore cannot prove exact
 * inherited/replacement `process.env` or the typed host-bootstrap boundary. This
 * mode adapts a real native Node Worker to the kernel's DOM WorkerLike seam, then
 * lets production spawn/lifecycle/process code create the child. It runs inside
 * the runner's disposable outer Worker so every process-global binding is
 * discarded after the case.
 */
async function installPhysicalWorkerMode(testCase: ParityCase): Promise<() => void> {
  const { getKernelWorkerUrl, setKernelWorkerUrl } = await import(
    '../../../packages/kernel/src/index.ts'
  );
  const { clearKernelWorkerUrl, clearWorkerFactoryForTests, setWorkerFactoryForTests } =
    await import('../../../packages/kernel/src/spawn-worker.ts');
  const { NODE_ENTRY_BOOTSTRAP_PROTOCOL, configureNodeEntryWorker, resetNodeEntryWorkerUrl } =
    await import('../../../packages/runtime-js/src/builtins/node-entry-url.ts');
  type WorkerLike = import('../../../packages/kernel/src/spawn-worker.ts').WorkerLike;
  type WorkerInitMessage = import('../../../packages/kernel/src/worker-entry.ts').WorkerInitMessage;
  let nativeWorkerConstructions = 0;
  let validatedInitMessages = 0;
  const expectedLaunchKind = testCase.kind === 'child-worker' ? 'program' : 'worker-thread';
  const expectedWorkers = expectedPhysicalWorkerCount(testCase);

  function validateInitMessage(message: unknown): void {
    const init = message as Partial<WorkerInitMessage> | null;
    const entry = init?.spec?.entry;
    if (init?.type !== 'init' || entry?.kind !== 'url') {
      throw new TypeError('physical-worker parity requires a URL kernel init message');
    }
    const envelope = entry.bootstrap;
    if (envelope?.protocol !== NODE_ENTRY_BOOTSTRAP_PROTOCOL) {
      throw new TypeError('physical-worker parity requires typed node-entry bootstrap');
    }
    const payload = envelope.payload as Partial<NodeEntryBootstrapPayload> | null;
    if (
      payload?.launch?.kind !== expectedLaunchKind ||
      payload.hostRuntime?.RIFTY_PARITY_HOST_BOOTSTRAP !== 'host-only'
    ) {
      throw new TypeError('physical-worker parity init has wrong launch or host marker');
    }
    validatedInitMessages++;
  }

  class NativeKernelWorkerAdapter implements WorkerLike {
    readonly #worker: Worker;
    readonly #listeners = new Map<
      (event: MessageEvent) => void,
      { readonly type: string; readonly wrapped: (...args: unknown[]) => void }
    >();

    constructor() {
      nativeWorkerConstructions++;
      this.#worker = new Worker(new URL('./worker-env-kernel-worker.ts', import.meta.url), {
        execArgv: ['--import', 'tsx'],
        workerData: { files: testCase.setup?.files ?? {} },
      });
    }

    postMessage(message: unknown, transfer: ReadonlyArray<Transferable> = []): void {
      validateInitMessage(message);
      this.#worker.postMessage(message, transfer as never);
    }

    terminate(): void {
      void this.#worker.terminate();
    }

    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
      const wrapped =
        type === 'message'
          ? (value: unknown) => listener({ data: value } as MessageEvent)
          : (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              listener({ data: undefined, message, error } as unknown as MessageEvent);
            };
      this.#listeners.set(listener, { type, wrapped });
      if (type === 'message') this.#worker.on('message', wrapped);
      else if (type === 'error') this.#worker.on('error', wrapped);
      else if (type === 'messageerror') this.#worker.on('messageerror', wrapped);
      else throw new TypeError(`worker-env adapter does not support ${type}`);
    }

    removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
      const installed = this.#listeners.get(listener);
      if (installed === undefined || installed.type !== type) return;
      this.#listeners.delete(listener);
      if (type === 'message') this.#worker.off('message', installed.wrapped);
      else if (type === 'error') this.#worker.off('error', installed.wrapped);
      else if (type === 'messageerror') this.#worker.off('messageerror', installed.wrapped);
    }
  }

  const previousProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousCrossOriginDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'crossOriginIsolated',
  );
  const previousKernelWorkerUrl = getKernelWorkerUrl();
  const previousCwd = getProcessCwd();
  const cleanups = new CleanupStack();
  let failure: unknown | typeof NO_FAILURE = NO_FAILURE;

  try {
    cleanups.defer(() => {
      if (
        nativeWorkerConstructions !== expectedWorkers ||
        validatedInitMessages !== expectedWorkers
      ) {
        throw new Error(
          `physical-worker parity expected ${expectedWorkers} typed-bootstrap Workers; constructed ${nativeWorkerConstructions}, initialized ${validatedInitMessages}`,
        );
      }
    });
    cleanups.defer(clearWorkerFactoryForTests);
    cleanups.defer(resetNodeEntryWorkerUrl);
    cleanups.defer(() => {
      if (previousKernelWorkerUrl === null) clearKernelWorkerUrl();
      else setKernelWorkerUrl(previousKernelWorkerUrl);
    });
    cleanups.defer(() =>
      restoreGlobalDescriptor('crossOriginIsolated', previousCrossOriginDescriptor),
    );
    cleanups.defer(() => setProcessCwd(previousCwd));
    cleanups.defer(() => refreshRuntimeJsProcessBuiltin());
    cleanups.defer(() => restoreGlobalDescriptor('process', previousProcessDescriptor));

    const parentProcess = new NodeProcess();
    parentProcess.env = Object.create(null) as Record<string, string | undefined>;
    Object.defineProperty(globalThis, 'process', {
      value: parentProcess,
      writable: true,
      configurable: true,
      enumerable: previousProcessDescriptor?.enumerable ?? false,
    });
    refreshRuntimeJsProcessBuiltin();
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      configurable: true,
    });
    setKernelWorkerUrl('parity://kernel-worker');
    configureNodeEntryWorker('parity://node-entry', {
      RIFTY_PARITY_HOST_BOOTSTRAP: 'host-only',
    });
    setWorkerFactoryForTests(() => new NativeKernelWorkerAdapter());
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (failure !== NO_FAILURE) disposePreservingFailure(cleanups, failure);
  }

  return () => cleanups.dispose();
}

/**
 * Install the opt-in `kind: 'exec-sync'` mode (ADR-0084 #23, ADR-0137).
 * `execSync` is SAB-only by design (ADR-0011 removed the in-realm fallback as a
 * silent stub), so the default loader path throws `NotImplementedError`. To
 * exercise the v2 binary-frame round-trip head-to-head against real Node's
 * byte-exact `execSync`, this wires a REAL kernel `SabRing` + the genuine
 * encode/decodeReply framing and a SYNCHRONOUS in-realm child runner that
 * captures stdout BYTES, then publishes the `__riftyKernelSyncCall` shim the
 * runtime-js `execSync` reads.
 *
 * The child runner LOADER-RUNS the script through the REAL rifty module loader
 * (ADR-0137) — `loader.require` for a CJS entry — so the child's `#!` shebang is
 * stripped (the resolver's strip, `resolver.ts`), its relative `require('./x')`
 * resolves against the sync mirror, and a sibling `fs.readFileSync('./y')` reads
 * the mirror (the rifty `node:fs` builtin). This is the same loader path the
 * browser `kind:'url'` child uses — the OLD `new Function` runner could do NONE
 * of these (it threw on `#!`, could not resolve relatives), so it silently
 * diverged from real Node for any shebang'd / relative-import child. Closing
 * that is the whole point of this item (Fidelity).
 *
 * Synchronous by design: `execSync`'s `api.call(...)` must return without
 * yielding (it is the synchronous child-execution contract). `loader.require`
 * runs a CJS entry to completion synchronously, so `pumpOnce` services the
 * request and `waitReply` finds the reply immediately — matching the OLD mock's
 * synchronous shape, now over the loader instead of `new Function`. (An ESM
 * execSync child is async-only; the in-process-runner unit test + the browser
 * e2e cover the ESM/`kind:'url'` paths — this synchronous parity mock pins the
 * CJS shebang/relative/sibling-read behaviors head-to-head against Node.)
 * Returns a teardown that clears the published shim + the host-capability stubs.
 */
async function installExecSyncMode(): Promise<() => void> {
  // Relative source imports (same `tools/`-harness precedent as `runWasi` above):
  // kernel and the runtime-js loader are not workspace deps of the runner.
  const {
    KERNEL_SYNC_CALL_KEY,
    SabRing,
    createSabRing,
    getKernelWorkerUrl,
    encodeRequest,
    decodeReply,
    SyncRpcDispatcher,
    publishKernelSyncApi,
    setKernelWorkerUrl,
  } = await import('../../../packages/kernel/src/index.ts');
  const { clearKernelWorkerUrl } = await import('../../../packages/kernel/src/spawn-worker.ts');
  const { syncMirror } = await import(
    '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts'
  );
  const { createModuleLoader } = await import(
    '../../../packages/runtime-js/src/module-loader/loader.ts'
  );
  const { riftyProcess } = await import('../../../packages/runtime-js/src/builtins/process.ts');
  const { isAbsolute, joinPath, normalizePath } = await import('@riftydev/vfs');

  // Capability stubs so runtime-js `execSync` takes the SAB branch. SAB +
  // Atomics already exist in Node; only `crossOriginIsolated` is missing.
  const g = globalThis as typeof globalThis & { crossOriginIsolated?: boolean };
  // Untyped view for swapping the ambient `process` to `riftyProcess` during a
  // child run (Node's `Process` type rejects the `NodeProcess` shim assignment).
  const procHost = globalThis as { process?: unknown };
  const previousCrossOriginDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'crossOriginIsolated',
  );
  const previousKernelWorkerUrl = getKernelWorkerUrl();
  const previousGlobalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousRiftyEnv = riftyProcess.env;
  const cleanups = new CleanupStack();
  cleanups.defer(() =>
    restoreGlobalDescriptor('crossOriginIsolated', previousCrossOriginDescriptor),
  );
  cleanups.defer(() => {
    if (previousKernelWorkerUrl === null) clearKernelWorkerUrl();
    else setKernelWorkerUrl(previousKernelWorkerUrl);
  });
  cleanups.defer(() => {
    riftyProcess.env = previousRiftyEnv;
  });
  cleanups.defer(() => refreshRuntimeJsProcessBuiltin());
  cleanups.defer(() => restoreGlobalDescriptor('process', previousGlobalProcessDescriptor));
  let failure: unknown | typeof NO_FAILURE = NO_FAILURE;

  try {
    Object.defineProperty(g, 'crossOriginIsolated', { value: true, configurable: true });
    setKernelWorkerUrl('parity://exec-sync');
    riftyProcess.env = Object.create(null) as Record<string, string | undefined>;
    Object.defineProperty(globalThis, 'process', {
      value: riftyProcess,
      configurable: true,
      writable: true,
      enumerable: previousGlobalProcessDescriptor?.enumerable ?? false,
    });
    refreshRuntimeJsProcessBuiltin();

    /**
     * Synchronous loader-run child runner (ADR-0137). Loads the CJS entry through
     * the REAL rifty loader against the sync mirror — shebang stripped, relative
     * `require` + sibling `fs.readFileSync` resolved — capturing the child's
     * `process.stdout.write(...)` bytes verbatim (byte-exact, ADR-0084 #23). The
     * loader reads the ambient global `process`; we install `riftyProcess` with a
     * capturing `stdout` for the run (the Worker realm shape, scoped) and restore.
     */
    function runChildSync(
      scriptPath: string,
      cwd: string,
      env: Readonly<Record<string, string>>,
    ): {
      stdout: Uint8Array;
      exitCode: number;
    } {
      const chunks: Uint8Array[] = [];
      const enc = new TextEncoder();
      const capture = {
        write(chunk: unknown): boolean {
          if (chunk instanceof Uint8Array) chunks.push(new Uint8Array(chunk));
          else chunks.push(enc.encode(String(chunk)));
          return true;
        },
        isTTY: false,
        fd: 1,
      };
      const prevGlobalProcess = procHost.process;
      const prevStdout = riftyProcess.stdout;
      const prevExitCode = riftyProcess.exitCode;
      const prevEnv = riftyProcess.env;
      const prevCwd = getProcessCwd();
      (riftyProcess as { stdout: unknown }).stdout = capture;
      riftyProcess.exitCode = 0;
      riftyProcess.env = { ...env };
      setProcessCwd(cwd);
      procHost.process = riftyProcess;
      let exitCode = 0;
      try {
        const loader = createModuleLoader(syncMirror(), { cwd });
        // Absolutize the entry against cwd (the loader treats bare `build.js` as a
        // package specifier — Node-faithful), mirroring the handler's
        // `resolveNodeEntry`; real Node runs the child in the case tmpdir cwd.
        const entryAbs = normalizePath(
          isAbsolute(scriptPath) ? scriptPath : joinPath(cwd, scriptPath),
        );
        loader.require(entryAbs, entryAbs);
        exitCode = riftyProcess.exitCode;
      } catch {
        exitCode = riftyProcess.exitCode || 1;
      } finally {
        procHost.process = prevGlobalProcess;
        (riftyProcess as { stdout: unknown }).stdout = prevStdout;
        riftyProcess.exitCode = prevExitCode;
        riftyProcess.env = prevEnv;
        setProcessCwd(prevCwd);
      }
      let total = 0;
      for (const c of chunks) total += c.byteLength;
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return { stdout: out, exitCode };
    }

    // Real dispatcher + ring + framing. The synchronous handler returns the
    // child's stdout BYTES — the dispatcher emits a v2 binary frame (ADR-0084
    // #23), so the value round-trips byte-exact.
    const dispatcher = new SyncRpcDispatcher();
    cleanups.defer(() => dispatcher.detachAll());
    dispatcher.register('execSync', (rawPayload) => {
      const payload = rawPayload as {
        cmd: string;
        opts?: { cwd?: string; env?: Readonly<Record<string, string>> };
      };
      const tokens = payload.cmd.split(/\s+/).filter(Boolean);
      if (tokens[0] !== 'node' || tokens.length < 2) {
        throw Object.assign(new Error(`execSync only supports 'node <script>': ${payload.cmd}`), {
          code: 'EUNSUPPORTED',
        });
      }
      const cwd = payload.opts?.cwd ?? '/';
      const rawArg = tokens[1] ?? '';
      const scriptPath = normalizePath(isAbsolute(rawArg) ? rawArg : joinPath(cwd, rawArg));
      if (!syncMirror().existsSync(scriptPath)) {
        throw Object.assign(new Error(`execSync: script not found: ${scriptPath}`), {
          code: 'ENOENT',
        });
      }
      const result = runChildSync(scriptPath, cwd, payload.opts?.env ?? {});
      if (result.exitCode !== 0) {
        throw Object.assign(new Error(`Command failed: ${payload.cmd}`), {
          code: 'ECHILDFAILED',
          exitCode: result.exitCode,
        });
      }
      return result.stdout;
    });

    const { sab, ring } = createSabRing();
    const dispatcherRing = SabRing.attach(sab);
    dispatcher.attach(dispatcherRing);

    const previousSyncCallDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      KERNEL_SYNC_CALL_KEY,
    );
    cleanups.defer(() => restoreGlobalDescriptor(KERNEL_SYNC_CALL_KEY, previousSyncCallDescriptor));
    publishKernelSyncApi({
      call: (method, payload) => {
        ring.writeRequest(encodeRequest({ method, payload }));
        dispatcher.pumpOnce(dispatcherRing); // synchronous handler writes the reply now
        const replyBytes = ring.waitReply(2000); // reply already present → returns immediately
        const reply = decodeReply(replyBytes);
        if (reply.ok) return reply.value;
        const e = reply.error ?? { name: 'Error', message: 'unknown' };
        const err = new Error(e.message);
        err.name = e.name;
        if (e.code !== undefined) (err as Error & { code?: string }).code = e.code;
        throw err;
      },
    });

    return () => cleanups.dispose();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (failure !== NO_FAILURE) disposePreservingFailure(cleanups, failure);
  }
}

/**
 * Build the `transformSource` hook for `kind: 'ts-esm'`. The loader is the
 * parity target; the Node-only harness injects workspace esbuild as its real
 * transform boundary. Product runtime activation is proved separately through
 * the registry-owned browser adapter.
 */
function buildTsTransform(): TransformSourceHook {
  return ({ source, loader }) =>
    transformWithHostEsbuild(source, {
      loader,
      format: 'esm',
      sourcemap: 'inline',
      supported: { decorators: false },
      jsx: loader !== 'ts' ? 'automatic' : undefined,
    }).then((r) => r.code);
}

/** Worker-entry seam. Public callers use {@link runInRifty}. */
export async function runInRiftyInCurrentRealm(
  testCase: ParityCase,
  options: RunInRiftyOptions = {},
): Promise<string> {
  const feedTimeoutMs = timeoutMs(
    options.stdinTimeoutMs ?? DEFAULT_STDIN_TIMEOUT_MS,
    'RunInRiftyOptions.stdinTimeoutMs',
  );
  const createMessageChannel = options.createMessageChannel ?? (() => new MessageChannel());
  const priorProcessCwd = getProcessCwd();
  const priorSyncMirror = syncMirror();
  const priorAsyncVfs = asyncVfs();
  const priorVmEngineDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__RIFTY_VM_ENGINE');
  const vfs = new MemoryFsSync();
  const files: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      files[`/work/${rel}`] = content;
    }
  }
  const ext = testCase.kind === 'esm' || testCase.kind === 'ts-esm' ? 'mjs' : 'js';
  // `ts-esm` writes the entry (and setup files) as `.ts` so the loader resolves
  // and strips them; every other kind keeps the historical `.js`/`.mjs` ext.
  const entryExt = testCase.kind === 'ts-esm' ? 'ts' : ext;
  files[`/work/main.${entryExt}`] = testCase.code;
  // `ts-esm` needs `/work` to be a `type:module` package scope so the resolver
  // classifies `.ts` as ESM (F02-T1 `detectKind`) and `import()` strips it —
  // otherwise it falls to CJS and `require()` of a `.ts` throws the directed
  // F02-T4 NotImplementedError. The case author never writes this package.json.
  if (testCase.kind === 'ts-esm' && !('/work/package.json' in files)) {
    files['/work/package.json'] = JSON.stringify({ type: 'module' });
  }
  vfs.loadFixture(files);

  // Replace the global sync mirror so `fs.readFileSync` / `fs.writeFileSync`
  // in user code see the case's files instead of bleeding from other cases.
  // Setup files are exposed at '/' so cases can use either bare names (with
  // resolvePath using cwd='/') or absolute paths.
  const fsFiles: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      fsFiles[`/${rel}`] = content;
    }
  }
  const fsMirror = new MemoryFsSync();
  fsMirror.loadFixture(fsFiles);
  // Materialize the case cwd: the Node runner mkdirs `<workDir>/<cwd>` before
  // spawning, so a cwd with no setup files inside it must exist here too
  // (self-proof: cases/fs/empty-cwd-materialized).
  const cwd = caseCwd(testCase);
  if (cwd !== '/') fsMirror.mkdirSync(cwd, { recursive: true });
  const cleanups = new CleanupStack();
  let failure: unknown | typeof NO_FAILURE = NO_FAILURE;
  try {
    // One outer ownership scope begins BEFORE the first process-global mutation.
    // Every subsequently acquired mode pushes its teardown immediately; unwind
    // is exact LIFO even when setup or guest evaluation throws.
    cleanups.defer(() => resetKeepalive());
    cleanups.defer(() => setVmEngineOverride(undefined));
    cleanups.defer(() => restoreGlobalDescriptor('__RIFTY_VM_ENGINE', priorVmEngineDescriptor));
    cleanups.defer(() =>
      setSyncMirror(priorSyncMirror, priorAsyncVfs ? { async: priorAsyncVfs } : {}),
    );
    setSyncMirror(fsMirror);

    // Mirror Node's view: process.cwd() = ParityCase.cwd (default '/'). Important
    // so `fs.readFileSync('a.txt')` resolves against the same anchor as the Node
    // child running with cwd=<workDir>/<cwd>. Use the runtime's per-Worker cwd
    // cell rather than monkey-patching the `process` object (ADR-0019).
    cleanups.defer(() => refreshRuntimeJsProcessBuiltin());
    cleanups.defer(() => setProcessCwd(priorProcessCwd));
    setProcessCwd(cwd);
    refreshRuntimeJsProcessBuiltin();

    // `ts-esm` threads a real esbuild type-strip hook (ADR-0052) so `.ts`
    // resolves and its types are stripped before the AST ESM rewrite.
    const loader =
      testCase.kind === 'ts-esm'
        ? createModuleLoader(vfs, {
            cwd: '/work',
            workspace: '/work',
            transformSource: buildTsTransform(),
          })
        : createModuleLoader(vfs, { cwd: '/work' });

    // Opt-in net mode: register `node:http` and inject the request driver so the
    // case can drive its own server through the port registry (no OS socket).
    if (testCase.kind === 'http') {
      const teardownHttp = await installHttpMode();
      cleanups.defer(teardownHttp);
    }

    // Opt-in sqlite mode: register `node:sqlite` and bring up the sql.js engine so
    // the synchronous `DatabaseSync` constructor in the case `code` resolves and
    // has its WASM handle ready (ADR-0065). No teardown — see `installSqliteMode`.
    if (testCase.kind === 'sqlite') await installSqliteMode();

    // Opt-in exec-sync mode (ADR-0084 #23): wire the real SAB binary-frame path so
    // the case's `child_process.execSync` returns byte-exact stdout to diff against
    // real Node. Teardown clears the published shim + host-capability stubs.
    if (testCase.kind === 'exec-sync') {
      const teardownExecSync = await installExecSyncMode();
      cleanups.defer(teardownExecSync);
    }

    // ADR-0267: only a physical kernel child can prove that typed host
    // bootstrap metadata stays outside exact inherited/replacement guest env.
    if (isPhysicalWorkerCase(testCase)) {
      const teardownPhysicalWorker = await installPhysicalWorkerMode(testCase);
      cleanups.defer(teardownPhysicalWorker);
    }

    // Preload QuickJS before any user code runs: a case can opt the `vm.*` sandbox
    // into the quickjs engine via `globalThis.__RIFTY_VM_ENGINE = 'quickjs'`, and
    // that engine evaluates synchronously via `getQuickJsModuleSync()`. Memoised,
    // so this is a one-time bring-up shared across all cases.
    await ensureVmEngineReady();

    const seededProcess = isSeededProcessCase(testCase)
      ? installSeededProcessMode(
          cwd,
          testCase.kind === 'tty-resize',
          createMessageChannel,
          feedTimeoutMs,
        )
      : null;
    if (seededProcess) cleanups.defer(() => seededProcess.teardown());

    const restoreTimerGlobals = installCaseTimerGlobals();
    cleanups.defer(restoreTimerGlobals);

    const captured: string[] = [];
    const writeStdout = (...args: unknown[]) => {
      const text = `${formatArgs(args)}\n`;
      if (seededProcess) seededProcess.writeConsoleStdout(text);
      else captured.push(text);
    };
    const writeStderr = (...args: unknown[]) => {
      const text = `${formatArgs(args)}\n`;
      if (seededProcess) seededProcess.writeConsoleStderr(text);
      else captured.push(text);
    };
    const original = {
      log: console.log,
      info: console.info,
      debug: console.debug,
      warn: console.warn,
      error: console.error,
    };
    cleanups.defer(() => {
      console.log = original.log;
    });
    cleanups.defer(() => {
      console.info = original.info;
    });
    cleanups.defer(() => {
      console.debug = original.debug;
    });
    cleanups.defer(() => {
      console.warn = original.warn;
    });
    cleanups.defer(() => {
      console.error = original.error;
    });
    console.log = writeStdout;
    console.info = writeStdout;
    console.debug = writeStdout;
    console.warn = writeStderr;
    console.error = writeStderr;

    // Native no-input uses fd 0 `ignore` (EOF). End physical mode's synthetic
    // parent stdin too, so inherited children never wait on a harness-only pipe.
    const stdinChunks =
      testCase.stdin ?? (isPhysicalWorkerCase(testCase) ? ([] as const) : undefined);
    // Native Node receives stdin as soon as the child is spawned. Start the real
    // MessagePort feed before entry evaluation too, then await BOTH operations.
    // This lets ESM top-level await consume stdin. Feed completion is the hidden
    // receiver-side EOF ACK; the disposable Worker's case deadline owns a guest
    // that never resumes the public stream or otherwise fails to settle.
    const stdinFeed =
      stdinChunks === undefined
        ? Promise.resolve()
        : (seededProcess?.feedStdin(stdinChunks) ??
          Promise.reject(new Error('stdin parity case has no seeded process')));
    const entryEvaluation = Promise.resolve().then(async () => {
      if (testCase.kind === 'ts-esm') {
        await loader.import('./main.ts', '/work/__entry.ts');
      } else if (testCase.kind === 'esm') {
        await loader.import('./main.mjs', '/work/__entry.mjs');
      } else {
        loader.require('./main.js', '/work/__entry.js');
      }
    });
    await Promise.all([entryEvaluation, stdinFeed]);

    // Mirror the real Worker lifecycle: global timers installed by bootstrap
    // hold the keepalive refcount until every scheduled callback has fired.
    await awaitDrain({ capMs: isPhysicalWorkerCase(testCase) ? 10_000 : 1_000 });
    await seededProcess?.drainStdio();
    if (testCase.kind === 'http') {
      // The http case drives its own server inside `listen`'s callback (a
      // microtask) and prints from the awaited `__riftyHttpRequest` round-trip.
      // Wait until stdout settles (no new line for two successive polls) rather
      // than a fixed sleep, so a slow round-trip is not silently truncated.
      let prev = -1;
      for (let i = 0; i < 40 && prev !== captured.length; i++) {
        prev = captured.length;
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    return seededProcess?.stdoutText() ?? captured.join('');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    disposePreservingFailure(cleanups, failure);
  }
}

function workerError(serialized: SerializedWorkerError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  return error;
}

/**
 * A seeded-process case can fail or time out before guest work settles. Only a
 * realm boundary can stop that guest physically; promise races leave callbacks
 * alive against the next case's process-global harness state (ADR-0255).
 */
function runInDisposableWorker(
  testCase: ParityCase,
  stdinTimeoutMs: number,
  caseTimeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./run-in-rifty-worker.ts', import.meta.url), {
      execArgv: ['--import', 'tsx'],
      workerData: { testCase, stdinTimeoutMs },
    });
    let settling = false;

    const terminateThen = (
      outcome:
        | { readonly ok: true; readonly stdout: string }
        | { readonly ok: false; error: Error },
    ): void => {
      if (settling) return;
      settling = true;
      HOST_CLEAR_TIMEOUT(caseTimer);
      void worker.terminate().then(
        () => {
          if (outcome.ok) resolve(outcome.stdout);
          else reject(outcome.error);
        },
        (terminationError: unknown) => {
          const errors = outcome.ok
            ? [asError(terminationError)]
            : [outcome.error, asError(terminationError)];
          reject(new AggregateError(errors, 'rifty parity Worker termination failed'));
        },
      );
    };

    worker.once('message', (message: unknown) => {
      const response = message as Partial<RiftyWorkerResponse> | null;
      if (response?.ok === true && typeof response.stdout === 'string') {
        terminateThen({ ok: true, stdout: response.stdout });
        return;
      }
      if (
        response?.ok === false &&
        response.error !== undefined &&
        typeof response.error.name === 'string' &&
        typeof response.error.message === 'string'
      ) {
        terminateThen({ ok: false, error: workerError(response.error) });
        return;
      }
      terminateThen({
        ok: false,
        error: new TypeError('rifty parity Worker returned a malformed result'),
      });
    });
    worker.once('messageerror', (error) => terminateThen({ ok: false, error }));
    worker.once('error', (error) => terminateThen({ ok: false, error }));
    worker.once('exit', (code) => {
      if (settling) return;
      settling = true;
      HOST_CLEAR_TIMEOUT(caseTimer);
      reject(new Error(`rifty parity Worker exited ${code} before returning a result`));
    });
    const caseTimer = HOST_SET_TIMEOUT(
      () =>
        terminateThen({
          ok: false,
          error: new Error(`rifty parity case timed out after ${caseTimeoutMs}ms`),
        }),
      caseTimeoutMs,
    );
  });
}

export async function runInRifty(
  testCase: ParityCase,
  options: RunInRiftyOptions = {},
): Promise<string> {
  const stdinTimeoutMs = timeoutMs(
    options.stdinTimeoutMs ?? DEFAULT_STDIN_TIMEOUT_MS,
    'RunInRiftyOptions.stdinTimeoutMs',
  );
  const caseTimeoutMs = timeoutMs(
    options.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS,
    'RunInRiftyOptions.caseTimeoutMs',
  );
  if (isSeededProcessCase(testCase) && options.createMessageChannel === undefined) {
    return runInDisposableWorker(testCase, stdinTimeoutMs, caseTimeoutMs);
  }
  return runInRiftyInCurrentRealm(testCase, options);
}
