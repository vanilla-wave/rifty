/**
 * Owner-realm supervised dev-server child (ADR-0150 P6b): the dev server runs in
 * a serve:true child worker reading+writing the owner store over fs.* sync-RPC
 * (RIFTY_REMOTE_FS=1). The owner stays a free async supervisor — blocking work
 * (vite transform/install) left its thread. Mirrors owner-child-bin-executor.ts,
 * but the child is a long-lived SERVER (serve:true), not run-to-completion.
 */
import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { type DevServerChildMessage, isDevServerChildMessage } from '../glue/dev-server-ipc.ts';
import type { DevServerHandle } from './dev-server-controller.ts';

export interface DevServerChildSpawnParams {
  readonly templateId: string;
  readonly slug: string;
  readonly setup: 'instant' | 'from-scratch';
  readonly root: string;
  /** The template's real dev port (distinct from the owner's 59124 bridge key). */
  readonly devPort: number;
}

/** Pure: build the spawn spec for the dev-server child (unit-tested). */
export function buildDevServerChildSpawnSpec(
  params: DevServerChildSpawnParams,
  devServerWorkerUrl: string,
): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: devServerWorkerUrl },
    argv: ['rifty', 'dev-server'],
    env: {
      RIFTY_REMOTE_FS: '1',
      RIFTY_RFV_TEMPLATE: params.templateId,
      RIFTY_RFV_SLUG: params.slug,
      RIFTY_RFV_SETUP: params.setup,
      RIFTY_RFV_ROOT: params.root,
      RIFTY_DEV_PORT: String(params.devPort),
      // node-server template entries bind `process.env.PORT`; set it to the dev
      // port so the child's entry listens where the owner expects (ADR-0150 P6b).
      // The in-realm `process.env.PORT` mutation in dev-server-boot doesn't reach
      // the entry across the PROD process-globals clobber — the entry reads its
      // env from the spawn-time KernelProcessSpec.env (the clobber-safe source),
      // which inherits the OWNER's PORT (the default vite template's 5174) unless
      // we override it here.
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
  send(message: unknown): unknown;
  kill(signal?: string): unknown;
}

export interface DevServerChildBootOpts {
  readonly signal: AbortSignal;
  readonly log: (chunk: string) => void;
  readonly params: DevServerChildSpawnParams;
  /** Owner re-publishes its snapshot when the child reports its store changed. */
  readonly onSnapshotDirty: () => void;
  /**
   * Drain the OWNER realm's OPFS write-through before boot resolves (ADR-0072 /
   * ADR-0150 P6b). The child writes node_modules into the owner store over fs.*
   * RPC, filling the owner's async write-through queue; the child's own
   * `flushSyncMirror` is a no-op (its remote `SyncRpcFsSync` has no `flush`). So
   * on `rifty:dev-ready` the owner drains ITS queue here — matching the pre-P6b
   * in-owner install flush — leaving the queue empty for subsequent (small)
   * shell writes, which then persist to durable OPFS before a reload terminates
   * the owner worker. Optional: absent on the memory backend (flush no-ops).
   */
  readonly flush?: () => Promise<void>;
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
  spawn: (spec: SpawnWorkerSpec) => DevServerChildHandle = (spec) => {
    const h = globalProcessManager.spawnWorker('dev-server', spec, 1);
    if (h.kind !== 'worker') {
      throw new Error(`owner-child-dev-server: expected worker handle, got ${h.kind}`);
    }
    return h as unknown as DevServerChildHandle;
  },
): OwnerChildDevServer {
  return {
    boot(opts: DevServerChildBootOpts): Promise<DevServerHandle> {
      return new Promise<DevServerHandle>((resolve, reject) => {
        const handle = spawn(buildDevServerChildSpawnSpec(opts.params, devServerWorkerUrl));
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

        const makeHandle = (port: number): DevServerHandle => ({
          port,
          onFileChanged(path: string) {
            handle.send({ type: 'rifty:dev-file-changed', path });
          },
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
            // Drain the OWNER's OPFS write-through (the child's install landed in
            // it over fs.* RPC) BEFORE resolving — so the controller goes LIVE
            // only once the owner store is durable, matching the pre-P6b in-owner
            // install flush. `flush` never rejects (flushSyncMirror swallows);
            // a stray rejection still resolves boot (the server IS listening).
            const ready = m.port;
            Promise.resolve(opts.flush?.()).then(
              () => finish(() => resolve(makeHandle(ready))),
              () => finish(() => resolve(makeHandle(ready))),
            );
          } else if (m.type === 'rifty:dev-error') finish(() => reject(new Error(m.message)));
          else if (m.type === 'rifty:dev-snapshot') opts.onSnapshotDirty();
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
