import { globalProcessManager, isSabIpcSupported as realIsSabIpcSupported } from '@riftydev/kernel';
import {
  type CrossRealmPortHandler,
  bridgeCrossRealmPreview as realBridgeCrossRealmPreview,
  registerPort as realRegisterPort,
  unregisterPort as realUnregisterPort,
} from '@riftydev/net';
import { NotImplementedError } from '@riftydev/vfs';
import { previewUrlForPort } from './preview-binding.ts';
import { mountPlaygroundPreviewBridge as realMountPreviewBridge } from './preview-bridge-wiring.ts';
import type { ProjectSpec } from './project-spec.ts';
import { defaultProjectSpec } from './registry.ts';
import { type VfsWriteFrame, sendVfsWrite as realSendVfsWrite } from './vfs-write-port.ts';

export type RuntimeSessionSetup = 'instant' | 'from-scratch';

export interface RuntimeSessionOptions {
  readonly bootstrapWorkerUrl: string | URL;
  readonly root?: string;
  readonly entry?: string;
  readonly port?: number;
  readonly template?: ProjectSpec;
  readonly setup?: RuntimeSessionSetup;
  readonly slug?: string;
  readonly onLog?: (line: string) => void;
}

export interface RuntimeSessionStartOptions {
  readonly bootstrapWorkerUrl: string;
  readonly root: string;
  readonly entry: string;
  readonly port: number;
  readonly template: ProjectSpec;
  readonly setup: RuntimeSessionSetup;
  readonly slug: string;
  readonly onLog: (line: string) => void;
}

export interface RuntimeSessionStartHandle {
  close(): Promise<void>;
  updateFile?(path: string, content: string): void;
  applyVfsFrame?(frame: VfsWriteFrame): void;
  readonly closed?: Promise<number | null>;
  readonly ready?: Promise<void>;
}

interface DataEmitterLike {
  on(event: 'data', cb: (chunk: unknown) => void): void;
}

interface RuntimeWorkerHandle {
  readonly kind: string;
  stdout(): DataEmitterLike;
  stderr(): DataEmitterLike;
  on(event: 'exit', cb: (code?: unknown) => void): void;
  send?(message: unknown): boolean;
  kill(signal: string): void;
}

interface RuntimeWorkerSpawnSpec {
  readonly entry: { readonly kind: 'url'; readonly url: string };
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

interface RuntimeWorkerSpawnOptions {
  readonly cwd: string;
}

export interface RuntimeSessionDeps {
  readonly start?: (opts: RuntimeSessionStartOptions) => Promise<RuntimeSessionStartHandle>;
  readonly isSabIpcSupported?: () => boolean;
  readonly spawnWorker?: (
    name: string,
    spec: RuntimeWorkerSpawnSpec,
    ppid: number,
    opts: RuntimeWorkerSpawnOptions,
  ) => RuntimeWorkerHandle;
  readonly bridgeCrossRealmPreview?: (port: number) => CrossRealmPortHandler;
  readonly registerPort?: (port: number, handler: CrossRealmPortHandler) => void;
  readonly unregisterPort?: (port: number) => void;
  readonly mountPreviewBridge?: (
    bridge: CrossRealmPortHandler,
    opts: { readonly ownerToken?: string },
  ) => () => void;
  readonly sendVfsWrite?: (port: number, frame: VfsWriteFrame) => void;
  readonly createPreviewOwnerToken?: () => string;
}

export interface RuntimeSession {
  readonly port: number;
  readonly root: string;
  readonly entryPath: string;
  readonly previewUrl: string;
  readonly ready: Promise<void>;
  readonly closed: Promise<number | null>;
  updateEntry(content: string): void;
  updateFile(path: string, content: string): void;
  applyVfsFrame(frame: VfsWriteFrame): void;
  close(): Promise<void>;
}

export async function createRuntimeSession(
  opts: RuntimeSessionOptions,
  deps: RuntimeSessionDeps = {},
): Promise<RuntimeSession> {
  const template = opts.template ?? defaultProjectSpec();
  const root = opts.root ?? '/workspace';
  const entry = opts.entry ?? template.entry.relativePath;
  const port = opts.port ?? template.defaultPort;
  const setup = opts.setup ?? 'instant';
  const slug = opts.slug ?? template.id;
  const onLog = opts.onLog ?? (() => {});
  const entryPath = `${root}${entry}`;
  const startOptions: RuntimeSessionStartOptions = {
    bootstrapWorkerUrl: String(opts.bootstrapWorkerUrl),
    root,
    entry,
    port,
    template,
    setup,
    slug,
    onLog,
  };
  const handle = deps.start
    ? await deps.start(startOptions)
    : await startRuntimeSession(startOptions, deps);
  return {
    port,
    root,
    entryPath,
    previewUrl: previewUrlForPort(port),
    ready: handle.ready ?? Promise.resolve(),
    closed: handle.closed ?? new Promise<number | null>(() => {}),
    updateEntry(content) {
      handle.updateFile?.(entryPath, content);
    },
    updateFile(path, content) {
      handle.updateFile?.(path, content);
    },
    applyVfsFrame(frame) {
      handle.applyVfsFrame?.(frame);
    },
    close() {
      return handle.close();
    },
  };
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const READY_LOG_MARKER = '[real-vite/worker] node_modules read bridge ready';

function createPreviewOwnerToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function startRuntimeSession(
  opts: RuntimeSessionStartOptions,
  deps: RuntimeSessionDeps,
): Promise<RuntimeSessionStartHandle> {
  const isSabIpcSupported = deps.isSabIpcSupported ?? realIsSabIpcSupported;
  if (!isSabIpcSupported()) {
    throw new NotImplementedError(
      'createRuntimeSession',
      'requires SAB IPC (cross-origin isolation) — toggle the host headers ' +
        'or run inside a host that serves COOP/COEP headers.',
    );
  }

  const ownerToken = (deps.createPreviewOwnerToken ?? createPreviewOwnerToken)();
  const spawnWorker =
    deps.spawnWorker ??
    ((name, spec, ppid, spawnOpts) =>
      globalProcessManager.spawnWorker(name, spec, ppid, spawnOpts) as RuntimeWorkerHandle);

  opts.onLog(
    `[workbench] spawning ${opts.template.displayName} worker with bootstrap ${opts.bootstrapWorkerUrl}\n`,
  );
  const handle = spawnWorker(
    'real-vite',
    {
      entry: { kind: 'url', url: opts.bootstrapWorkerUrl },
      argv: ['rifty', 'real-vite'],
      env: {
        RIFTY_RFV_PORT: String(opts.port),
        RIFTY_RFV_ROOT: opts.root,
        RIFTY_RFV_ENTRY: opts.entry,
        RIFTY_RFV_TEMPLATE: opts.template.id,
        RIFTY_RFV_SETUP: opts.setup,
        RIFTY_RFV_SLUG: opts.slug,
        RIFTY_PREVIEW_OWNER_TOKEN: ownerToken,
        PORT: String(opts.port),
      },
      cwd: opts.root,
    },
    1,
    { cwd: opts.root },
  );

  if (handle.kind !== 'worker') {
    throw new NotImplementedError(
      'createRuntimeSession',
      `globalProcessManager.spawnWorker returned kind=${handle.kind}; expected 'worker'`,
    );
  }

  const decodeChunk = (chunk: unknown): string => {
    if (chunk instanceof Uint8Array) return dec.decode(chunk);
    if (chunk instanceof ArrayBuffer) return dec.decode(new Uint8Array(chunk));
    if (ArrayBuffer.isView(chunk)) {
      return dec.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    return typeof chunk === 'string' ? chunk : '';
  };
  let resolveReady: () => void = () => {};
  let rejectReady: (reason: unknown) => void = () => {};
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve();
    };
    rejectReady = (reason) => {
      if (readySettled) return;
      readySettled = true;
      reject(reason);
    };
  });
  void ready.catch(() => undefined);
  const observeReady = (text: string): void => {
    if (text.includes(READY_LOG_MARKER)) resolveReady();
  };
  handle.stdout().on('data', (chunk) => {
    const text = decodeChunk(chunk);
    if (text) {
      observeReady(text);
      opts.onLog(text);
    }
  });
  handle.stderr().on('data', (chunk) => {
    const text = decodeChunk(chunk);
    if (text) opts.onLog(text);
  });

  let exited = false;
  let resolveClosed: (code: number | null) => void = () => {};
  const closed = new Promise<number | null>((resolve) => {
    resolveClosed = resolve;
  });
  handle.on('exit', (code?: unknown) => {
    exited = true;
    rejectReady(new Error(`runtime session exited before ready (${String(code ?? 'null')})`));
    resolveClosed(typeof code === 'number' ? code : null);
  });

  const bridgeCrossRealmPreview = deps.bridgeCrossRealmPreview ?? realBridgeCrossRealmPreview;
  const registerPort = deps.registerPort ?? realRegisterPort;
  const unregisterPort = deps.unregisterPort ?? realUnregisterPort;
  const mountPreviewBridge = deps.mountPreviewBridge ?? realMountPreviewBridge;
  const sendVfsWrite = deps.sendVfsWrite ?? realSendVfsWrite;

  const previewBridge = bridgeCrossRealmPreview(opts.port);
  registerPort(opts.port, previewBridge);
  const tearSwBridge = mountPreviewBridge(previewBridge, { ownerToken });

  opts.onLog(`[workbench] page-side preview-port bridge ready (port ${opts.port})\n`);

  let closedByHost = false;
  const applyVfsFrame = (frame: VfsWriteFrame): void => {
    if (!handle.send?.({ type: 'rifty:vfs-write', frame })) {
      sendVfsWrite(opts.port, frame);
    }
  };
  return {
    closed,
    ready,
    async close() {
      if (closedByHost) return;
      closedByHost = true;
      tearSwBridge();
      unregisterPort(opts.port);
      previewBridge.dispose();
      if (!exited) handle.kill('SIGTERM');
    },
    applyVfsFrame,
    updateFile(path, content) {
      applyVfsFrame({
        type: 'write',
        path,
        data: enc.encode(content),
      });
    },
  };
}
