import type { ProcessExit, ShellCompletionResult } from '@riftydev/shell';
import { ClosedHandleError, ProjectBusyError, StdinClosedError } from './errors.ts';
import {
  type ProjectTerminalSnapshot,
  ownProjectTerminalSnapshot,
} from './project-terminal-state.ts';
export { ClosedHandleError, ProjectBusyError, StdinClosedError } from './errors.ts';
export type { ProjectTerminalSnapshot } from './project-terminal-state.ts';

export interface ProjectTerminalPortState {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface ProjectTerminalExecOptions {
  readonly cols: number;
  readonly rows: number;
  readonly isTTY: boolean;
  readonly onChunk: (chunk: string, stream: 'stdout' | 'stderr') => void;
  readonly onStart?: (rid: string) => void;
}

export interface ProjectTerminalPort {
  readonly closed: Promise<unknown>;
  isAlive(): boolean;
  openSession(sid: string, initialState?: ProjectTerminalPortState): Promise<void>;
  snapshot(sid: string): ProjectTerminalSnapshot;
  complete(sid: string, line: string, cursor: number): Promise<ShellCompletionResult | null>;
  execResult(
    sid: string,
    line: string,
    options: ProjectTerminalExecOptions,
  ): Promise<{ readonly exitCode: number; readonly exit: ProcessExit }>;
  writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void>;
  endStdin(sid: string, rid: string): Promise<void>;
  resizeSession(sid: string, cols: number, rows: number): Promise<void>;
  resize(sid: string, rid: string, cols: number, rows: number): Promise<void>;
  signal(sid: string, rid: string): void;
  closeSession(sid: string, cancellation?: Error): Promise<void>;
}

export interface ProjectTerminalRun {
  readonly ready: Promise<void>;
  /** Owner-authored shell status; independent from the exact physical exit (ADR-0341). */
  readonly exitCode: Promise<number>;
  readonly exited: Promise<ProcessExit>;
  stop(): Promise<ProcessExit>;
  close(): Promise<ProcessExit>;
}

export interface ProjectTerminalAdmission {
  readonly ptySid: string;
  readonly ptyRid: string;
}

const runAdmissions = new WeakMap<ProjectTerminalRun, Promise<ProjectTerminalAdmission>>();

/** Package-internal PTY actor admission; never reconstructed by a consumer. */
export function projectTerminalAdmission(
  run: ProjectTerminalRun,
): Promise<ProjectTerminalAdmission> {
  const admission = runAdmissions.get(run);
  return admission ?? Promise.reject(new TypeError('Unknown ProjectTerminal run'));
}

export interface ProjectTerminal {
  snapshot(): ProjectTerminalSnapshot;
  complete(line: string, cursor: number): Promise<ShellCompletionResult | null>;
  run(line: string): ProjectTerminalRun;
  write(data: string | Uint8Array): Promise<void>;
  end(): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): () => void;
  close(): Promise<void>;
}

export function createProjectTerminal(_options: {
  readonly id: string;
  readonly port: ProjectTerminalPort;
  readonly initialState?: ProjectTerminalPortState;
}): ProjectTerminal {
  const { id, port, initialState } = _options;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('Project terminal id must be a non-empty string');
  }

  type Deferred<T> = {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (error: Error) => void;
    readonly settled: () => boolean;
  };
  type InputOperation = {
    readonly kind: 'data' | 'eof';
    readonly data?: Uint8Array;
    readonly deferred: Deferred<void>;
  };
  type ResizeOperation = {
    readonly cols: number;
    readonly rows: number;
    readonly waiters: readonly Deferred<void>[];
  };
  type PendingResize = {
    cols: number;
    rows: number;
    readonly waiters: Deferred<void>[];
  };
  type RunLifecycle =
    | 'claimed'
    | 'admitted'
    | 'stopping'
    | 'session-closing'
    | 'settled'
    | 'released';
  type RunState = {
    readonly line: string;
    readonly admission: Deferred<ProjectTerminalAdmission>;
    readonly ready: Deferred<void>;
    readonly exitCode: Deferred<number>;
    readonly exited: Deferred<ProcessExit>;
    handle: ProjectTerminalRun;
    lifecycle: RunLifecycle;
    rid: string | null;
    exit: ProcessExit | null;
    stopOutcome: Deferred<ProcessExit> | null;
    stopPromise: Promise<ProcessExit> | null;
    closePromise: Promise<ProcessExit> | null;
    stdinEnded: boolean;
    eofPromise: Promise<void> | null;
    readonly inputQueue: InputOperation[];
    inputInFlight: InputOperation | null;
    preAdmissionResize: PendingResize | null;
    readonly resizeQueue: ResizeOperation[];
    resizeInFlight: ResizeOperation | null;
  };

  const listeners = new Set<(chunk: string, stream: 'stdout' | 'stderr') => void>();
  const textEncoder = new TextEncoder();
  let dimensions = { cols: 80, rows: 24 };
  let idleResizeTail: Promise<void> = Promise.resolve();
  const idleResizeWaiters = new Set<Deferred<void>>();
  let active: RunState | null = null;
  let terminalClosed = false;
  let terminalClosing = false;
  let terminalCloseCancellation: ClosedHandleError | null = null;
  let terminalFailure: ClosedHandleError | null = null;
  let terminalClosePromise: Promise<void> | null = null;

  function deferred<T>(): Deferred<T> {
    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (error: Error) => void;
    let isSettled = false;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    void promise.catch(() => {});
    return {
      promise,
      resolve(value) {
        if (isSettled) return;
        isSettled = true;
        resolvePromise(value);
      },
      reject(error) {
        if (isSettled) return;
        isSettled = true;
        rejectPromise(error);
      },
      settled: () => isSettled,
    };
  }

  function errorFrom(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  function closedError(cause?: unknown): ClosedHandleError {
    return terminalFailure ?? new ClosedHandleError(`Project terminal ${id}`, cause);
  }

  function assertOpen(): void {
    if (!port.isAlive() && terminalFailure === null) {
      failTerminal(new ClosedHandleError(`Project terminal ${id}`, 'owner is not alive'));
    }
    if (terminalFailure !== null) throw terminalFailure;
    if (terminalClosing || terminalClosed) throw closedError();
  }

  function rejectInput(state: RunState, error: Error): void {
    const queued = state.inputQueue.splice(0);
    state.inputInFlight = null;
    for (const operation of queued) operation.deferred.reject(error);
  }

  function rejectResizes(state: RunState, error: Error): void {
    const preAdmission = state.preAdmissionResize;
    state.preAdmissionResize = null;
    if (preAdmission !== null) {
      for (const waiter of preAdmission.waiters) waiter.reject(error);
    }
    const queued = state.resizeQueue.splice(0);
    state.resizeInFlight = null;
    for (const operation of queued) {
      for (const waiter of operation.waiters) waiter.reject(error);
    }
  }

  function failRun(state: RunState, error: Error): void {
    if (state.lifecycle !== 'released') state.lifecycle = 'settled';
    state.admission.reject(error);
    state.stopOutcome?.reject(error);
    state.ready.reject(error);
    state.exitCode.reject(error);
    state.exited.reject(error);
    rejectInput(state, error);
    rejectResizes(state, error);
  }

  function failTerminal(error: ClosedHandleError, runError: Error = error): void {
    if (terminalFailure !== null || terminalClosed) return;
    terminalFailure = error;
    terminalClosing = true;
    listeners.clear();
    for (const waiter of [...idleResizeWaiters]) {
      idleResizeWaiters.delete(waiter);
      waiter.reject(error);
    }
    const state = active;
    if (state !== null) failRun(state, runError);
  }

  function activeRun(): RunState {
    assertOpen();
    if (active === null) throw new Error(`Project terminal ${id} has no active run`);
    if (active.lifecycle !== 'claimed' && active.lifecycle !== 'admitted') {
      throw new ClosedHandleError(`Project terminal run ${id}`, active.exit ?? active.lifecycle);
    }
    return active;
  }

  function publishChunk(chunk: string, stream: 'stdout' | 'stderr'): void {
    for (const listener of [...listeners]) {
      try {
        listener(chunk, stream);
      } catch (error) {
        try {
          globalThis.reportError?.(error);
        } catch {
          // A host callback cannot take ownership of terminal progress.
        }
      }
    }
  }

  function pumpInput(state: RunState): void {
    if (
      state !== active ||
      state.lifecycle !== 'admitted' ||
      state.rid === null ||
      state.inputInFlight !== null
    ) {
      return;
    }
    const operation = state.inputQueue[0];
    if (operation === undefined) return;
    state.inputInFlight = operation;
    let acknowledged: Promise<void>;
    try {
      acknowledged =
        operation.kind === 'data'
          ? port.writeStdin(id, state.rid, (operation.data as Uint8Array).slice())
          : port.endStdin(id, state.rid);
    } catch (error) {
      acknowledged = Promise.reject(error);
    }
    void acknowledged.then(
      () => {
        if (state.inputInFlight !== operation) return;
        state.inputInFlight = null;
        if (state.inputQueue[0] === operation) state.inputQueue.shift();
        operation.deferred.resolve(undefined);
        pumpInput(state);
      },
      (error: unknown) => {
        if (state.inputInFlight !== operation) return;
        rejectInput(state, errorFrom(error));
      },
    );
  }

  function pumpResize(state: RunState): void {
    if (
      state !== active ||
      state.lifecycle !== 'admitted' ||
      state.rid === null ||
      state.resizeInFlight !== null
    ) {
      return;
    }
    const operation = state.resizeQueue[0];
    if (operation === undefined) return;
    state.resizeInFlight = operation;
    let acknowledged: Promise<void>;
    try {
      acknowledged = port.resize(id, state.rid, operation.cols, operation.rows);
    } catch (error) {
      acknowledged = Promise.reject(error);
    }
    void acknowledged.then(
      () => {
        if (state.resizeInFlight !== operation) return;
        state.resizeInFlight = null;
        if (state.resizeQueue[0] === operation) state.resizeQueue.shift();
        dimensions = { cols: operation.cols, rows: operation.rows };
        for (const waiter of operation.waiters) waiter.resolve(undefined);
        pumpResize(state);
      },
      (error: unknown) => {
        if (state.resizeInFlight !== operation) return;
        rejectResizes(state, errorFrom(error));
      },
    );
  }

  function admit(state: RunState, rid: string): void {
    if (state !== active || terminalFailure !== null || terminalClosed) return;
    if (
      state.lifecycle === 'session-closing' ||
      state.lifecycle === 'settled' ||
      state.lifecycle === 'released'
    ) {
      return;
    }
    if (typeof rid !== 'string' || rid.length === 0) {
      failRun(state, new Error(`Project terminal ${id} received an empty run id`));
      return;
    }
    if (state.rid !== null) {
      if (state.rid !== rid) {
        failRun(state, new Error(`Project terminal ${id} received two run ids`));
      }
      return;
    }
    state.rid = rid;
    const pendingResize = state.preAdmissionResize;
    state.preAdmissionResize = null;
    if (pendingResize !== null) {
      state.resizeQueue.push({
        cols: pendingResize.cols,
        rows: pendingResize.rows,
        waiters: pendingResize.waiters,
      });
    }
    if (state.lifecycle === 'stopping') {
      try {
        port.signal(id, rid);
      } catch (error) {
        state.stopOutcome?.reject(errorFrom(error));
      }
      return;
    }
    state.lifecycle = 'admitted';
    state.admission.resolve(Object.freeze({ ptySid: id, ptyRid: rid }));
    state.ready.resolve(undefined);
    pumpInput(state);
    pumpResize(state);
  }

  let openPromise: Promise<void>;
  try {
    openPromise = port.openSession(
      id,
      initialState === undefined
        ? undefined
        : { cwd: initialState.cwd, env: { ...initialState.env } },
    );
  } catch (error) {
    openPromise = Promise.reject(error);
  }
  void openPromise.catch((error: unknown) => {
    const cause = errorFrom(error);
    if (cause === terminalCloseCancellation) {
      const state = active;
      if (state !== null && !state.exited.settled()) failRun(state, cause);
      return;
    }
    failTerminal(new ClosedHandleError(`Project terminal ${id}`, cause), cause);
  });
  void port.closed.then(
    (reason) => failTerminal(new ClosedHandleError(`Project terminal ${id}`, reason)),
    (reason: unknown) => failTerminal(new ClosedHandleError(`Project terminal ${id}`, reason)),
  );

  function enqueueIdleResize(cols: number, rows: number): Promise<void> {
    const waiter = deferred<void>();
    idleResizeWaiters.add(waiter);
    const predecessor = idleResizeTail.catch(() => {});
    idleResizeTail = waiter.promise;
    void predecessor
      .then(async () => {
        if (waiter.settled()) return;
        await openPromise;
        assertOpen();
        if (waiter.settled()) return;
        await port.resizeSession(id, cols, rows);
        if (waiter.settled()) return;
        dimensions = { cols, rows };
        idleResizeWaiters.delete(waiter);
        waiter.resolve(undefined);
      })
      .catch((error: unknown) => {
        if (waiter.settled()) return;
        idleResizeWaiters.delete(waiter);
        waiter.reject(errorFrom(error));
      });
    return waiter.promise;
  }

  function release(state: RunState): void {
    state.lifecycle = 'released';
    if (active === state) active = null;
  }

  function closeRun(state: RunState, requestStop: boolean): Promise<ProcessExit> {
    if (state.closePromise !== null) return state.closePromise;
    const closing = deferred<ProcessExit>();
    state.closePromise = closing.promise;
    let outcome: Promise<ProcessExit>;
    try {
      outcome = requestStop ? state.handle.stop() : state.exited.promise;
    } catch (error) {
      outcome = Promise.reject(errorFrom(error));
    }
    void outcome.then(
      (exit) => {
        release(state);
        closing.resolve(exit);
      },
      async (error: unknown) => {
        if (requestStop && !state.exited.settled()) {
          await state.exited.promise.catch(() => {});
        }
        release(state);
        closing.reject(errorFrom(error));
      },
    );
    return closing.promise;
  }

  function createRun(line: string): ProjectTerminalRun {
    const admission = deferred<ProjectTerminalAdmission>();
    const ready = deferred<void>();
    const exitCode = deferred<number>();
    const exited = deferred<ProcessExit>();
    const idleBarrier = Promise.all([...idleResizeWaiters].map((waiter) => waiter.promise)).then(
      () => undefined,
    );
    const handle: ProjectTerminalRun = {
      ready: ready.promise,
      exitCode: exitCode.promise,
      exited: exited.promise,
      stop() {
        if (state.stopPromise !== null) return state.stopPromise;
        if (
          state.lifecycle === 'session-closing' ||
          state.lifecycle === 'settled' ||
          state.lifecycle === 'released'
        ) {
          state.stopPromise = state.exited.promise;
          return state.stopPromise;
        }
        state.lifecycle = 'stopping';
        const stopOutcome = deferred<ProcessExit>();
        state.stopOutcome = stopOutcome;
        state.stopPromise = stopOutcome.promise;
        const controlError = new ClosedHandleError(`Project terminal run ${id}`, 'stop requested');
        if (state.rid === null) {
          state.admission.reject(controlError);
          state.ready.reject(controlError);
        }
        rejectInput(state, controlError);
        rejectResizes(state, controlError);
        if (state.rid !== null) {
          try {
            port.signal(id, state.rid);
          } catch (error) {
            stopOutcome.reject(errorFrom(error));
            return stopOutcome.promise;
          }
        }
        return stopOutcome.promise;
      },
      close() {
        return closeRun(state, true);
      },
    };
    const state: RunState = {
      line,
      admission,
      ready,
      exitCode,
      exited,
      handle,
      lifecycle: 'claimed',
      rid: null,
      exit: null,
      stopOutcome: null,
      stopPromise: null,
      closePromise: null,
      stdinEnded: false,
      eofPromise: null,
      inputQueue: [],
      inputInFlight: null,
      preAdmissionResize: null,
      resizeQueue: [],
      resizeInFlight: null,
    };
    runAdmissions.set(handle, admission.promise);
    active = state;

    void Promise.all([openPromise, idleBarrier]).then(
      () => {
        if (
          active !== state ||
          terminalFailure !== null ||
          terminalClosing ||
          terminalClosed ||
          state.lifecycle === 'session-closing'
        ) {
          return;
        }
        let result: Promise<{ readonly exitCode: number; readonly exit: ProcessExit }>;
        try {
          result = port.execResult(id, line, {
            cols: dimensions.cols,
            rows: dimensions.rows,
            isTTY: true,
            onChunk: publishChunk,
            onStart: (rid) => admit(state, rid),
          });
        } catch (error) {
          result = Promise.reject(error);
        }
        void result.then(
          (terminal) => {
            state.lifecycle = 'settled';
            state.exit = terminal.exit;
            if (state.rid === null) {
              const failure = new Error(`Project terminal ${id} exited before owner run admission`);
              state.admission.reject(failure);
              state.ready.reject(failure);
            }
            rejectInput(state, new ClosedHandleError(`Project terminal run ${id}`, terminal.exit));
            rejectResizes(
              state,
              new ClosedHandleError(`Project terminal run ${id}`, terminal.exit),
            );
            state.stopOutcome?.resolve(terminal.exit);
            state.exitCode.resolve(terminal.exitCode);
            state.exited.resolve(terminal.exit);
          },
          (error: unknown) => failRun(state, errorFrom(error)),
        );
      },
      (error: unknown) => {
        if (active === state) failRun(state, errorFrom(error));
      },
    );

    return handle;
  }

  const terminal: ProjectTerminal = {
    snapshot() {
      assertOpen();
      return ownProjectTerminalSnapshot(port.snapshot(id));
    },

    complete(line, cursor) {
      try {
        assertOpen();
      } catch (error) {
        return Promise.reject(errorFrom(error));
      }
      return openPromise.then(() => {
        assertOpen();
        return port.complete(id, line, cursor);
      });
    },

    run(line) {
      assertOpen();
      if (typeof line !== 'string' || line.trim().length === 0) {
        throw new TypeError('Project terminal command must be a non-empty string');
      }
      if (active !== null) throw new ProjectBusyError(`Project terminal ${id}`);
      const run = createRun(line);
      return run;
    },

    write(data) {
      try {
        const state = activeRun();
        if (state.stdinEnded) return Promise.reject(new StdinClosedError());
        const operation: InputOperation = {
          kind: 'data',
          data: typeof data === 'string' ? textEncoder.encode(data) : data.slice(),
          deferred: deferred<void>(),
        };
        state.inputQueue.push(operation);
        pumpInput(state);
        return operation.deferred.promise;
      } catch (error) {
        return Promise.reject(errorFrom(error));
      }
    },

    end() {
      try {
        const state = activeRun();
        if (state.eofPromise !== null) return state.eofPromise;
        state.stdinEnded = true;
        const operation: InputOperation = { kind: 'eof', deferred: deferred<void>() };
        state.eofPromise = operation.deferred.promise;
        state.inputQueue.push(operation);
        pumpInput(state);
        return state.eofPromise;
      } catch (error) {
        return Promise.reject(errorFrom(error));
      }
    },

    resize(cols, rows) {
      if (!Number.isSafeInteger(cols) || cols <= 0) {
        throw new RangeError(`Terminal cols must be a positive safe integer; received ${cols}`);
      }
      if (!Number.isSafeInteger(rows) || rows <= 0) {
        throw new RangeError(`Terminal rows must be a positive safe integer; received ${rows}`);
      }
      try {
        assertOpen();
      } catch (error) {
        return Promise.reject(errorFrom(error));
      }
      const state = active;
      if (state === null) return enqueueIdleResize(cols, rows);
      if (state.lifecycle !== 'claimed' && state.lifecycle !== 'admitted') {
        return Promise.reject(
          new ClosedHandleError(`Project terminal run ${id}`, state.exit ?? state.lifecycle),
        );
      }
      const waiter = deferred<void>();
      if (state.rid === null) {
        if (state.preAdmissionResize === null) {
          state.preAdmissionResize = { cols, rows, waiters: [waiter] };
        } else {
          state.preAdmissionResize.cols = cols;
          state.preAdmissionResize.rows = rows;
          state.preAdmissionResize.waiters.push(waiter);
        }
      } else {
        state.resizeQueue.push({ cols, rows, waiters: [waiter] });
        pumpResize(state);
      }
      return waiter.promise;
    },

    attach(listener) {
      assertOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      if (terminalClosePromise !== null) return terminalClosePromise;
      if (terminalFailure !== null) {
        terminalClosePromise = Promise.reject(terminalFailure);
        void terminalClosePromise.catch(() => {});
        return terminalClosePromise;
      }
      const closeOutcome = deferred<void>();
      terminalClosePromise = closeOutcome.promise;
      terminalClosing = true;
      const closingError = new ClosedHandleError(`Project terminal ${id}`, 'close started');
      terminalCloseCancellation = closingError;
      for (const waiter of [...idleResizeWaiters]) {
        idleResizeWaiters.delete(waiter);
        waiter.reject(closingError);
      }
      const state = active;
      let runClose: Promise<ProcessExit> | null = null;
      if (state !== null) {
        if (
          state.lifecycle === 'claimed' ||
          state.lifecycle === 'admitted' ||
          state.lifecycle === 'stopping'
        ) {
          state.lifecycle = 'session-closing';
          rejectInput(state, closingError);
          rejectResizes(state, closingError);
        }
        runClose = closeRun(state, false);
      }
      let ownerClose: Promise<void>;
      try {
        ownerClose = port.closeSession(id, closingError);
      } catch (error) {
        ownerClose = Promise.reject(errorFrom(error));
      }
      void (async () => {
        const errors: Error[] = [];
        try {
          await ownerClose;
        } catch (error) {
          const cause = errorFrom(error);
          errors.push(cause);
          if (state !== null && !state.exited.settled()) failRun(state, cause);
        }
        if (state !== null && state.lifecycle === 'session-closing') {
          failRun(state, closingError);
        }
        if (runClose !== null) {
          try {
            await runClose;
          } catch (error) {
            const cause = errorFrom(error);
            if (cause !== closingError && !errors.includes(cause)) errors.push(cause);
          }
        }
        terminalClosed = true;
        listeners.clear();
        if (errors.length === 1) {
          closeOutcome.reject(errors[0] as Error);
          return;
        }
        if (errors.length > 1) {
          closeOutcome.reject(
            new AggregateError(errors, errors.map((error) => error.message).join('; ')),
          );
          return;
        }
        closeOutcome.resolve(undefined);
      })();
      void Promise.resolve().then(() => {
        if (state !== null && state.rid === null && state.lifecycle === 'session-closing') {
          state.admission.reject(closingError);
          state.ready.reject(closingError);
        }
      });
      return closeOutcome.promise;
    },
  };

  return terminal;
}
