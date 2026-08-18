/// <reference lib="webworker" />
/**
 * First-open durability-progress carrier (#256, epic project-open-drain-latency)
 * — DESIGNED RED with first-open-progress.spec.ts.
 *
 * Drives the REAL `runWorkbenchOwner` composition in THIS plain worker realm
 * with a FAKE KernelIpc (no kernel pre-entry, no fork IPC) and REAL OPFS
 * (`storage.persistence: 'preferred'`): one real FIRST project open — ~2 000
 * inline starter files across ~200 dirs + empty-deps `/package.json` — whose
 * stage-write → promote → install-stamp → flush() pipeline drains every
 * materialization op through real OPFS before `workbench:project-opened`.
 * EVERY owner→page ipc message is recorded in order.
 *
 * DESIGNED RED on main: on the first-open path the drain owner is MUTE — the
 * ADR-0359 `emitDurabilityProgress` slot binds only after createProject, so
 * zero `workbench:durability-progress`-shaped messages ever arrive. The spec's
 * final `progressCount > 0` assert is the designed RED; everything else
 * (open succeeds, tree persisted in real OPFS) passes on main.
 *
 * Realm shims replacing the kernel pre-entry (ADR-0157): minimal
 * `globalThis.process` (stdout/stderr.write → console, env) + the production
 * bootstrap mirror (registerNetBuiltins, registerSqliteBuiltin,
 * installBundleLocalBuffer, setProcessCwd('/')).
 */
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import {
  defineNodeCliProject,
  inspectProjectDefinition,
  projectDefinitionWire,
} from '../../../packages/workbench/src/workbench/project-definition.ts';
import { runWorkbenchOwner } from '../../../packages/workbench/src/workers/workbench-owner-runtime.ts';
import {
  type KernelIpc,
  installBundleLocalBuffer,
} from '../../../packages/workbench/src/workers/worker-runtime-globals.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

const PROJECT_ID = 'first-open-256';
const OPEN_OP_ID = 'first-open-256-open';
const DIR_COUNT = 200;
const FILES_PER_DIR = 10;

interface FirstOpenDeployment {
  readonly workers: {
    readonly kernel: string;
    readonly node: string;
    readonly devServer: string;
  };
  readonly wasm: { readonly sqlite: string };
}

interface IpcMessageRecord {
  readonly seq: number;
  readonly type: string;
  readonly detail?: string;
}

interface ProgressRecord {
  readonly seq: number;
  readonly persisted: number;
  readonly total: number;
}

interface FirstOpenResult {
  readonly messages: readonly IpcMessageRecord[];
  /** Terminal reply observed for the open op (or boot/crash failure type). */
  readonly replyKind: string;
  /** Global seq of the open reply — every drain progress message must precede it. */
  readonly replySeq: number;
  readonly failure: string | null;
  /** Owner→page messages structurally shaped {type:'workbench:durability-progress'} — 0 on main. */
  readonly progressCount: number;
  /** Ordered payloads of those messages (empty on main). */
  readonly progress: readonly ProgressRecord[];
  /** Evidence: project-vfs frames carrying 'rifty:owner-vfs-durability-progress'. */
  readonly vfsDurabilityFrameCount: number;
  readonly fileCount: number;
  readonly dirCount: number;
  /** Files found by a REAL post-reply OPFS walk of the persisted project tree; -1 = tree absent. */
  readonly persistedProjectFiles: number;
  readonly timings: {
    readonly readyMs: number;
    readonly openMs: number;
    readonly totalMs: number;
  };
}

/** Kernel-pre-entry replacement: the two surfaces the owner composition reads. */
function installOwnerProcessShim(): void {
  const write =
    (stream: 'stdout' | 'stderr') =>
    (chunk: string | Uint8Array): boolean => {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      console.log(`[owner:${stream}] ${text.replace(/\n$/, '')}`);
      return true;
    };
  Object.defineProperty(globalThis, 'process', {
    value: {
      stdout: { write: write('stdout') },
      stderr: { write: write('stderr') },
      env: {} as Record<string, string | undefined>,
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/** ~2 000 deterministic small files across ~200 dirs + empty-deps manifest. */
function synthesizeStarterFiles(): Record<string, string> {
  const files: Record<string, string> = {
    '/package.json': '{"name":"first-open-256","private":true,"type":"module"}\n',
    '/main.mjs': "console.log('first-open-256');\n",
  };
  for (let dir = 0; dir < DIR_COUNT; dir += 1) {
    const dirName = `d${String(dir).padStart(3, '0')}`;
    for (let file = 0; file < FILES_PER_DIR; file += 1) {
      files[`/src/${dirName}/f${file}.txt`] =
        `${dirName}/f${file}:${(dir * FILES_PER_DIR + file) % 251}\n`;
    }
  }
  return files;
}

function distinctDirCount(files: Readonly<Record<string, string>>): number {
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    let cut = path.lastIndexOf('/');
    while (cut > 0) {
      const prefix = path.slice(0, cut);
      if (dirs.has(prefix)) break;
      dirs.add(prefix);
      cut = prefix.lastIndexOf('/');
    }
  }
  return dirs.size;
}

interface OpfsDirHandle {
  keys(): AsyncIterable<string>;
  entries(): AsyncIterable<readonly [string, { readonly kind: string }]>;
  getDirectoryHandle(name: string): Promise<OpfsDirHandle>;
  removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void>;
}

async function opfsRoot(): Promise<OpfsDirHandle> {
  const storage = (navigator as unknown as { storage: { getDirectory(): Promise<unknown> } })
    .storage;
  return (await storage.getDirectory()) as OpfsDirHandle;
}

/** Hermetic run: the whole origin OPFS is torn down before the owner boots. */
async function resetOpfs(): Promise<void> {
  const root = await opfsRoot();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  for (const name of names) {
    await root.removeEntry(name, { recursive: true }).catch(() => {});
  }
}

/** Post-reply proof the drain flushed through REAL OPFS: walk the persisted tree. */
async function countPersistedProjectFiles(): Promise<number> {
  const segments = ['.rifty', 'workbench', 'v1', 'projects', PROJECT_ID, 'tree'];
  let dir: OpfsDirHandle;
  try {
    dir = await opfsRoot();
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment);
  } catch {
    return -1;
  }
  let files = 0;
  const walk = async (handle: OpfsDirHandle): Promise<void> => {
    for await (const [, entry] of handle.entries()) {
      if (entry.kind === 'file') files += 1;
      else await walk(entry as unknown as OpfsDirHandle);
    }
  };
  await walk(dir);
  return files;
}

function describeOwnerMessage(raw: unknown): { readonly type: string; readonly detail?: string } {
  const m = raw as {
    readonly type?: unknown;
    readonly opId?: unknown;
    readonly frame?: { readonly type?: unknown };
    readonly error?: { readonly name?: unknown; readonly message?: unknown };
    readonly storage?: { readonly backend?: unknown; readonly durability?: unknown };
    readonly projectRoot?: unknown;
  };
  const type = typeof m.type === 'string' ? m.type : `non-string:${String(m.type)}`;
  const parts: string[] = [];
  if (typeof m.opId === 'string') parts.push(`op:${m.opId}`);
  if (typeof m.frame?.type === 'string') parts.push(`frame:${m.frame.type}`);
  if (m.error !== undefined) parts.push(`${String(m.error.name)}: ${String(m.error.message)}`);
  if (m.storage !== undefined) {
    parts.push(`${String(m.storage.backend)}/${String(m.storage.durability)}`);
  }
  if (typeof m.projectRoot === 'string') parts.push(m.projectRoot);
  return parts.length === 0 ? { type } : { type, detail: parts.join(' ') };
}

async function runFirstOpen(deployment: FirstOpenDeployment): Promise<FirstOpenResult> {
  await resetOpfs();
  installOwnerProcessShim();
  registerNetBuiltins();
  registerSqliteBuiltin();
  installBundleLocalBuffer();
  setProcessCwd('/');

  const messages: IpcMessageRecord[] = [];
  const progress: ProgressRecord[] = [];
  let seq = 0;
  let progressCount = 0;
  let vfsDurabilityFrameCount = 0;
  const waiters: Array<{
    readonly match: (raw: unknown, record: IpcMessageRecord) => boolean;
    readonly resolve: (record: IpcMessageRecord) => void;
  }> = [];
  const push = (raw: unknown): void => {
    const record: IpcMessageRecord = { seq: seq++, ...describeOwnerMessage(raw) };
    messages.push(record);
    if (record.type === 'workbench:durability-progress') {
      progressCount += 1;
      const shaped = raw as { readonly persisted?: unknown; readonly total?: unknown };
      progress.push({
        seq: record.seq,
        persisted: typeof shaped.persisted === 'number' ? shaped.persisted : Number.NaN,
        total: typeof shaped.total === 'number' ? shaped.total : Number.NaN,
      });
    }
    const frameType = (raw as { readonly frame?: { readonly type?: unknown } }).frame?.type;
    if (frameType === 'rifty:owner-vfs-durability-progress') vfsDurabilityFrameCount += 1;
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index] as (typeof waiters)[number];
      if (waiter.match(raw, record)) {
        waiters.splice(index, 1);
        waiter.resolve(record);
      }
    }
  };
  const waitFor = (
    match: (raw: unknown, record: IpcMessageRecord) => boolean,
  ): Promise<IpcMessageRecord> =>
    new Promise((resolve) => {
      waiters.push({ match, resolve });
    });

  const handlers: Array<(message: unknown) => void> = [];
  const ipc: KernelIpc = {
    onMessage: (handler) => {
      handlers.push(handler);
    },
    send: push,
  };
  const deliver = (message: unknown): void => {
    for (const handler of [...handlers]) handler(message);
  };

  const t0 = performance.now();
  // Fake-IPC crash surfaces as a recorded terminal message, never a hang.
  void runWorkbenchOwner(ipc).catch((error: unknown) => {
    push({
      type: 'owner:crashed',
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  });

  const isTerminal = (record: IpcMessageRecord): boolean => record.type === 'owner:crashed';

  deliver({
    type: 'workbench:initialize',
    config: {
      deployment: {
        workers: {
          kernel: deployment.workers.kernel,
          node: deployment.workers.node,
          devServer: deployment.workers.devServer,
        },
        wasm: { sqlite: deployment.wasm.sqlite },
        previewProbeTimeoutMs: 30_000,
      },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: { persistence: 'preferred' },
    },
  });

  const files = synthesizeStarterFiles();
  const fileCount = Object.keys(files).length;
  const dirCount = distinctDirCount(files);

  const ready = await waitFor(
    (_raw, record) =>
      record.type === 'workbench:owner-ready' ||
      record.type === 'workbench:failure' ||
      isTerminal(record),
  );
  const readyMs = Math.round(performance.now() - t0);
  const finalize = (
    replyKind: string,
    replySeq: number,
    failure: string | null,
    openMs: number,
    persistedProjectFiles: number,
  ): FirstOpenResult => ({
    messages,
    replyKind,
    replySeq,
    failure,
    progressCount,
    progress,
    vfsDurabilityFrameCount,
    fileCount,
    dirCount,
    persistedProjectFiles,
    timings: { readyMs, openMs, totalMs: Math.round(performance.now() - t0) },
  });
  if (ready.type !== 'workbench:owner-ready') {
    return finalize(ready.type, ready.seq, ready.detail ?? null, 0, -1);
  }

  const definition = defineNodeCliProject({ id: PROJECT_ID, files, entryPath: '/main.mjs' });
  const wire = projectDefinitionWire(inspectProjectDefinition(definition));
  const tOpen = performance.now();
  const replyPromise = waitFor(
    (raw, record) =>
      isTerminal(record) ||
      ((record.type === 'workbench:project-opened' || record.type === 'workbench:failure') &&
        (raw as { readonly opId?: unknown }).opId === OPEN_OP_ID),
  );
  deliver({ type: 'workbench:open-project', opId: OPEN_OP_ID, definition: wire });
  const reply = await replyPromise;
  const openMs = Math.round(performance.now() - tOpen);
  const persistedProjectFiles = await countPersistedProjectFiles();
  console.log(
    `[first-open-256] reply=${reply.type} files=${fileCount} dirs=${dirCount} persisted=${persistedProjectFiles} openMs=${openMs}`,
  );
  return finalize(
    reply.type,
    reply.seq,
    reply.type === 'workbench:project-opened' ? null : (reply.detail ?? null),
    openMs,
    persistedProjectFiles,
  );
}

scope.addEventListener(
  'message',
  (event: MessageEvent<{ phase?: string; deployment?: FirstOpenDeployment }>) => {
    const { phase, deployment } = event.data ?? {};
    const run =
      phase === 'first-open' && deployment !== undefined
        ? runFirstOpen(deployment)
        : Promise.reject(new Error(`unknown phase: ${String(phase)}`));
    void run
      .then((result) => scope.postMessage({ ok: true, result }))
      .catch((err: unknown) => {
        scope.postMessage({
          ok: false,
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
      });
  },
);
