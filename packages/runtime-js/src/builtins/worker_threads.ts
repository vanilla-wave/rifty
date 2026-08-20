/**
 * Node-compatible `node:worker_threads` (subset).
 *
 * In SAB/COI-capable playground realms, `Worker` spawns a real kernel-backed
 * node-entry worker process and routes `parentPort` over fork IPC. Plain
 * vitest/Node realms keep a loud same-realm fallback for conformance and API
 * tests; it is not used for threaded WASI packages such as Rolldown in-browser.
 */

import { NotImplementedError } from '@riftydev/io';
import {
  type ProcessHandle,
  type SpawnWorkerSpec,
  getKernelWorkerUrl,
  globalProcessManager,
  isSabIpcSupported,
  observeProcessTerminalOutcome,
} from '@riftydev/kernel';
import { type FsSync, dirname, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { fileURLToPathPosix, isNodeUrl } from '../internal/posix-file-url.ts';
import { Buffer } from './buffer.ts';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import {
  buildConfiguredNodeEntryWorkerEntry,
  readNodeEntryBootstrapIfPresent,
} from './node-entry-runtime-config.ts';
import { getNodeEntryWorkerUrl } from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { type NodeProcessContextSnapshot, snapshotNodeProcessContext } from './process-context.ts';
import { getProcessCwd, nodeProcessWorkerIpc } from './process.ts';

interface WorkerOptions {
  workerData?: unknown;
  env?: Record<string, string | undefined>;
  eval?: boolean;
  execArgv?: readonly string[];
}

function snapshotWorkerEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) snapshot[key] = String(value);
  return snapshot;
}

type WorkerScript = string | URL;

type WorkerEntry =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'data-url'; readonly href: string };

interface WorkerMessageEvent {
  readonly data: unknown;
}

type WorkerMessageHandler = (event: WorkerMessageEvent) => void;

interface WorkerPort extends EventEmitter {
  onmessage: WorkerMessageHandler | null;
  postMessage(msg: unknown): void;
  ref(): WorkerPort;
  unref(): WorkerPort;
  start(): void;
  close(): void;
}

interface WorkerThreadContext {
  readonly parentPort: WorkerPort;
  readonly workerData: unknown;
  readonly threadId: number;
}

type SameRealmWorkerModuleImporter = (vfs: FsSync, script: string, cwd: string) => Promise<unknown>;

let sameRealmWorkerModuleImporter: SameRealmWorkerModuleImporter | null = null;

export function setSameRealmWorkerModuleImporter(importer: SameRealmWorkerModuleImporter): void {
  sameRealmWorkerModuleImporter = importer;
}

export class Worker extends EventEmitter {
  static isMainThread = true;
  threadId: number;
  private readonly entry: WorkerEntry;
  private readonly workerData: unknown;
  private readonly env: Record<string, string>;
  private readonly processContext: NodeProcessContextSnapshot | null;
  private readonly ownerProcess: unknown;
  private readonly ownerBootstrap: ReturnType<typeof readActiveNodeProcessBootstrap>;
  private exited = false;
  private sameRealmContext: WorkerThreadContext | null = null;
  private sameRealmParentPort: WorkerPort | null = null;
  private sameRealmGlobalOnMessage: WorkerMessageHandler | null = null;
  private readonly pendingParentMessages: unknown[] = [];
  /** ADR-0011 phase 2: when present, backed by a real `kernel.spawnWorker`
   * realm and `terminate` routes through it. */
  private workerHandle: ProcessHandle | null = null;

  constructor(script: WorkerScript, opts: WorkerOptions = {}) {
    super();
    this.ownerProcess = (globalThis as { process?: unknown }).process;
    this.ownerBootstrap = readActiveNodeProcessBootstrap();
    const entry = parseWorkerEntry(script, getProcessCwd(), opts.eval);
    const inheritedLaunch = readNodeEntryBootstrapIfPresent()?.launch;
    if (
      Object.prototype.hasOwnProperty.call(opts, 'execArgv') ||
      (inheritedLaunch?.kind === 'eval' && inheritedLaunch.execArgv.length > 0)
    ) {
      // TODO(backlog: runtime-js/worker-threads-inherited-exec-argv)
      throw new NotImplementedError(
        'worker_threads.Worker.execArgv',
        'node-entry v3 cannot preserve worker-thread execArgv identity',
      );
    }
    const processContext = snapshotNodeProcessContext();
    const env =
      opts.env === undefined
        ? { ...(processContext?.env ?? {}) }
        : snapshotWorkerEnvironment(opts.env);
    this.threadId = nextThreadId++;
    this.entry = entry;
    this.workerData = opts.workerData;
    this.processContext = processContext;
    this.env = env;
    // TODO(backlog: runtime-js/worker-threads-prompt-start-atomics-wait):
    // synchronous allocation cannot close prompt-start while entry loading
    // still needs parent-serviced remote FS.
    queueMicrotask(() => this.start());
  }

  private start(): void {
    if (this.entry.kind === 'data-url') {
      // TODO(backlog: runtime-js/worker-eval-data-url-entry)
      this.emitWorkerError(
        new NotImplementedError(
          'worker_threads.Worker.data-url',
          'data: URL Worker entries are not implemented',
        ),
      );
      void this.terminate(1);
      return;
    }
    const script = this.entry.path;
    // ADR-0011 phase 2: real Worker realm via kernel.spawnWorker when
    // capability + host wiring permit.
    if (isSabIpcSupported() && getKernelWorkerUrl() !== null && getNodeEntryWorkerUrl() !== null) {
      this.startViaKernel(script);
      return;
    }
    // ADR-0011 fallback: in-realm polyfill violates worker_threads' separate-
    // event-loop promise, so warn loudly (once per import) but don't throw —
    // conformance + integration paths still rely on same-realm propagation.
    warnSameRealmFallbackOnce();
    this.startSameRealm(script);
  }

  private startViaKernel(script: string): void {
    try {
      const nodeEntryWorkerUrl = getNodeEntryWorkerUrl();
      if (nodeEntryWorkerUrl === null) {
        throw new NotImplementedError(
          'worker_threads.Worker.node-entry',
          'kernel-backed Worker requires setNodeEntryWorkerUrl(...)',
        );
      }
      const env: Record<string, string> = { ...this.env };
      const encodedWorkerData = encodeWorkerData(this.workerData);
      const entry = buildConfiguredNodeEntryWorkerEntry({
        kind: 'worker-thread',
        remoteFs: true,
        threadId: this.threadId,
        ...(encodedWorkerData === undefined ? {} : { workerDataJson: encodedWorkerData }),
      });
      if (this.processContext === null) {
        throw new Error('worker_threads.Worker: kernel Node process context is unavailable');
      }
      const spec: SpawnWorkerSpec = {
        entry,
        argv: ['rifty', script],
        env,
        cwd: this.processContext.cwd,
        // serve:true keeps a message-driven Worker alive (Node parity, and the
        // shape Rolldown's pthread pool needs) — the kernel never drain-reaps a
        // serve child. Cost: a run-to-completion Worker (no live handle after the
        // entry resolves) does NOT auto-emit 'exit' here like Node; the
        // same-realm path does (keepsAlive -> terminate(0)). Explicit, tracked
        // divergence (not a silent hang):
        // TODO(backlog: runtime-js/worker-threads-kernel-run-to-completion-exit).
        serve: true,
      };
      const handle = globalProcessManager.spawnWorkerThread(
        spec,
        { pid: this.processContext.pid, ppid: this.processContext.ppid },
        { cwd: this.processContext.cwd },
      );
      this.workerHandle = handle;
      if (handle.kind === 'worker') {
        handle.stdout().on('data', (chunk) => this.emitToOwner('stdout', chunk));
        handle.stderr().on('data', (chunk) => this.emitToOwner('stderr', chunk));
        handle.on('message', (msg) => this.emitWorkerMessage(msg));
        this.flushKernelMessages(handle);
        // Node emits 'online' once the worker realm exists. Construction-start
        // is already deferred at the shared entry above.
        this.emitToOwner('online');
      }
      observeProcessTerminalOutcome(handle, (outcome) => {
        if (outcome.kind === 'peererror') {
          try {
            this.emitWorkerError(outcome.error);
          } finally {
            this.finish(1);
          }
          return;
        }
        // TODO(backlog: runtime-js/worker-threads-kernel-error-event): a
        // worker-runtime uncaught throw exits 1 here with the stack on stderr,
        // but Node also emits 'error' (the real Error) first. Needs a child-side
        // uncaught handler posting an IPC error frame; faking an Error from the
        // exit code would lie. Same-realm path already emits 'error'.
        this.finish(typeof outcome.code === 'number' ? outcome.code : 1);
      });
    } catch (err) {
      this.emitWorkerError(err);
      void this.terminate(1);
    }
  }

  private startSameRealm(script: string): void {
    void this.startSameRealmAsync(script);
  }

  private async startSameRealmAsync(script: string): Promise<void> {
    try {
      const source = Buffer.from(syncMirror().readFileBytesSync(script)).toString();
      const parentPort = createWorkerPort((msg) => this.emitWorkerMessage(msg));
      const context: WorkerThreadContext = {
        parentPort,
        workerData: this.workerData,
        threadId: this.threadId,
      };
      this.sameRealmContext = context;
      this.sameRealmParentPort = parentPort;

      // child → parent: worker's parentPort.postMessage → 'message' on the handle.
      parentPort.postMessage = (msg) => this.emitWorkerMessage(msg);

      // Node emits 'online' when the worker starts executing — about to run the
      // script body now.
      this.emitToOwner('online');

      const previousGlobalOnMessage = readGlobalOnMessage();
      if (shouldLoadWithModuleLoader(script, source)) {
        const importer = sameRealmWorkerModuleImporter;
        if (importer === null) {
          throw new NotImplementedError(
            'worker_threads.Worker.esm-loader',
            'same-realm ESM Worker loading requires module-loader registration',
          );
        }
        await withSameRealmWorkerContext(context, () =>
          importer(syncMirror(), script, dirname(script)),
        );
      } else {
        const fn = new Function(
          'parentPort',
          'workerData',
          `${source}\n//# sourceURL=${script}`,
        ) as (parentPort: unknown, workerData: unknown) => unknown;
        await withSameRealmWorkerContext(context, () =>
          Promise.resolve(fn(parentPort, this.workerData)),
        );
      }

      const nextGlobalOnMessage = readGlobalOnMessage();
      this.sameRealmGlobalOnMessage =
        nextGlobalOnMessage !== previousGlobalOnMessage ? nextGlobalOnMessage : null;
      this.flushSameRealmMessages();
      const keepsAlive =
        parentPort.listenerCount('message') > 0 ||
        parentPort.onmessage !== null ||
        this.sameRealmGlobalOnMessage !== null;
      if (!keepsAlive) void this.terminate(0);
    } catch (err) {
      this.emitWorkerError(err);
      void this.terminate(1);
    }
  }

  postMessage(msg: unknown): void {
    if (this.workerHandle?.kind === 'worker') {
      this.workerHandle.send(msg);
      return;
    }
    const context = this.sameRealmContext;
    const parentPort = this.sameRealmParentPort;
    if (!context || !parentPort) {
      this.pendingParentMessages.push(msg);
      return;
    }
    withSameRealmWorkerContextSync(context, () => {
      this.deliverSameRealmMessage(parentPort, msg);
    });
  }

  async terminate(code = 1): Promise<number | undefined> {
    // Node: terminate() takes no exit-code argument. On a STILL-RUNNING worker it
    // resolves the forced-stop exit-event code (1); on an ALREADY-EXITED worker the
    // handle is gone so it resolves `undefined` (verified vs Node v24). Internal
    // callers pass `code` only to drive the synthesized 'exit' event.
    if (this.exited) return undefined;
    if (this.workerHandle) {
      // Node Worker.terminate() is a forced stop. A drain-waiting SIGTERM lets
      // pthread code run after its creator has destroyed shared N-API state.
      this.workerHandle.kill('SIGKILL');
    }
    this.sameRealmParentPort?.removeAllListeners();
    this.sameRealmContext = null;
    this.sameRealmParentPort = null;
    this.sameRealmGlobalOnMessage = null;
    this.finish(code);
    return code;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  private emitWorkerMessage(msg: unknown): void {
    this.emitToOwner('message', msg);
  }

  private flushKernelMessages(handle: Extract<ProcessHandle, { kind: 'worker' }>): void {
    while (this.pendingParentMessages.length > 0) {
      handle.send(this.pendingParentMessages.shift());
    }
  }

  private flushSameRealmMessages(): void {
    const context = this.sameRealmContext;
    const parentPort = this.sameRealmParentPort;
    if (!context || !parentPort || this.pendingParentMessages.length === 0) return;
    const pending = this.pendingParentMessages.splice(0);
    withSameRealmWorkerContextSync(context, () => {
      for (const msg of pending) this.deliverSameRealmMessage(parentPort, msg);
    });
  }

  private deliverSameRealmMessage(parentPort: WorkerPort, msg: unknown): void {
    const deliveredToParentPort =
      parentPort.listenerCount('message') > 0 || parentPort.onmessage !== null;
    if (deliveredToParentPort) {
      deliverToPort(parentPort, msg);
      return;
    }
    if (this.sameRealmGlobalOnMessage) {
      this.sameRealmGlobalOnMessage({ data: msg });
      return;
    }
    this.pendingParentMessages.push(msg);
  }

  private emitWorkerError(error: unknown): void {
    this.emitToOwner('error', error);
  }

  private finish(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.emitToOwner('exit', code);
  }

  private emitToOwner(event: string, ...args: unknown[]): boolean {
    const realm = globalThis as { process?: unknown };
    const previousProcess = realm.process;
    const previousBootstrap = readActiveNodeProcessBootstrap();
    realm.process = this.ownerProcess;
    setActiveNodeProcessBootstrap(
      this.ownerBootstrap?.process ?? null,
      this.ownerBootstrap?.federated ?? false,
    );
    try {
      return this.emit(event, ...args);
    } finally {
      setActiveNodeProcessBootstrap(
        previousBootstrap?.process ?? null,
        previousBootstrap?.federated ?? false,
      );
      realm.process = previousProcess;
    }
  }
}

// Node numbers the main thread 0 and assigns Workers 1, 2, … — so the first
// Worker's id is 1 (see the `threadId` export below = 0 for the main thread).
let nextThreadId = 1;
let activeSameRealmContext: WorkerThreadContext | null = null;
let cachedProcessWorkerContext: WorkerThreadContext | null | undefined;

/** One-shot guard: same-realm warning fires once per module import. Reset via
 * {@link _resetFallbackWarnState} for tests only. */
let fallbackWarnFired = false;

function warnSameRealmFallbackOnce(): void {
  if (fallbackWarnFired) return;
  fallbackWarnFired = true;
  console.warn(
    '[rifty:worker_threads] Falling back to same-realm execution: ' +
      'kernel.spawnWorker capability not available ' +
      '(SAB IPC unsupported or kernelWorkerUrl not configured). ' +
      'workerData and parentPort still propagate, but this Worker shares ' +
      'the parent event loop — no real parallelism. ' +
      'To enable real Workers: ensure cross-origin isolation (SharedArrayBuffer) ' +
      'and call kernel.setKernelWorkerUrl(...) at host boot (ADR-0011 phase 2).',
  );
}

/** Test-only: reset the one-shot warn guard. Not public API. */
export function _resetFallbackWarnState(): void {
  fallbackWarnFired = false;
  activeSameRealmContext = null;
  cachedProcessWorkerContext = undefined;
}

/** Test-only: rewind the threadId counter so the next Worker gets Node's
 * first-worker id (1). Not public API. */
export function _resetThreadIdCounterForTests(): void {
  nextThreadId = 1;
}

export const isMainThread = true;
export const parentPort: EventEmitter | null = null;
export const threadId = 0;
export const workerData: unknown = undefined;

/**
 * Object-graph tags backing `markAsUntransferable` / `markAsUncloneable`.
 *
 * Node stores these flags on internal V8 slots for the native structured-clone
 * serializer. With no in-realm hook into that serializer we use module-scoped
 * `WeakSet`s, which preserve the parity-observable contract (marks round-trip,
 * add no enumerable own properties, re-marking is a no-op) without faking a
 * serializer. Consulted by any in-realm clone / port-transfer path (e.g. a
 * future `MessagePort.postMessage`); the same-realm `Worker` fallback passes by
 * reference and never clones, so it enforces nothing.
 */
const untransferable = new WeakSet<object>();
const uncloneable = new WeakSet<object>();

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Tag `object` so it is cloned (not transferred) when passed to
 * `postMessage(value, [transferList])`. Mirrors Node: ignores non-objects.
 *
 * @param object - Candidate to mark. Non-objects are ignored.
 */
export function markAsUntransferable(object: unknown): void {
  if (isObjectLike(object)) untransferable.add(object);
}

/**
 * Report whether `object` was tagged by {@link markAsUntransferable}. `false`
 * for primitives/null/undefined, matching Node.
 *
 * @param object - Candidate to test.
 * @returns `true` iff the object carries the untransferable mark.
 */
export function isMarkedAsUntransferable(object: unknown): boolean {
  return isObjectLike(object) && untransferable.has(object);
}

/**
 * Tag `object` so it throws `DataCloneError` if cloned via structuredClone /
 * `postMessage`. undici marks every web-platform class instance this way in its
 * constructor (`webidl.util.markAsUncloneable`), so we record the tag for an
 * in-realm clone path to honour. Mirrors Node: ignores non-objects.
 *
 * @param object - Candidate to mark. Non-objects are ignored.
 */
export function markAsUncloneable(object: unknown): void {
  if (isObjectLike(object)) uncloneable.add(object);
}

/**
 * Report whether `object` was tagged by {@link markAsUncloneable}. Not in
 * Node's public `worker_threads` surface — for rifty's in-realm clone path.
 *
 * @param object - Candidate to test.
 * @returns `true` iff the object carries the uncloneable mark.
 */
export function isMarkedAsUncloneable(object: unknown): boolean {
  return isObjectLike(object) && uncloneable.has(object);
}

function parseWorkerEntry(
  script: WorkerScript,
  cwd: string,
  evalScript: boolean | undefined,
): WorkerEntry {
  if (evalScript) {
    if (typeof script !== 'string') {
      const error = new TypeError(
        "The property 'options.eval' must be false when 'filename' is not a string. Received true",
      ) as TypeError & { code: string };
      error.code = 'ERR_INVALID_ARG_VALUE';
      throw error;
    }
    // TODO(backlog: runtime-js/worker-eval-data-url-entry)
    throw new NotImplementedError(
      'worker_threads.Worker.eval',
      'eval Worker entries are not implemented',
    );
  }
  if (typeof script === 'string') {
    if (!isAbsolute(script) && !/^\.\.?[\\/]/u.test(script)) throwWorkerPathError(script);
    return {
      kind: 'path',
      path: isAbsolute(script) ? normalizePath(script) : joinPath(cwd, script),
    };
  }
  if (!isNodeUrl(script)) {
    const error = new TypeError(
      'The "filename" argument must be of type string or an instance of URL',
    ) as TypeError & { code: string };
    error.code = 'ERR_INVALID_ARG_TYPE';
    throw error;
  }
  if (script.protocol === 'data:') return { kind: 'data-url', href: script.href };
  return { kind: 'path', path: fileURLToPathPosix(script) };
}

function throwWorkerPathError(script: string): never {
  const wrapHint = script.startsWith('file://')
    ? ' Wrap file:// URLs with `new URL`.'
    : script.startsWith('data:text/javascript')
      ? ' Wrap data: URLs with `new URL`.'
      : '';
  const error = new TypeError(
    `The worker script or module filename must be an absolute path or a relative path starting with './' or '../'.${wrapHint} Received "${script}"`,
  ) as TypeError & { code: string };
  error.code = 'ERR_WORKER_PATH';
  throw error;
}

function shouldLoadWithModuleLoader(script: string, source: string): boolean {
  return script.endsWith('.mjs') || /^\s*(?:import|export)\b/m.test(source);
}

function createWorkerPort(postMessage: (msg: unknown) => void): WorkerPort {
  const port = new EventEmitter() as WorkerPort;
  port.onmessage = null;
  port.postMessage = postMessage;
  port.ref = () => port;
  port.unref = () => port;
  port.start = () => {};
  port.close = () => {
    port.removeAllListeners();
    port.onmessage = null;
  };
  return port;
}

function deliverToPort(port: WorkerPort, msg: unknown): void {
  port.emit('message', msg);
  port.onmessage?.({ data: msg });
}

function readGlobalOnMessage(): WorkerMessageHandler | null {
  const candidate = (globalThis as { onmessage?: unknown }).onmessage;
  return typeof candidate === 'function' ? (candidate as WorkerMessageHandler) : null;
}

async function withSameRealmWorkerContext<T>(
  context: WorkerThreadContext,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = activeSameRealmContext;
  activeSameRealmContext = context;
  try {
    return await fn();
  } finally {
    activeSameRealmContext = previous;
  }
}

function withSameRealmWorkerContextSync<T>(context: WorkerThreadContext, fn: () => T): T {
  const previous = activeSameRealmContext;
  activeSameRealmContext = context;
  try {
    return fn();
  } finally {
    activeSameRealmContext = previous;
  }
}

function readProcessWorkerContext(): WorkerThreadContext | null {
  if (cachedProcessWorkerContext !== undefined) return cachedProcessWorkerContext;
  const proc = globalThis.process as unknown;
  const bootstrap = readNodeEntryBootstrapIfPresent();
  if (proc === undefined || bootstrap?.launch.kind !== 'worker-thread') {
    cachedProcessWorkerContext = null;
    return null;
  }
  const launch = bootstrap.launch;
  const ipc = nodeProcessWorkerIpc(proc);
  const parentPort = createWorkerPort((msg) => {
    if (!ipc.send(msg)) {
      throw new NotImplementedError(
        'worker_threads.parentPort.postMessage',
        'kernel worker_threads IPC is closed',
      );
    }
  });
  const context: WorkerThreadContext = {
    parentPort,
    workerData: decodeWorkerData(launch.workerDataJson),
    threadId: launch.threadId,
  };
  ipc.onMessage((msg) => {
    withSameRealmWorkerContextSync(context, () => deliverToPort(parentPort, msg));
  });
  cachedProcessWorkerContext = context;
  return context;
}

function activeWorkerContext(): WorkerThreadContext | null {
  return activeSameRealmContext ?? readProcessWorkerContext();
}

function encodeWorkerData(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  assertJsonCloneSafeWorkerData(value, new Set());
  try {
    return JSON.stringify(value);
  } catch {
    throw new NotImplementedError(
      'worker_threads.workerData.structuredClone',
      'kernel-backed Worker workerData must be JSON-serializable',
    );
  }
}

function assertJsonCloneSafeWorkerData(value: unknown, seen: Set<object>): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    // -0 is loud-rejected, NOT accepted: JSON.stringify(-0) === '0' would
    // SILENTLY drop the sign over the wire (Node's structuredClone preserves
    // -0). Honest throw over silent corruption. NaN/Infinity already fall
    // through to the throw below (Number.isFinite is false). Full structuredClone
    // workerData is the tracked gap:
    // TODO(backlog: runtime-js/worker-threads-kernel-workerdata-structured-clone).
    (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
  ) {
    return;
  }
  if (typeof value !== 'object') {
    throwUnsupportedWorkerData();
  }
  if (seen.has(value)) throwUnsupportedWorkerData();
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length !== Object.keys(value).length) throwUnsupportedWorkerData();
    for (const entry of value) {
      if (entry === undefined) throwUnsupportedWorkerData();
      assertJsonCloneSafeWorkerData(entry, seen);
    }
    seen.delete(value);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throwUnsupportedWorkerData();
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (entry === undefined) throwUnsupportedWorkerData();
    assertJsonCloneSafeWorkerData(entry, seen);
  }
  seen.delete(value);
}

function throwUnsupportedWorkerData(): never {
  throw new NotImplementedError(
    'worker_threads.workerData.structuredClone',
    'kernel-backed Worker workerData currently supports only JSON-safe plain data',
  );
}

function decodeWorkerData(encoded: string | undefined): unknown {
  if (encoded === undefined) return undefined;
  return JSON.parse(encoded) as unknown;
}

const worker_threads: Record<string, unknown> = {
  Worker,
  MessageChannel: globalThis.MessageChannel,
  markAsUntransferable,
  isMarkedAsUntransferable,
  markAsUncloneable,
};

Object.defineProperties(worker_threads, {
  isMainThread: {
    enumerable: true,
    get: () => activeWorkerContext() === null,
  },
  parentPort: {
    enumerable: true,
    get: () => activeWorkerContext()?.parentPort ?? null,
  },
  threadId: {
    enumerable: true,
    get: () => activeWorkerContext()?.threadId ?? 0,
  },
  workerData: {
    enumerable: true,
    get: () => activeWorkerContext()?.workerData,
  },
});
export default worker_threads;
