/**
 * PAGE-side pty channel client (ADR-0146 owner-resident shell). Mirror of the owner `pty-server`:
 * translates terminal-manager calls into `pty:*` page→owner frames over an
 * injected `send`, and correlates owner→page frames back to per-run callbacks
 * by `rid`. Pure — no Worker/kernel coupling; the realVite glue wires `send` to
 * `handle.send({ type: PTY_IPC_TYPE, frame })` and feeds `onFrame` from
 * `handle.on('message')`.
 *
 * `exec` resolves the exit code once `pty:exit` arrives; chunks stream to the
 * per-run `onChunk` in arrival order (single channel ⇒ ordered, `seq` carried
 * for forward-compat loss-detect). cwd/env are cached from `pty:exit` so the
 * PAGE can render prompt/explorer scope without round-tripping the owner.
 */
import type {
  OwnerToPageFrame,
  PageToOwnerFrame,
  PtyDevServer,
  PtyPreview,
  PtyStream,
} from './pty-protocol.ts';

const dec = new TextDecoder();
let ridCounter = 0;

/** Exit code for an in-flight run cut short by owner death (128 + SIGKILL(9)). */
const OWNER_DIED_EXIT = 137;
const DEV_CONFIG_READY_TIMEOUT_MS = 60_000;

export interface ExecOptions {
  readonly cols: number;
  readonly rows: number;
  readonly isTTY: boolean;
  readonly onChunk: (chunk: string, stream: PtyStream) => void;
  /**
   * Fired with the run's `rid` immediately after the `pty:exec` frame is sent,
   * before any chunk arrives. Lets the caller route `writeStdin`/`signal` to the
   * in-flight run (the terminal-manager tracks the active rid per session).
   */
  readonly onStart?: (rid: string) => void;
}

/** cwd/env cached on the PAGE from the latest `pty:exit` of a session. */
export interface PtySessionSnapshot {
  readonly cwd: string;
  readonly env: Record<string, string>;
}

type PendingRun = { sid: string; resolve: (code: number) => void; onChunk: ExecOptions['onChunk'] };
type PendingDevConfig = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type SessionState = {
  cwd: string;
  env: Record<string, string>;
  readyResolvers: (() => void)[];
  /**
   * The most recent run's `onChunk`, kept so a `pty:chunk` that arrives AFTER its
   * run's `pty:exit` (the owner emitting late — e.g. the dev-server readiness
   * marker from an async `listen()` message that lands after a restart aborted
   * the run) still reaches the session's terminal instead of being dropped.
   */
  trailingSink?: ExecOptions['onChunk'];
};

export interface PtyClientDeps {
  /** Posts a page→owner frame over the kernel IPC channel (wired by realVite). */
  send: (frame: PageToOwnerFrame) => void;
  /** Owner→page dev-server state (ADR-0148 co-resident dev server); the page derives its LIVE pill + preview port. */
  onDevServer?: (frame: PtyDevServer) => void;
  /** Owner→page snapshot of ALL live previewable ports (ADR-0155); the page derives its preview switcher + per-port bridges. */
  onPreview?: (frame: PtyPreview) => void;
}

/** Seed cwd/env for a session (restored persisted terminal state, ADR-0146). */
export interface PtyOpenSeed {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export interface PtyClient {
  /**
   * Open a session; resolves once the owner replies `pty:ready`. An optional
   * `seed` (persisted cwd/env) is carried to the owner's shell AND cached
   * immediately so {@link PtyClient.snapshot} is truthful before the first run.
   */
  openSession(sid: string, seed?: PtyOpenSeed): Promise<void>;
  /** Run one line; streams chunks to `onChunk`, resolves the exit code. */
  exec(sid: string, line: string, opts: ExecOptions): Promise<number>;
  writeStdin(sid: string, rid: string, data: Uint8Array): void;
  signal(sid: string, rid: string): void;
  closeSession(sid: string): void;
  /** Ask the owner to re-publish dev-server state (explorer-reflects-owner-tree handshake on subscribe/reload). */
  requestDevServer(): void;
  /** Ask the owner to re-publish the preview-port set (subscribe handshake, ADR-0155; never a one-shot push). */
  requestPreview(): void;
  /** Tell the owner the current preset's dev-server config (ADR-0148 co-resident dev server). */
  setDevConfig(config: {
    templateId: string;
    slug: string;
    setup: 'instant' | 'from-scratch';
  }): Promise<void>;
  /** Cached cwd/env for a session (from the last `pty:exit`). */
  snapshot(sid: string): PtySessionSnapshot;
  /** Feed an owner→page frame (from `handle.on('message')`). */
  onFrame(frame: OwnerToPageFrame): void;
  /**
   * Owner died — settle EVERY waiter so no caller hangs: in-flight runs resolve
   * nonzero, pending openSession() waiters resolve, and subsequent
   * openSession()/exec() settle immediately instead of awaiting frames the dead
   * owner will never send.
   */
  disconnect(): void;
}

export function createPtyClient(deps: PtyClientDeps): PtyClient {
  const sessions = new Map<string, SessionState>();
  const runs = new Map<string, PendingRun>();
  const devConfigs = new Map<string, PendingDevConfig>();
  let devConfigSeq = 0;
  // Flipped by disconnect() on owner death: subsequent openSession/exec settle
  // immediately instead of awaiting frames the dead owner will never send.
  let disconnected = false;

  function session(sid: string): SessionState {
    let s = sessions.get(sid);
    if (!s) {
      s = { cwd: '/', env: {}, readyResolvers: [] };
      sessions.set(sid, s);
    }
    return s;
  }

  return {
    openSession(sid: string, seed?: PtyOpenSeed): Promise<void> {
      const s = session(sid);
      // Cache the seed so snapshot() reflects persisted cwd/env before the first
      // command resolves (terminal-state restore on reload, ADR-0146).
      if (seed?.cwd !== undefined) s.cwd = seed.cwd;
      if (seed?.env !== undefined) s.env = seed.env;
      // Owner already dead — no pty:ready will arrive; resolve now so the caller
      // (`await session.ready`) proceeds to exec(), which fails fast nonzero.
      if (disconnected) return Promise.resolve();
      return new Promise((res, rej) => {
        s.readyResolvers.push(res);
        try {
          deps.send({ type: 'pty:open', sid, cwd: seed?.cwd, env: seed?.env });
        } catch (err) {
          const idx = s.readyResolvers.indexOf(res);
          if (idx !== -1) s.readyResolvers.splice(idx, 1);
          rej(err);
        }
      });
    },
    exec(sid: string, line: string, opts: ExecOptions): Promise<number> {
      // Owner dead — settle nonzero now rather than posting a doomed pty:exec
      // and registering a run no pty:exit will ever resolve.
      if (disconnected) return Promise.resolve(OWNER_DIED_EXIT);
      const rid = `r${++ridCounter}`;
      return new Promise((resolve, reject) => {
        runs.set(rid, { sid, resolve, onChunk: opts.onChunk });
        // Remember this run's sink so late chunks (owner output racing past
        // pty:exit) still land in this session's terminal (see trailingSink).
        session(sid).trailingSink = opts.onChunk;
        opts.onStart?.(rid);
        try {
          deps.send({
            type: 'pty:exec',
            sid,
            rid,
            line,
            cols: opts.cols,
            rows: opts.rows,
            isTTY: opts.isTTY,
          });
        } catch (err) {
          runs.delete(rid);
          reject(err);
        }
      });
    },
    writeStdin(sid: string, rid: string, data: Uint8Array): void {
      deps.send({ type: 'pty:stdin', sid, rid, data });
    },
    signal(sid: string, rid: string): void {
      deps.send({ type: 'pty:signal', sid, rid, signal: 'SIGINT' });
    },
    closeSession(sid: string): void {
      deps.send({ type: 'pty:close', sid });
      sessions.delete(sid);
    },
    requestDevServer(): void {
      deps.send({ type: 'pty:dev-server-req' });
    },
    requestPreview(): void {
      deps.send({ type: 'pty:preview-req' });
    },
    setDevConfig(config): Promise<void> {
      if (disconnected) return Promise.resolve();
      const id = `dc${++devConfigSeq}`;
      deps.send({
        type: 'pty:dev-config',
        id,
        templateId: config.templateId,
        slug: config.slug,
        setup: config.setup,
      });
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          devConfigs.delete(id);
          reject(
            new Error(`pty:dev-config ${id} timed out after ${DEV_CONFIG_READY_TIMEOUT_MS}ms`),
          );
        }, DEV_CONFIG_READY_TIMEOUT_MS);
        devConfigs.set(id, { resolve, reject, timer });
      });
    },
    snapshot(sid: string): PtySessionSnapshot {
      const s = sessions.get(sid);
      return s ? { cwd: s.cwd, env: s.env } : { cwd: '/', env: {} };
    },
    onFrame(frame: OwnerToPageFrame): void {
      switch (frame.type) {
        case 'pty:ready': {
          for (const r of session(frame.sid).readyResolvers.splice(0)) r();
          return;
        }
        case 'pty:chunk': {
          const __t = dec.decode(frame.data);
          const __run = runs.get(frame.rid);
          // Active run → its onChunk. Run already exited (late owner output) →
          // the session's trailing sink, so the chunk still reaches the terminal.
          const __sink = __run?.onChunk ?? sessions.get(frame.sid)?.trailingSink;
          if (/dev server ready|VITE v|is listening|starting dev server/.test(__t)) {
            console.log(
              `[DEBUG-mk] page recv pty:chunk rid=${frame.rid} tracked=${!!__run} rescued=${!__run && !!__sink} ${JSON.stringify(__t.slice(0, 60))}`,
            );
          } else if (!__run && __sink) {
            console.log(
              `[DEBUG-mk] page rescued trailing rid=${frame.rid} ${JSON.stringify(__t.slice(0, 50))}`,
            );
          }
          __sink?.(__t, frame.stream);
          return;
        }
        case 'pty:exit': {
          console.log(`[DEBUG-mk] page recv pty:exit rid=${frame.rid} code=${frame.code}`);
          const s = session(frame.sid);
          s.cwd = frame.cwd;
          s.env = frame.env;
          const run = runs.get(frame.rid);
          if (run) {
            runs.delete(frame.rid);
            run.resolve(frame.code);
          }
          return;
        }
        case 'pty:dev-server': {
          deps.onDevServer?.(frame);
          return;
        }
        case 'pty:preview': {
          deps.onPreview?.(frame);
          return;
        }
        case 'pty:dev-config-ready': {
          const pending = devConfigs.get(frame.id);
          if (!pending) return;
          devConfigs.delete(frame.id);
          clearTimeout(pending.timer);
          if (frame.error) pending.reject(new Error(frame.error));
          else pending.resolve();
          return;
        }
      }
    },
    disconnect(): void {
      disconnected = true;
      for (const [rid, run] of runs) {
        runs.delete(rid);
        run.resolve(OWNER_DIED_EXIT);
      }
      // Resolve any openSession() still awaiting pty:ready so a session opened
      // (but not yet ready) the instant the owner died can't hang its waiter.
      for (const s of sessions.values()) {
        for (const res of s.readyResolvers.splice(0)) res();
      }
      for (const [id, pending] of devConfigs) {
        devConfigs.delete(id);
        clearTimeout(pending.timer);
        pending.resolve();
      }
    },
  };
}
