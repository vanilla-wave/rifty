/**
 * Co-resident dev-server lifecycle: the dev server runs inside the workspace
 * owner (ADR-0148). Pure state machine: owns the status transitions, the
 * single-active guard, and the block-until-SIGINT semantics. Frame emission is
 * NOT here — all `pty:dev-server` frames derive from the preview registry (the
 * single lifecycle authority);
 * this machine drives the registry through {@link DevServerLifecycleSink}. The
 * actual worker-realm boot (vite/node `createServer` + preview/HMR bridges) is
 * INJECTED (`boot`) so this is unit-testable without a Worker or vite.
 *
 * The owner `vite`/dev shell command awaits {@link DevServerController.run},
 * which settles when the run's `signal` aborts or its child fails — preserving
 * terminal ownership while the controller stops the server without killing the
 * owner.
 */
import type { CommandContext, ProcessExit } from '@riftydev/shell';
import type { DevServerStatus } from '../glue/pty-protocol.ts';
import type { PreviewProducerOrigin } from './preview-registry.ts';

/** One foreground command context, with the cancellation required by a server run. */
export interface DevServerRunContext extends CommandContext {
  readonly signal: AbortSignal;
}

/** Stop handle returned by an injected dev-server boot. */
export interface DevServerHandle {
  readonly port: number;
  readonly previewScope?: string;
  /** In-realm `server.close()` + bridge disposal; no process exit exists here. */
  stop(): Promise<void>;
}

/** One unexpected physical-child terminal event, resolved exactly once. */
export type DevServerFailure =
  | ({ readonly kind: 'exit'; readonly error: Error } & ProcessExit)
  | { readonly kind: 'error'; readonly error: Error };

/** Long-lived child handle whose physical failure is observable by the controller. */
export type SupervisedDevServerHandle = Omit<DevServerHandle, 'stop'> & {
  /** Resolves on unexpected post-ready failure; normal stop leaves it pending. */
  readonly failure: Promise<DevServerFailure>;
  /** Kills the outer child and resolves from its physical exit event. */
  stop(): Promise<ProcessExit>;
};

/** Registry surface the controller drives (PreviewRegistry satisfies it). */
export interface DevServerLifecycleSink {
  devStarting(origin: PreviewProducerOrigin): void;
  setDevServer(
    port: number,
    previewScope: string | undefined,
    opts: { readonly origin: PreviewProducerOrigin; readonly cwd?: string },
  ): void;
  devStopped(): void;
  /** Boot or post-ready failure; clears this controller's preview slot. */
  devBootFailed(message: string, origin: PreviewProducerOrigin): void;
}

export interface DevServerControllerDeps {
  /** Lifecycle sink — the preview registry (derives + emits the dev frames). */
  readonly lifecycle: DevServerLifecycleSink;
  /**
   * Boots the real dev server + bridges from the complete foreground command
   * context; PTY origin carries admission captured before the async child launch.
   */
  readonly boot: (
    ctx: DevServerRunContext,
    origin: PreviewProducerOrigin,
  ) => Promise<SupervisedDevServerHandle>;
}

export interface DevServerController {
  /**
   * Run the dev server: drives the registry starting→running, then BLOCKS until
   * `signal` aborts or the physical child fails. One terminalization path stops
   * the handle and clears the registry slot. A second concurrent run throws.
   */
  run(ctx: DevServerRunContext, origin: PreviewProducerOrigin): Promise<ProcessExit>;
  readonly status: DevServerStatus;
}

/** Lifecycle error whose physical child exit remains available to Shell. */
export class DevServerRunError extends Error {
  readonly exit: ProcessExit;

  constructor(error: unknown, exit: ProcessExit) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'DevServerRunError';
    this.exit = exit;
  }
}

function onceAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

export function createDevServerController(deps: DevServerControllerDeps): DevServerController {
  let status: DevServerStatus = 'stopped';
  let active: SupervisedDevServerHandle | null = null;

  return {
    get status() {
      return status;
    },
    async run(ctx: DevServerRunContext, origin: PreviewProducerOrigin): Promise<ProcessExit> {
      if (status !== 'stopped') throw new Error('dev server already running');
      status = 'starting';
      deps.lifecycle.devStarting(origin);
      let failed = false;
      let runFailure: unknown;
      let physicalExit: ProcessExit | undefined;
      try {
        active = await deps.boot(ctx, origin);
        status = 'running';
        deps.lifecycle.setDevServer(active.port, active.previewScope, { origin, cwd: ctx.cwd });
        const outcome = await Promise.race([
          onceAborted(ctx.signal).then(() => ({ kind: 'aborted' as const })),
          active.failure.then((failure) => ({ kind: 'failed' as const, failure })),
        ]);
        if (outcome.kind === 'failed') {
          if (outcome.failure.kind === 'exit') {
            physicalExit = outcome.failure;
          }
          throw outcome.failure.error;
        }
      } catch (error) {
        if (error instanceof DevServerRunError) physicalExit = error.exit;
        if (ctx.signal.aborted && error instanceof DevServerRunError) {
          failed = false;
        } else {
          failed = true;
          runFailure = error;
        }
      }

      const handle = active;
      if (handle) {
        try {
          physicalExit = await handle.stop();
        } catch (stopError) {
          runFailure = failed
            ? new AggregateError(
                [runFailure, stopError],
                'dev server failed and its stop operation also failed',
              )
            : stopError;
          failed = true;
        }
      }
      active = null;
      status = 'stopped';

      if (failed) {
        deps.lifecycle.devBootFailed(
          runFailure instanceof Error ? runFailure.message : String(runFailure),
          origin,
        );
        if (physicalExit) throw new DevServerRunError(runFailure, physicalExit);
        throw runFailure;
      }
      deps.lifecycle.devStopped();
      if (!physicalExit) {
        throw new Error('dev server stopped without a physical child exit');
      }
      return physicalExit;
    },
  };
}

/** Shell adapter: diagnostic + exact physical exit stay on one owned path. */
export async function runDevServerShellCommand(
  controller: DevServerController,
  ctx: CommandContext,
  origin: PreviewProducerOrigin,
): Promise<ProcessExit> {
  const signal = ctx.signal ?? new AbortController().signal;
  try {
    return await controller.run({ ...ctx, signal }, origin);
  } catch (error) {
    ctx.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof DevServerRunError) return error.exit;
    return { code: 1, signal: null };
  }
}
