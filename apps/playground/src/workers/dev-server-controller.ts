/**
 * Co-resident dev-server lifecycle: the dev server runs inside the workspace
 * owner (ADR-0148). Pure state machine: owns the
 * status transitions, the single-active guard, the owner→page `pty:dev-server`
 * frame emission, and the block-until-SIGINT semantics. The actual worker-realm
 * boot (vite/node `createServer` + preview/HMR bridges) is INJECTED (`boot`) so
 * this is unit-testable without a Worker or vite.
 *
 * The owner `vite`/dev shell command awaits {@link DevServerController.run},
 * which resolves only when the run's `signal` aborts (Ctrl-C) — giving terminal
 * parity (the dev line holds its session until interrupted) — then stops the
 * server WITHOUT killing the owner (`server.close()` + bridge disposal).
 */
import type { DevServerStatus, OwnerToPageFrame } from '../glue/pty-protocol.ts';

/** Stop handle returned by an injected dev-server boot. */
export interface DevServerHandle {
  readonly port: number;
  readonly previewScope?: string;
  /** `server.close()` + bridge disposal; idempotent. */
  stop(): Promise<void>;
  /**
   * Invalidate a changed file + broadcast HMR (vite only; no-op for a node
   * server). The owner's single vfs-write handler forwards editor writes here so
   * the preview live-updates — the virtual FS fires no real watcher events.
   */
  onFileChanged?(path: string): void;
}

export interface DevServerControllerDeps {
  /** Emits owner→page frames (wired to the owner `send`). */
  readonly send: (frame: OwnerToPageFrame) => void;
  /**
   * Boots the real dev server + bridges; honours `signal` for early-abort. `log`
   * streams install/boot progress to the session terminal (the dev command's
   * `ctx.stdout`).
   */
  readonly boot: (signal: AbortSignal, log: (chunk: string) => void) => Promise<DevServerHandle>;
}

export interface DevServerController {
  /**
   * Run the dev server: emits starting→running, then BLOCKS until `signal`
   * aborts, then stops the server and emits stopped. A second concurrent run
   * throws (single active server per owner). `log` streams boot progress.
   */
  run(signal: AbortSignal, log?: (chunk: string) => void): Promise<void>;
  /** Re-emit current state — answers the `pty:dev-server-req` handshake. */
  publish(): void;
  /** Forward an editor write to the running server's HMR (no-op when stopped). */
  notifyFileChanged(path: string): void;
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

  function frame(): OwnerToPageFrame {
    if (status === 'running' && active) {
      return {
        type: 'pty:dev-server',
        status,
        port: active.port,
        url: `/preview/${active.port}/`,
        ...(active.previewScope === undefined ? {} : { previewScope: active.previewScope }),
      };
    }
    return { type: 'pty:dev-server', status };
  }
  function emit(): void {
    deps.send(frame());
  }

  return {
    get status() {
      return status;
    },
    publish(): void {
      emit();
    },
    notifyFileChanged(path: string): void {
      if (status === 'running' && active) active.onFileChanged?.(path);
    },
    async run(signal: AbortSignal, log: (chunk: string) => void = () => {}): Promise<void> {
      if (status !== 'stopped') throw new Error('dev server already running');
      status = 'starting';
      emit();
      try {
        active = await deps.boot(signal, log);
        status = 'running';
        emit();
        await onceAborted(signal);
      } catch (err) {
        status = 'stopped';
        active = null;
        deps.send({
          type: 'pty:dev-server',
          status,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        if (active) {
          const handle = active;
          active = null;
          status = 'stopped';
          await handle.stop();
          emit();
        }
      }
    },
  };
}
