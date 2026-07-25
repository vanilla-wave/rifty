/**
 * Owner-realm supervised dev-server child (ADR-0150 P6b): the dev server runs in
 * a serve:true child worker reading+writing the owner store over fs.* sync-RPC
 * (RIFTY_REMOTE_FS=1). The owner stays a free async supervisor — blocking work
 * (module loading and user code) left its thread. Mirrors owner-child-bin-executor.ts,
 * but the child is a long-lived SERVER (serve:true), not run-to-completion.
 */
import {
  type KernelEntryCapabilityPorts,
  type SpawnWorkerSpec,
  globalProcessManager,
} from '@riftydev/kernel';
import type { ProcessExit } from '@riftydev/shell';
import {
  type ChildTerminalContext,
  bindChildTerminalResize,
  childTerminalBootstrap,
} from '../glue/child-terminal.ts';
import { type DevServerChildMessage, isDevServerChildMessage } from '../glue/dev-server-ipc.ts';
import { processExitFromChildEvent } from '../glue/process-exit.ts';
import type { NodeServerPackageConfig } from '../workbench/internal/project-package-config.ts';
import { buildDevServerChildEntry } from './dev-server-child-config.ts';
import {
  type DevServerFailure,
  DevServerRunError,
  type SupervisedDevServerHandle,
} from './dev-server-controller.ts';
import type { NodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';
import {
  type ReserveOwnerChildAdmission,
  abortOwnerChildAdmissionAfterSpawn,
  abortOwnerChildAdmissionBeforeSpawn,
  attachOwnerChildCapabilities,
  commitOwnerChildAdmission,
  observeOwnerChildExit,
} from './owner-child-admission.ts';

export interface DevServerChildSpawnParams extends ChildTerminalContext {
  readonly cfg: NodeServerPackageConfig;
  readonly env: Readonly<Record<string, string>>;
  readonly remoteFsRoot?: string;
  readonly previewScope?: string;
}

/** Pure: build the spawn spec for the dev-server child (unit-tested). */
export function buildDevServerChildSpawnSpec(
  params: DevServerChildSpawnParams,
  devServerWorkerUrl: string,
  nodeWorkerRuntime: NodeWorkerRuntimeConfig,
  capabilityPorts?: KernelEntryCapabilityPorts,
): SpawnWorkerSpec {
  const entry = buildDevServerChildEntry(devServerWorkerUrl, {
    nodeWorkerRuntime,
    cfg: params.cfg,
    terminal: childTerminalBootstrap(params),
    ...(params.remoteFsRoot === undefined ? {} : { remoteFsRoot: params.remoteFsRoot }),
    ...(params.previewScope === undefined ? {} : { previewScope: params.previewScope }),
  });
  return {
    entry:
      capabilityPorts === undefined ? entry : attachOwnerChildCapabilities(entry, capabilityPorts),
    argv: ['rifty', params.cfg.entryPath],
    env: {
      ...params.env,
      // rifty has no native bindings by construction. Force napi-rs consumers
      // onto their WASI path so a failed WASI load stays loud instead of falling
      // through to the generic "Cannot find native binding" diagnostic.
      NAPI_RS_FORCE_WASI: '1',
      // node-server template entries bind `process.env.PORT`; set it to the dev
      // port so the child's entry listens where the owner expects (ADR-0150 P6b).
      // The in-realm `process.env.PORT` mutation in dev-server-boot doesn't reach
      // the entry across the PROD process-globals clobber — the entry reads its
      // env from the spawn-time KernelProcessSpec.env (the clobber-safe source),
      // which otherwise inherits the owner's spawn-time PORT unless overridden.
      PORT: String(params.cfg.port),
    },
    cwd: params.cfg.root,
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
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  resize(cols: number, rows: number): unknown;
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
  boot(opts: DevServerChildBootOpts): Promise<SupervisedDevServerHandle>;
}

const decoder = new TextDecoder();
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

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
  nodeWorkerRuntime: NodeWorkerRuntimeConfig,
  reserveAdmission: ReserveOwnerChildAdmission,
  spawn: (spec: SpawnWorkerSpec) => DevServerChildHandle = (spec: SpawnWorkerSpec) => {
    const h = globalProcessManager.spawnWorker('dev-server', spec, 1);
    if (h.kind !== 'worker') {
      throw new Error(`owner-child-dev-server: expected worker handle, got ${h.kind}`);
    }
    return h as unknown as DevServerChildHandle;
  },
): OwnerChildDevServer {
  return {
    async boot(opts: DevServerChildBootOpts): Promise<SupervisedDevServerHandle> {
      const reservation = await reserveAdmission(opts.params.cfg.entryPath);
      let handle: DevServerChildHandle;
      try {
        handle = spawn(
          buildDevServerChildSpawnSpec(
            opts.params,
            devServerWorkerUrl,
            nodeWorkerRuntime,
            reservation.snapshot.capabilityPorts,
          ),
        );
      } catch (error) {
        abortOwnerChildAdmissionBeforeSpawn(reservation, error);
        throw error;
      }
      const admissionExit = observeOwnerChildExit(handle);
      let setupError: unknown;
      const boot = new Promise<SupervisedDevServerHandle>((resolve, reject) => {
        try {
          let outputClosed = false;
          const writeLog = (chunk: unknown): void => {
            if (outputClosed) return;
            const text = decodeChunk(chunk);
            if (text) opts.log(text);
          };
          handle.stdout().on('data', writeLog);
          handle.stderr().on('data', writeLog);

          let settled = false;
          let listening = false;
          const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            fn();
          };

          let childExited = false;
          let bootFault: Error | undefined;
          let stopRequested = false;
          let failureReported = false;
          let resolveFailure!: (failure: DevServerFailure) => void;
          const failure = new Promise<DevServerFailure>((res) => {
            resolveFailure = res;
          });
          const reportFailure = (next: DevServerFailure): void => {
            if (failureReported || stopRequested) return;
            failureReported = true;
            resolveFailure(next);
          };
          let physicalExitSettled = false;
          let resolvePhysicalExit!: (exit: ProcessExit) => void;
          let rejectPhysicalExit!: (error: Error) => void;
          const physicalExit = new Promise<ProcessExit>((resolveExit, rejectExit) => {
            resolvePhysicalExit = resolveExit;
            rejectPhysicalExit = rejectExit;
          });
          void physicalExit.catch(() => {});
          const failPhysicalExit = (error: Error): void => {
            if (physicalExitSettled) return;
            physicalExitSettled = true;
            rejectPhysicalExit(error);
          };
          const finishPhysicalExit = (exit: ProcessExit): void => {
            if (physicalExitSettled) return;
            physicalExitSettled = true;
            resolvePhysicalExit(exit);
          };
          let resizeCleanup = (): void => {};
          let resizeAbortBound = false;
          const onResizeAbort = (): void => {
            if (!listening && !childExited) {
              failChild(new Error('dev-server boot aborted before ready'));
              return;
            }
            try {
              stopResize();
            } catch (error) {
              failChild(error);
            }
          };
          const stopResize = (): void => {
            if (resizeAbortBound) {
              resizeAbortBound = false;
              opts.signal.removeEventListener('abort', onResizeAbort);
            }
            const cleanup = resizeCleanup;
            resizeCleanup = () => {};
            cleanup();
          };
          let failingChild = false;
          const failChild = (error: unknown): Error => {
            if (bootFault) return bootFault;
            failingChild = true;
            const cause = asError(error);
            let cleanupError: Error | undefined;
            try {
              stopResize();
            } catch (cleanupFailure) {
              cleanupError = asError(cleanupFailure);
            }
            bootFault = cleanupError
              ? new AggregateError([cause, cleanupError], 'dev-server child lifecycle failed')
              : cause;
            outputClosed = true;
            try {
              if (handle.kill('SIGTERM') === false) {
                failPhysicalExit(new Error('dev-server child closed without an exit event'));
                finish(() => reject(bootFault!));
              }
            } catch (killError) {
              bootFault = new AggregateError(
                [bootFault, asError(killError)],
                'dev-server child lifecycle failed and kill threw',
              );
              failPhysicalExit(bootFault);
              finish(() => reject(bootFault!));
            }
            failingChild = false;
            if (listening) reportFailure({ kind: 'error', error: bootFault });
            return bootFault;
          };

          const makeHandle = (port: number, previewScope?: string): SupervisedDevServerHandle => {
            let stopPromise: Promise<ProcessExit> | undefined;
            return {
              port,
              ...(previewScope === undefined ? {} : { previewScope }),
              failure,
              stop() {
                if (stopPromise) return stopPromise;
                stopRequested = true;
                outputClosed = true;
                stopPromise = (async () => {
                  let cleanupError: Error | undefined;
                  try {
                    stopResize();
                  } catch (error) {
                    cleanupError = asError(error);
                  }
                  if (!childExited) {
                    try {
                      if (handle.kill('SIGTERM') === false && !childExited) {
                        failPhysicalExit(
                          new Error('dev-server child closed without an exit event'),
                        );
                      }
                    } catch (error) {
                      failPhysicalExit(asError(error));
                    }
                  }
                  let exit: ProcessExit;
                  try {
                    exit = await physicalExit;
                  } catch (error) {
                    if (cleanupError) {
                      throw new AggregateError(
                        [asError(error), cleanupError],
                        'dev-server child stop failed',
                      );
                    }
                    throw error;
                  }
                  if (cleanupError) throw cleanupError;
                  return exit;
                })();
                return stopPromise;
              },
            };
          };

          handle.on('message', (message: unknown) => {
            if (!isDevServerChildMessage(message)) return;
            const m = message as DevServerChildMessage;
            if (m.type === 'rifty:dev-ready') {
              if (bootFault || childExited || opts.signal.aborted) return;
              // Drain the owner's OPFS write-through before resolving. A stray
              // rejection still resolves boot: the server is already listening.
              const port = m.port;
              Promise.resolve(opts.flush?.()).then(
                () =>
                  finish(() => {
                    listening = true;
                    resolve(makeHandle(port, m.previewScope));
                  }),
                () =>
                  finish(() => {
                    listening = true;
                    resolve(makeHandle(port, m.previewScope));
                  }),
              );
            } else if (m.type === 'rifty:dev-error') failChild(new Error(m.message));
            else if (m.type === 'rifty:dev-snapshot') opts.onSnapshotDirty();
            else if (m.type === 'rifty:dev-ports' && listening) {
              // Only meaningful after ready (boot resolution owns the first port).
              opts.onPortsChanged?.(m.ports, m.previewScope);
            }
          });

          handle.on('exit', (code, signal) => {
            childExited = true;
            outputClosed = true;
            let exit: ProcessExit | undefined;
            let invalidExit: Error | undefined;
            try {
              exit = processExitFromChildEvent(code, signal);
              finishPhysicalExit(exit);
            } catch (error) {
              invalidExit = asError(error);
              failPhysicalExit(invalidExit);
            }
            let cleanupError: Error | undefined;
            try {
              stopResize();
            } catch (error) {
              cleanupError = asError(error);
            }
            if (invalidExit) {
              const lifecycleError = cleanupError
                ? new AggregateError(
                    [invalidExit, cleanupError],
                    'dev-server child emitted an invalid exit and resize cleanup failed',
                  )
                : invalidExit;
              if (listening && !stopRequested)
                reportFailure({ kind: 'error', error: lifecycleError });
              finish(() => reject(lifecycleError));
              return;
            }
            if (listening && !stopRequested && !failingChild && exit) {
              const exitError = new Error(
                `dev-server child exited after listening (code ${String(code)}, signal ${String(signal)})`,
              );
              reportFailure({
                kind: 'exit',
                ...exit,
                error: cleanupError
                  ? new AggregateError(
                      [exitError, cleanupError],
                      'dev-server child exited and resize cleanup failed',
                    )
                  : exitError,
              });
              return;
            }
            finish(() => {
              const error = bootFault
                ? cleanupError
                  ? new AggregateError(
                      [bootFault, cleanupError],
                      'dev-server child lifecycle failed',
                    )
                  : bootFault
                : (cleanupError ??
                  new Error(
                    `dev-server child exited before listening (code ${String(code)}, signal ${String(signal)})`,
                  ));
              reject(new DevServerRunError(error, exit!));
            });
          });

          if (!opts.signal.aborted) {
            resizeAbortBound = true;
            opts.signal.addEventListener('abort', onResizeAbort, { once: true });
          }
          resizeCleanup = bindChildTerminalResize(
            handle,
            opts.params,
            () => !childExited && bootFault === undefined && !opts.signal.aborted,
            (error) => {
              const fault = failChild(error);
              if (listening) throw fault;
            },
          );
          if (opts.signal.aborted) onResizeAbort();
        } catch (error) {
          setupError = error;
          reject(error);
        }
      });
      if (setupError !== undefined) {
        try {
          handle.kill('SIGTERM');
        } catch (killError) {
          setupError = new AggregateError(
            [setupError, killError],
            'dev-server child setup and termination failed',
          );
        }
        await abortOwnerChildAdmissionAfterSpawn(reservation, setupError, admissionExit);
        throw setupError;
      }
      commitOwnerChildAdmission(reservation, admissionExit);
      return boot;
    },
  };
}
