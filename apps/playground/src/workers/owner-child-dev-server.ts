/**
 * Owner-realm supervised dev-server child (ADR-0150 P6b): the dev server runs in
 * a serve:true child worker reading+writing the owner store over fs.* sync-RPC
 * (RIFTY_REMOTE_FS=1). The owner stays a free async supervisor — blocking work
 * (module loading and user code) left its thread. Mirrors owner-child-bin-executor.ts,
 * but the child is a long-lived SERVER (serve:true), not run-to-completion.
 */
import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { type DevServerChildMessage, isDevServerChildMessage } from '../glue/dev-server-ipc.ts';
import type { DevServerHandle } from './dev-server-controller.ts';

export interface DevServerChildSpawnParams {
  readonly templateId: string;
  readonly root: string;
  /** The template's real dev port (distinct from the owner's 59124 bridge key). */
  readonly devPort: number;
  readonly previewScope?: string;
}

export interface RecursiveWorkerUrls {
  readonly kernelWorkerUrl?: string;
  readonly nodeEntryWorkerUrl?: string;
}

/** Pure: build the spawn spec for the dev-server child (unit-tested). */
export function buildDevServerChildSpawnSpec(
  params: DevServerChildSpawnParams,
  devServerWorkerUrl: string,
  workerUrls: RecursiveWorkerUrls = {},
): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: devServerWorkerUrl },
    argv: ['rifty', 'dev-server'],
    env: {
      RIFTY_REMOTE_FS: '1',
      RIFTY_RFV_TEMPLATE: params.templateId,
      RIFTY_RFV_ROOT: params.root,
      RIFTY_DEV_PORT: String(params.devPort),
      ...(params.previewScope === undefined ? {} : { RIFTY_PREVIEW_SCOPE: params.previewScope }),
      // rifty has no native bindings by construction. Force napi-rs consumers
      // onto their WASI path so a failed WASI load stays loud instead of falling
      // through to the generic "Cannot find native binding" diagnostic.
      NAPI_RS_FORCE_WASI: '1',
      ...(workerUrls.kernelWorkerUrl
        ? { RIFTY_KERNEL_WORKER_URL: workerUrls.kernelWorkerUrl }
        : {}),
      ...(workerUrls.nodeEntryWorkerUrl
        ? { RIFTY_NODE_ENTRY_WORKER_URL: workerUrls.nodeEntryWorkerUrl }
        : {}),
      // node-server template entries bind `process.env.PORT`; set it to the dev
      // port so the child's entry listens where the owner expects (ADR-0150 P6b).
      // The in-realm `process.env.PORT` mutation in dev-server-boot doesn't reach
      // the entry across the PROD process-globals clobber — the entry reads its
      // env from the spawn-time KernelProcessSpec.env (the clobber-safe source),
      // which otherwise inherits the owner's spawn-time PORT unless overridden.
      PORT: String(params.devPort),
    },
    cwd: params.root,
    // ADR-0144: serve:true — the kernel does NOT reap the realm when the entry's
    // setup finishes; the dev server stays listening until the owner kills it.
    serve: true,
  };
}

/** Read-side stream subset (matches WorkerProcessHandle.stdout()/stderr()). */
interface DevReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/** WorkerProcessHandle surface the dev-server driver needs. */
export interface DevServerChildHandle {
  readonly kind: string;
  stdout(): DevReadable;
  stderr(): DevReadable;
  on(event: 'exit', listener: (code?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  kill(signal?: string): unknown;
}

export interface DevServerChildBootOpts {
  readonly signal: AbortSignal;
  readonly log: (chunk: string) => void;
  readonly params: DevServerChildSpawnParams;
  /** Owner re-publishes its snapshot when the child reports its store changed. */
  readonly onSnapshotDirty: () => void;
  /**
   * Post-ready listening-port changes (`rifty:dev-ports`): the entry called
   * `server.close()` / re-listened. `ports` is the child's FULL current set.
   */
  readonly onPortsChanged?: (ports: readonly number[], previewScope?: string) => void;
  /**
   * Drain the OWNER realm's OPFS write-through before boot resolves (ADR-0072 /
   * ADR-0150 P6b). The child may write into the owner store over fs.* RPC,
   * filling the owner's async write-through queue; the child's own
   * `flushSyncMirror` is a no-op (its remote `SyncRpcFsSync` has no `flush`). So
   * on `rifty:dev-ready` the owner drains its queue here before publishing a
   * live server. Optional: absent on the memory backend (flush no-ops).
   * Ordering-only: the persist report (ADR-0187 Corrected) is ignored here.
   */
  readonly flush?: () => Promise<unknown>;
}

export interface OwnerChildDevServer {
  boot(opts: DevServerChildBootOpts): Promise<DevServerHandle>;
}

const decoder = new TextDecoder();
function decodeChunk(chunk: unknown): string {
  if (chunk instanceof Uint8Array) return decoder.decode(chunk);
  if (chunk instanceof ArrayBuffer) return decoder.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return typeof chunk === 'string' ? chunk : '';
}

/**
 * Build the owner's dev-server child driver. `spawn` is injected so the host
 * wires `globalProcessManager.spawnWorker` while unit tests drive a fake handle
 * (the real Worker is an e2e-only boundary, like owner-child-bin-executor).
 */
export function createOwnerChildDevServer(
  devServerWorkerUrl: string,
  workerUrlsOrSpawn: RecursiveWorkerUrls | ((spec: SpawnWorkerSpec) => DevServerChildHandle) = {},
  maybeSpawn?: (spec: SpawnWorkerSpec) => DevServerChildHandle,
): OwnerChildDevServer {
  const workerUrls = typeof workerUrlsOrSpawn === 'function' ? {} : workerUrlsOrSpawn;
  const spawn =
    typeof workerUrlsOrSpawn === 'function'
      ? workerUrlsOrSpawn
      : (maybeSpawn ??
        ((spec: SpawnWorkerSpec) => {
          const h = globalProcessManager.spawnWorker('dev-server', spec, 1);
          if (h.kind !== 'worker') {
            throw new Error(`owner-child-dev-server: expected worker handle, got ${h.kind}`);
          }
          return h as unknown as DevServerChildHandle;
        }));
  return {
    boot(opts: DevServerChildBootOpts): Promise<DevServerHandle> {
      return new Promise<DevServerHandle>((resolve, reject) => {
        const handle = spawn(
          buildDevServerChildSpawnSpec(opts.params, devServerWorkerUrl, workerUrls),
        );
        let outputClosed = false;
        const writeLog = (chunk: unknown): void => {
          if (outputClosed) return;
          const text = decodeChunk(chunk);
          if (text) opts.log(text);
        };
        handle.stdout().on('data', writeLog);
        handle.stderr().on('data', writeLog);

        let settled = false;
        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          fn();
        };

        const makeHandle = (port: number, previewScope?: string): DevServerHandle => ({
          port,
          ...(previewScope === undefined ? {} : { previewScope }),
          async stop() {
            outputClosed = true;
            await new Promise<void>((res) => {
              handle.on('exit', () => res());
              // kill() returns false when the child has ALREADY exited (a
              // post-ready crash): an already-dead handle emits NO 'exit', so
              // resolve now instead of awaiting a frame that never comes — else a
              // Ctrl-C recovery after a mid-run crash hangs the dev-run forever.
              // TODO(backlog: shell/dev-server-child-exit-unobserved)
              if (handle.kill('SIGTERM') === false) res();
            });
          },
        });

        handle.on('message', (message: unknown) => {
          if (!isDevServerChildMessage(message)) return;
          const m = message as DevServerChildMessage;
          if (m.type === 'rifty:dev-ready') {
            // Drain the owner's OPFS write-through before resolving. A stray
            // rejection still resolves boot: the server is already listening.
            const ready = m.port;
            Promise.resolve(opts.flush?.()).then(
              () => finish(() => resolve(makeHandle(ready, m.previewScope))),
              () => finish(() => resolve(makeHandle(ready, m.previewScope))),
            );
          } else if (m.type === 'rifty:dev-error') finish(() => reject(new Error(m.message)));
          else if (m.type === 'rifty:dev-snapshot') opts.onSnapshotDirty();
          else if (m.type === 'rifty:dev-ports' && settled) {
            // Only meaningful after ready (boot resolution owns the first port).
            opts.onPortsChanged?.(m.ports, m.previewScope);
          }
        });

        // Boot-window only: a child exit BEFORE ready rejects boot. A post-ready
        // exit (mid-run crash) is currently unobserved (the controller parks on
        // onceAborted) → stale LIVE pill until Ctrl-C. Fixing it needs a
        // controller transition (left "state machine unchanged" for P6b).
        // TODO(backlog: shell/dev-server-child-exit-unobserved)
        handle.on('exit', () => {
          finish(() => reject(new Error('dev-server child exited before listening')));
        });
      });
    },
  };
}
