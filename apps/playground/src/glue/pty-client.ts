/**
 * PAGE-side pty channel client (ADR-0146 owner-resident shell). Mirror of the owner `pty-server`:
 * translates terminal-manager calls into `pty:*` page→owner frames over an
 * injected `send`, and correlates owner→page frames back to per-run callbacks
 * by `rid`. Pure — no Worker/kernel coupling; the realVite glue wires `send` to
 * `handle.send({ type: PTY_IPC_TYPE, frame })` and feeds `onFrame` from
 * `handle.on('message')`.
 *
 * `exec` resolves the shell status once `pty:exit` arrives; `execResult` also
 * exposes the independent physical exit. Chunks stream to the per-run
 * `onChunk` in arrival order (single channel ⇒ ordered, `seq` carried for
 * forward-compat loss-detect). cwd/env are cached from `pty:exit` so the PAGE
 * can render prompt/explorer scope without round-tripping the owner.
 */
import { shellCommandExitCode } from '@riftydev/shell';
import type { ProcessExit } from '@riftydev/shell';
import type {
  OwnerToPageFrame,
  PageToOwnerFrame,
  PtyDevServer,
  PtyPreview,
  PtyStream,
} from './pty-protocol.ts';

const dec = new TextDecoder();
let ridCounter = 0;

export interface ExecOptions {
  readonly cols: number;
  readonly rows: number;
  readonly isTTY: boolean;
  readonly onChunk: (chunk: string, stream: PtyStream) => void;
  /**
   * Fired with the run's `rid` only after the owner actor replies
   * `pty:run-ready`. Lets the caller route controls to the admitted run.
   */
  readonly onStart?: (rid: string) => void;
}

/** cwd/env cached on the PAGE from the latest `pty:exit` of a session. */
export interface PtySessionSnapshot {
  readonly cwd: string;
  readonly env: Record<string, string>;
}

/** Both shell status and physical final-command provenance carried by pty:exit. */
export interface PtyRunResult {
  readonly exitCode: number;
  readonly exit: ProcessExit;
}

type DeferredVoid = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
};
type StdinOperation = DeferredVoid &
  (
    | { readonly kind: 'data'; readonly opId: string; readonly data: Uint8Array }
    | { readonly kind: 'eof'; readonly opId: string }
  );
type PendingRun = {
  readonly sid: string;
  readonly rid: string;
  readonly resolve: (result: PtyRunResult) => void;
  readonly reject: (error: Error) => void;
  readonly onChunk: ExecOptions['onChunk'];
  readonly onStart: ExecOptions['onStart'];
  readonly stdinQueue: StdinOperation[];
  admitted: boolean;
  admissionCallbackFailed: boolean;
  stdinInFlight?: StdinOperation;
  stdinEnded: boolean;
  eofPromise?: Promise<void>;
};
type PendingResize = {
  readonly sid: string;
  readonly rid: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
};
type PendingSessionResize = Omit<PendingResize, 'rid'>;
type PendingClose = DeferredVoid & { readonly opId: string };
type PendingReady = DeferredVoid;
type PendingDevConfig = {
  resolve: () => void;
  reject: (err: Error) => void;
};
type SessionState = {
  cwd: string;
  env: Record<string, string>;
  readyWaiters: PendingReady[];
  activeRid: string | null;
  closed: boolean;
  close?: PendingClose;
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
  /** Project-scoped owner evidence, after this client validates its admitted PTY run. */
  onFirstMaterializationConsumed?: (evidence: {
    readonly sid: string;
    readonly rid: string;
  }) => void;
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
  /** Run one line and preserve both shell status and exact physical exit. */
  execResult(sid: string, line: string, opts: ExecOptions): Promise<PtyRunResult>;
  writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void>;
  endStdin(sid: string, rid: string): Promise<void>;
  resizeSession(sid: string, cols: number, rows: number): Promise<void>;
  resize(sid: string, rid: string, cols: number, rows: number): Promise<void>;
  signal(sid: string, rid: string): void;
  closeSession(sid: string, cancellation?: Error): Promise<void>;
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
   * Owner died — reject EVERY waiter loudly so no caller hangs or mistakes a
   * transport failure for a real process exit.
   */
  disconnect(): void;
}

export function createPtyClient(deps: PtyClientDeps): PtyClient {
  const sessions = new Map<string, SessionState>();
  const runs = new Map<string, PendingRun>();
  const resizes = new Map<string, PendingResize>();
  const sessionResizes = new Map<string, PendingSessionResize>();
  const devConfigs = new Map<string, PendingDevConfig>();
  let devConfigSeq = 0;
  let operationSeq = 0;
  // Flipped by disconnect() on owner death: future operations reject before
  // posting frames the dead owner can never acknowledge.
  let disconnected = false;

  function session(sid: string): SessionState {
    let s = sessions.get(sid);
    if (!s) {
      s = { cwd: '/', env: {}, readyWaiters: [], activeRid: null, closed: false };
      sessions.set(sid, s);
    }
    return s;
  }

  function operationId(prefix: 'resize' | 'session-resize' | 'stdin' | 'close'): string {
    return `${prefix}${++operationSeq}`;
  }

  function deferredVoid(): DeferredVoid {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function controlRun(sid: string, rid: string): PendingRun | undefined {
    const s = sessions.get(sid);
    if (!s || s.closed || s.close) return undefined;
    const run = runs.get(rid);
    return run?.sid === sid && !run.admissionCallbackFailed ? run : undefined;
  }

  function rejectResizes(sid: string, rid: string, error: Error): void {
    for (const [opId, pending] of resizes) {
      if (pending.sid !== sid || pending.rid !== rid) continue;
      resizes.delete(opId);
      pending.reject(error);
    }
  }

  function rejectSessionResizes(sid: string, error: Error): void {
    for (const [opId, pending] of sessionResizes) {
      if (pending.sid !== sid) continue;
      sessionResizes.delete(opId);
      pending.reject(error);
    }
  }

  function rejectStdin(run: PendingRun, error: Error): void {
    const queued = run.stdinQueue.splice(0);
    run.stdinInFlight = undefined;
    for (const operation of queued) operation.reject(error);
  }

  function pumpStdin(run: PendingRun): void {
    if (run.stdinInFlight) return;
    const operation = run.stdinQueue[0];
    if (!operation) return;
    run.stdinInFlight = operation;
    try {
      if (operation.kind === 'data') {
        deps.send({
          type: 'pty:stdin',
          sid: run.sid,
          rid: run.rid,
          opId: operation.opId,
          data: operation.data,
        });
      } else {
        deps.send({
          type: 'pty:stdin-eof',
          sid: run.sid,
          rid: run.rid,
          opId: operation.opId,
        });
      }
    } catch (error) {
      run.stdinQueue.shift();
      run.stdinInFlight = undefined;
      operation.reject(error instanceof Error ? error : new Error(String(error)));
      pumpStdin(run);
    }
  }

  function enqueueStdin(
    run: PendingRun,
    operation: { readonly kind: 'data'; readonly data: Uint8Array } | { readonly kind: 'eof' },
  ): Promise<void> {
    const pending = deferredVoid();
    const queued: StdinOperation =
      operation.kind === 'data'
        ? {
            ...pending,
            kind: 'data',
            opId: operationId('stdin'),
            data: operation.data,
          }
        : { ...pending, kind: 'eof', opId: operationId('stdin') };
    run.stdinQueue.push(queued);
    pumpStdin(run);
    return queued.promise;
  }

  function dimension(value: number, name: 'cols' | 'rows'): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Terminal ${name} must be a positive safe integer; received ${value}`);
    }
    return value;
  }

  function ptyRunResult(frame: Extract<OwnerToPageFrame, { type: 'pty:exit' }>): PtyRunResult {
    if (!Number.isSafeInteger(frame.code) || frame.code < 0) {
      throw new TypeError(
        `pty:exit shell status must be a non-negative safe integer; received ${frame.code}`,
      );
    }
    // Validates the mutually-exclusive pair and supported signal without
    // deriving the independent shell status from it (ADR-0257).
    shellCommandExitCode(frame.exit);
    return { exitCode: frame.code, exit: frame.exit };
  }

  function startExec(sid: string, line: string, opts: ExecOptions): Promise<PtyRunResult> {
    if (disconnected) {
      return Promise.reject(new Error(`ClosedHandleError: owner died before exec ${sid}`));
    }
    const s = session(sid);
    if (s.closed || s.close) {
      throw new Error(`ClosedHandleError: pty session ${sid} is closed`);
    }
    if (s.activeRid) {
      throw new Error(`ProjectBusyError: pty session ${sid} already running ${s.activeRid}`);
    }
    const cols = dimension(opts.cols, 'cols');
    const rows = dimension(opts.rows, 'rows');
    const rid = `r${++ridCounter}`;
    return new Promise((resolve, reject) => {
      const run: PendingRun = {
        sid,
        rid,
        resolve,
        reject,
        onChunk: opts.onChunk,
        onStart: opts.onStart,
        stdinQueue: [],
        admitted: false,
        admissionCallbackFailed: false,
        stdinEnded: false,
      };
      runs.set(rid, run);
      s.activeRid = rid;
      // Remember this run's sink so late chunks (owner output racing past
      // pty:exit) still land in this session's terminal (see trailingSink).
      s.trailingSink = opts.onChunk;
      try {
        deps.send({
          type: 'pty:exec',
          sid,
          rid,
          line,
          cols,
          rows,
          isTTY: opts.isTTY,
        });
      } catch (error) {
        runs.delete(rid);
        if (s.activeRid === rid) s.activeRid = null;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    });
  }

  return {
    openSession(sid: string, seed?: PtyOpenSeed): Promise<void> {
      const s = session(sid);
      if (disconnected) {
        return Promise.reject(new Error(`ClosedHandleError: owner died before opening ${sid}`));
      }
      if (s.close || s.closed) {
        return Promise.reject(new Error(`ClosedHandleError: pty session ${sid} is closing`));
      }
      // Cache the seed so snapshot() reflects persisted cwd/env before the first
      // command resolves (terminal-state restore on reload, ADR-0146).
      if (seed?.cwd !== undefined) s.cwd = seed.cwd;
      if (seed?.env !== undefined) s.env = seed.env;
      const pending = deferredVoid();
      s.readyWaiters.push(pending);
      try {
        deps.send({
          type: 'pty:open',
          sid,
          ...(seed?.cwd === undefined ? {} : { cwd: seed.cwd }),
          ...(seed?.env === undefined ? {} : { env: seed.env }),
        });
      } catch (error) {
        const idx = s.readyWaiters.indexOf(pending);
        if (idx !== -1) s.readyWaiters.splice(idx, 1);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return pending.promise;
    },
    exec(sid: string, line: string, opts: ExecOptions): Promise<number> {
      return startExec(sid, line, opts).then((result) => result.exitCode);
    },
    execResult(sid: string, line: string, opts: ExecOptions): Promise<PtyRunResult> {
      return startExec(sid, line, opts);
    },
    writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void> {
      const run = controlRun(sid, rid);
      if (!run) {
        return Promise.reject(new Error(`ClosedHandleError: pty run ${sid}/${rid} is not active`));
      }
      if (run.stdinEnded) {
        return Promise.reject(new Error(`StdinClosedError: stdin for ${sid}/${rid} has ended`));
      }
      return enqueueStdin(run, { kind: 'data', data });
    },
    endStdin(sid: string, rid: string): Promise<void> {
      const run = controlRun(sid, rid);
      if (!run) {
        return Promise.reject(new Error(`ClosedHandleError: pty run ${sid}/${rid} is not active`));
      }
      if (run.eofPromise) return run.eofPromise;
      run.stdinEnded = true;
      run.eofPromise = enqueueStdin(run, { kind: 'eof' });
      return run.eofPromise;
    },
    resizeSession(sid: string, cols: number, rows: number): Promise<void> {
      const validCols = dimension(cols, 'cols');
      const validRows = dimension(rows, 'rows');
      if (disconnected) {
        return Promise.reject(new Error(`ClosedHandleError: owner died before idle resize ${sid}`));
      }
      const s = session(sid);
      if (s.closed || s.close) {
        return Promise.reject(new Error(`ClosedHandleError: pty session ${sid} is closing`));
      }
      const opId = operationId('session-resize');
      const pending = deferredVoid();
      sessionResizes.set(opId, { sid, resolve: pending.resolve, reject: pending.reject });
      try {
        deps.send({
          type: 'pty:session-resize',
          sid,
          opId,
          cols: validCols,
          rows: validRows,
        });
      } catch (error) {
        sessionResizes.delete(opId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return pending.promise;
    },
    resize(sid: string, rid: string, cols: number, rows: number): Promise<void> {
      const validCols = dimension(cols, 'cols');
      const validRows = dimension(rows, 'rows');
      if (!controlRun(sid, rid)) {
        throw new Error(`ClosedHandleError: pty run ${sid}/${rid} is not active`);
      }
      const opId = operationId('resize');
      const pending = deferredVoid();
      resizes.set(opId, { sid, rid, resolve: pending.resolve, reject: pending.reject });
      try {
        deps.send({ type: 'pty:resize', sid, rid, opId, cols: validCols, rows: validRows });
      } catch (error) {
        resizes.delete(opId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return pending.promise;
    },
    signal(sid: string, rid: string): void {
      if (disconnected) {
        throw new Error(`ClosedHandleError: owner died before signal ${sid}/${rid}`);
      }
      if (!controlRun(sid, rid)) {
        throw new Error(`ClosedHandleError: pty run ${sid}/${rid} is not active`);
      }
      deps.send({ type: 'pty:signal', sid, rid, signal: 'SIGINT' });
    },
    closeSession(sid: string, cancellation?: Error): Promise<void> {
      const s = session(sid);
      if (s.close) return s.close.promise;
      if (disconnected) {
        return Promise.reject(new Error(`ClosedHandleError: owner died before closing ${sid}`));
      }
      if (s.closed) {
        return Promise.reject(new Error(`ClosedHandleError: pty session ${sid} is closed`));
      }
      const pending = deferredVoid();
      const close: PendingClose = { ...pending, opId: operationId('close') };
      s.close = close;
      const error = cancellation ?? new Error(`ClosedHandleError: pty session ${sid} is closing`);
      for (const waiter of s.readyWaiters.splice(0)) waiter.reject(error);
      rejectSessionResizes(sid, error);
      try {
        deps.send({ type: 'pty:close', sid, opId: close.opId });
      } catch (error) {
        close.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return close.promise;
    },
    requestDevServer(): void {
      if (disconnected) {
        throw new Error('ClosedHandleError: owner died before dev-server request');
      }
      deps.send({ type: 'pty:dev-server-req' });
    },
    requestPreview(): void {
      if (disconnected) {
        throw new Error('ClosedHandleError: owner died before preview request');
      }
      deps.send({ type: 'pty:preview-req' });
    },
    setDevConfig(config): Promise<void> {
      if (disconnected) {
        return Promise.reject(new Error('ClosedHandleError: owner died before dev config'));
      }
      const id = `dc${++devConfigSeq}`;
      return new Promise<void>((resolve, reject) => {
        // Owner config assignment is a mutation: only ready/error or certified
        // owner death can establish its terminal outcome.
        devConfigs.set(id, { resolve, reject });
        try {
          deps.send({
            type: 'pty:dev-config',
            id,
            templateId: config.templateId,
            slug: config.slug,
            setup: config.setup,
          });
        } catch (cause) {
          const pending = devConfigs.get(id);
          if (!pending) return;
          devConfigs.delete(id);
          pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    },
    snapshot(sid: string): PtySessionSnapshot {
      const s = sessions.get(sid);
      return s ? { cwd: s.cwd, env: s.env } : { cwd: '/', env: {} };
    },
    onFrame(frame: OwnerToPageFrame): void {
      switch (frame.type) {
        case 'pty:ready': {
          const waiters = session(frame.sid).readyWaiters.splice(0);
          if (frame.error) {
            const error = new Error(frame.error);
            for (const waiter of waiters) waiter.reject(error);
          } else {
            for (const waiter of waiters) waiter.resolve();
          }
          return;
        }
        case 'pty:run-ready': {
          const run = runs.get(frame.rid);
          const s = sessions.get(frame.sid);
          if (run?.sid !== frame.sid || run.admitted || !s || s.closed || s.close !== undefined) {
            return;
          }
          run.admitted = true;
          try {
            run.onStart?.(frame.rid);
          } catch (error) {
            run.admissionCallbackFailed = true;
            run.stdinEnded = true;
            const closed = new Error('ClosedHandleError: run start callback failed');
            rejectStdin(run, closed);
            rejectResizes(frame.sid, frame.rid, closed);
            try {
              deps.send({ type: 'pty:signal', sid: frame.sid, rid: frame.rid, signal: 'SIGINT' });
            } catch {
              // The callback failure remains the public cause.
            }
            run.reject(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }
        case 'pty:first-materialization-consumed': {
          const run = runs.get(frame.rid);
          if (run?.sid !== frame.sid || !run.admitted) {
            throw new Error(
              `pty:first-materialization-consumed has no matching admitted run ${frame.sid}/${frame.rid}`,
            );
          }
          const callback = deps.onFirstMaterializationConsumed;
          if (callback === undefined) {
            throw new Error('pty:first-materialization-consumed has no project callback');
          }
          callback(Object.freeze({ sid: frame.sid, rid: frame.rid }));
          return;
        }
        case 'pty:chunk': {
          const run = runs.get(frame.rid);
          // Active run → its onChunk. A chunk that arrives AFTER its run's
          // pty:exit (late owner output — the dev-server readiness marker from an
          // async listen() message racing past a restart-abort) → the session's
          // trailing sink, so it still reaches the terminal instead of vanishing
          // (the CI marker flake: `[vite] dev server ready` dropped at this seam).
          (run?.onChunk ?? sessions.get(frame.sid)?.trailingSink)?.(
            dec.decode(frame.data),
            frame.stream,
          );
          return;
        }
        case 'pty:exit': {
          const run = runs.get(frame.rid);
          if (run?.sid === frame.sid) {
            const s = session(frame.sid);
            runs.delete(frame.rid);
            if (s.activeRid === frame.rid) s.activeRid = null;
            const error = new Error(`ClosedHandleError: pty run ${frame.sid}/${frame.rid} exited`);
            run.stdinEnded = true;
            rejectStdin(run, error);
            rejectResizes(frame.sid, frame.rid, error);
            try {
              const result = ptyRunResult(frame);
              s.cwd = frame.cwd;
              s.env = frame.env;
              run.resolve(result);
            } catch (caught) {
              run.reject(caught instanceof Error ? caught : new Error(String(caught)));
            }
          }
          return;
        }
        case 'pty:resize-ack': {
          const pending = resizes.get(frame.opId);
          if (!pending || pending.sid !== frame.sid || pending.rid !== frame.rid) return;
          resizes.delete(frame.opId);
          if (frame.ok) pending.resolve();
          else pending.reject(new Error(frame.error));
          return;
        }
        case 'pty:session-resize-ack': {
          const pending = sessionResizes.get(frame.opId);
          if (!pending || pending.sid !== frame.sid) return;
          sessionResizes.delete(frame.opId);
          if (frame.ok) pending.resolve();
          else pending.reject(new Error(frame.error));
          return;
        }
        case 'pty:stdin-ack': {
          const run = controlRun(frame.sid, frame.rid);
          const operation = run?.stdinInFlight;
          if (!run || !operation || operation.opId !== frame.opId) return;
          run.stdinQueue.shift();
          run.stdinInFlight = undefined;
          if (frame.ok) {
            operation.resolve();
            pumpStdin(run);
          } else {
            run.stdinEnded = true;
            operation.reject(new Error(frame.error));
            rejectStdin(run, new Error(frame.error));
          }
          return;
        }
        case 'pty:close-ack': {
          const s = sessions.get(frame.sid);
          const pending = s?.close;
          if (!s || !pending || pending.opId !== frame.opId) return;
          if (frame.ok) {
            s.closed = true;
            s.activeRid = null;
            s.cwd = '/';
            s.env = {};
            const error = new Error(`ClosedHandleError: pty session ${frame.sid} is closed`);
            for (const waiter of s.readyWaiters.splice(0)) waiter.reject(error);
            pending.resolve();
          } else {
            pending.reject(new Error(frame.error));
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
        const s = sessions.get(run.sid);
        if (s?.activeRid === rid) s.activeRid = null;
        const error = new Error(`ClosedHandleError: owner died during ${run.sid}/${rid}`);
        rejectStdin(run, error);
        run.reject(error);
      }
      for (const [opId, pending] of resizes) {
        resizes.delete(opId);
        pending.reject(new Error(`ClosedHandleError: owner died during resize ${opId}`));
      }
      for (const [opId, pending] of sessionResizes) {
        sessionResizes.delete(opId);
        pending.reject(new Error(`ClosedHandleError: owner died during idle resize ${opId}`));
      }
      for (const s of sessions.values()) {
        const error = new Error('ClosedHandleError: owner died during session operation');
        for (const waiter of s.readyWaiters.splice(0)) waiter.reject(error);
        s.close?.reject(error);
        s.activeRid = null;
        s.closed = true;
      }
      for (const [id, pending] of devConfigs) {
        devConfigs.delete(id);
        pending.reject(new Error(`ClosedHandleError: owner died during dev config ${id}`));
      }
    },
  };
}
