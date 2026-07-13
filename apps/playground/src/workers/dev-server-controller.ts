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
 * which resolves only when the run's `signal` aborts (Ctrl-C) — giving terminal
 * parity (the dev line holds its session until interrupted) — then stops the
 * server WITHOUT killing the owner (`server.close()` + bridge disposal).
 */
import type { DevServerStatus } from '../glue/pty-protocol.ts';

/** Stop handle returned by an injected dev-server boot. */
export interface DevServerHandle {
  readonly port: number;
  readonly previewScope?: string;
  /** `server.close()` + bridge disposal; idempotent. */
  stop(): Promise<void>;
}

/** Registry surface the controller drives (PreviewRegistry satisfies it). */
export interface DevServerLifecycleSink {
  devStarting(ptySid?: string): void;
  setDevServer(port: number, previewScope?: string, ptySid?: string, cwd?: string): void;
  devStopped(): void;
  devBootFailed(message: string, ptySid?: string): void;
}

export interface DevServerControllerDeps {
  /** Lifecycle sink — the preview registry (derives + emits the dev frames). */
  readonly lifecycle: DevServerLifecycleSink;
  /**
   * Boots the real dev server + bridges; honours `signal` for early-abort. `log`
   * streams install/boot progress to the session terminal (the dev command's
   * `ctx.stdout`); `sid` is the owning pty session (threaded to port updates).
   */
  readonly boot: (
    signal: AbortSignal,
    log: (chunk: string) => void,
    sid?: string,
  ) => Promise<DevServerHandle>;
}

export interface DevServerController {
  /**
   * Run the dev server: drives the registry starting→running, then BLOCKS until
   * `signal` aborts, then stops the server and clears the registry slot. A
   * second concurrent run throws (single active server per owner). `log`
   * streams boot progress.
   */
  run(
    signal: AbortSignal,
    log?: (chunk: string) => void,
    sid?: string,
    cwd?: string,
  ): Promise<void>;
  readonly status: DevServerStatus;
}

function onceAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

export function createDevServerController(deps: DevServerControllerDeps): DevServerController {
  let status: DevServerStatus = 'stopped';
  let active: DevServerHandle | null = null;

  return {
    get status() {
      return status;
    },
    async run(
      signal: AbortSignal,
      log: (chunk: string) => void = () => {},
      sid?: string,
      cwd?: string,
    ): Promise<void> {
      if (status !== 'stopped') throw new Error('dev server already running');
      status = 'starting';
      deps.lifecycle.devStarting(sid);
      try {
        active = await deps.boot(signal, log, sid);
        status = 'running';
        deps.lifecycle.setDevServer(active.port, active.previewScope, sid, cwd);
        await onceAborted(signal);
      } catch (err) {
        status = 'stopped';
        active = null;
        deps.lifecycle.devBootFailed(err instanceof Error ? err.message : String(err), sid);
        throw err;
      } finally {
        if (active) {
          const handle = active;
          active = null;
          status = 'stopped';
          await handle.stop();
          deps.lifecycle.devStopped();
        }
      }
    },
  };
}
