/**
 * Owner-side pty server (ADR-0146 — shell/npm/bin co-resident in the owner).
 * Hosts a `Shell` per session in the
 * persistent workspace-owner worker and dispatches the page's `pty:*` frames
 * against it. Streams stdout/stderr back as `pty:chunk` frames, then a single
 * `pty:exit` (carrying the post-run cwd/env so the page's prompt cache stays
 * truthful). `send`/`makeShell` are injected so this is unit-testable without a
 * Worker — the bootstrap wires `send` to the kernel fork-IPC channel and
 * `makeShell` to a Shell built with the owner's npm builtin + in-realm execBin.
 *
 * Frame ordering is guaranteed by the single channel: each `onChunk` synchronously
 * pushes a `pty:chunk` before `run` resolves, so the terminating `pty:exit`
 * always follows the run's chunks (the streaming-before-blob contract of
 * `Shell.run`). `seq` is monotonic per `rid` for loss-detect / forward-compat.
 */

import type {
  ProcessExit,
  Shell,
  StdinReader,
  TerminalResizeSource,
  TerminalSize,
} from '@riftydev/shell';
import type { OwnerToPageFrame, PageToOwnerFrame, PtyStream } from '../glue/pty-protocol.ts';

/**
 * Async stdin pipe fed by `pty:stdin` frames; `read()` resolves a queued chunk,
 * or `null` at EOF (mirrors the WASI `fd_read` model). Moved from
 * `terminal-manager.ts` — its sole owner is now this server (S2 drops the PAGE copy).
 */
class StdinQueue implements StdinReader {
  readonly #chunks: Array<{
    readonly data: Uint8Array;
    readonly ack: (error?: Error) => void;
  }> = [];
  readonly #readers: Array<(chunk: Uint8Array | null) => void> = [];
  readonly #eofAcks: Array<(error?: Error) => void> = [];
  #ended = false;
  #aborted = false;

  write(data: Uint8Array, ack: (error?: Error) => void): boolean {
    if (this.#ended || this.#aborted) return false;
    const reader = this.#readers.shift();
    if (reader) {
      reader(data);
      ack();
      return true;
    }
    this.#chunks.push({ data, ack });
    return true;
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.#chunks.shift();
    if (chunk) {
      chunk.ack();
      return Promise.resolve(chunk.data);
    }
    if (this.#ended || this.#aborted) {
      for (const ack of this.#eofAcks.splice(0)) ack();
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.#readers.push(resolve);
    });
  }

  end(ack: (error?: Error) => void): void {
    if (this.#aborted) {
      ack(new Error('ClosedHandleError: pty stdin is closed'));
      return;
    }
    this.#eofAcks.push(ack);
    if (this.#ended) return;
    this.#ended = true;
    if (this.#readers.length === 0) return;
    for (const reader of this.#readers.splice(0)) reader(null);
    for (const eofAck of this.#eofAcks.splice(0)) eofAck();
  }

  abort(error: Error): void {
    if (this.#aborted) return;
    this.#aborted = true;
    this.#ended = true;
    for (const chunk of this.#chunks.splice(0)) chunk.ack(error);
    for (const ack of this.#eofAcks.splice(0)) ack(error);
    for (const reader of this.#readers.splice(0)) reader(null);
  }
}

interface RunState {
  readonly rid: string;
  readonly stdin: StdinQueue;
  readonly controller: AbortController;
  readonly terminal: MutableTerminalResizeSource;
  done?: Promise<void>;
  stdinEnded: boolean;
  seq: number;
}

class MutableTerminalResizeSource implements TerminalResizeSource {
  #size: TerminalSize;
  readonly #listeners = new Set<(size: TerminalSize) => void>();

  constructor(cols: number, rows: number) {
    this.#size = { cols, rows };
  }

  current(): TerminalSize {
    return this.#size;
  }

  subscribe(listener: (size: TerminalSize) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  resize(cols: number, rows: number): void {
    if (this.#size.cols === cols && this.#size.rows === rows) return;
    this.#size = { cols, rows };
    for (const listener of this.#listeners) listener(this.#size);
  }

  dispose(): void {
    this.#listeners.clear();
  }
}

/** Seed cwd/env for a session's Shell (restored persisted terminal state). */
export interface ShellSeed {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export interface PtyServerDeps {
  /** Wired to the kernel fork-IPC channel by the bootstrap. */
  readonly send: (frame: OwnerToPageFrame) => void;
  /** Builds a session Shell (owner npm builtin + in-realm execBin), seeded with cwd/env. */
  readonly makeShell: (seed: ShellSeed | undefined, sid: string) => Shell;
  /**
   * Owner re-publishes dev-server state on a page request (ADR-0148 — co-resident
   * dev server runs inside the owner). Wired by
   * the bootstrap to the dev-server controller; the pty-server stays
   * dev-server-agnostic (it only forwards the request).
   */
  readonly onDevServerReq?: () => void;
  /** Owner re-publishes the multi-port preview registry on a page request (ADR-0155). */
  readonly onPreviewReq?: () => void;
  /**
   * Page updated the current preset's dev-server config (ADR-0148 — owner-resident
   * dev server) — the next
   * co-resident dev server boots this template/runtime. Forwarded to the bootstrap.
   */
  readonly onDevConfig?: (config: {
    templateId: string;
    slug: string;
    setup: 'instant' | 'from-scratch';
  }) => void | Promise<void>;
  /**
   * Awaited between run registration and the command itself — the bootstrap's
   * deps gate (instant-preset snapshot restore overlaps the echoed command
   * instead of gating the page's `$ <line>` echo). `emit` streams progress
   * chunks into THIS run's terminal output. The run is already registered, so
   * stdin/signal frames arriving during the gate queue instead of dropping. A
   * rejection fails the run loudly (exit 1 + error) and the command never runs.
   */
  readonly beforeRun?: (emit: (chunk: string, stream: PtyStream) => void) => void | Promise<void>;
}

export interface PtyServer {
  handleFrame(frame: PageToOwnerFrame): void | Promise<void>;
  dispose(): void;
}

const enc = new TextEncoder();
const INTERNAL_ENV_KEYS = ['RIFTY_INTERNAL_PTY_SID'] as const;

function publicEnv(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  for (const key of INTERNAL_ENV_KEYS) delete out[key];
  return out;
}

/** Resolves when the signal aborts (immediately for an already-aborted one). */
function abortSettled(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

class PtySessionActor {
  readonly #sid: string;
  readonly #shell: Shell;
  readonly #deps: PtyServerDeps;
  #dimensions: TerminalSize = { cols: 80, rows: 24 };
  #active: RunState | null = null;
  #state: 'open' | 'closing' | 'closed' = 'open';
  #shutdownPromise: Promise<void> | undefined;

  constructor(sid: string, shell: Shell, deps: PtyServerDeps) {
    this.#sid = sid;
    this.#shell = shell;
    this.#deps = deps;
  }

  openError(): string | undefined {
    return this.#state === 'open'
      ? undefined
      : `ClosedHandleError: pty session ${this.#sid} is ${this.#state}`;
  }

  exec(frame: Extract<PageToOwnerFrame, { type: 'pty:exec' }>): Promise<void> {
    if (this.#state !== 'open') {
      this.#emitRejectedExit(frame, `pty session ${this.#sid} is ${this.#state}`);
      return Promise.resolve();
    }
    if (this.#active) {
      this.#emitRejectedExit(
        frame,
        `ProjectBusyError: pty session ${this.#sid} already running ${this.#active.rid}`,
      );
      return Promise.resolve();
    }
    if (!validDimension(frame.cols) || !validDimension(frame.rows)) {
      this.#emitRejectedExit(
        frame,
        'RangeError: terminal dimensions must be positive safe integers',
      );
      return Promise.resolve();
    }

    this.#dimensions = { cols: frame.cols, rows: frame.rows };
    const run: RunState = {
      rid: frame.rid,
      stdin: new StdinQueue(),
      controller: new AbortController(),
      terminal: new MutableTerminalResizeSource(this.#dimensions.cols, this.#dimensions.rows),
      stdinEnded: false,
      seq: 0,
    };
    this.#active = run;
    // The actor owns admission: publish it only after the run is registered.
    // Defer execution one microtask so `run.done` also exists if a loopback
    // transport delivers stop/close re-entrantly from the admission callback.
    const done = Promise.resolve().then(() => this.#execute(run, frame));
    run.done = done;
    this.#deps.send({ type: 'pty:run-ready', sid: this.#sid, rid: frame.rid });
    return done;
  }

  resizeSession(frame: Extract<PageToOwnerFrame, { type: 'pty:session-resize' }>): void {
    let error: string | undefined;
    if (this.#state !== 'open') {
      error = `ClosedHandleError: pty session ${this.#sid} is ${this.#state}`;
    } else if (this.#active) {
      error = `ProjectBusyError: pty session ${this.#sid} already running ${this.#active.rid}`;
    } else if (!validDimension(frame.cols) || !validDimension(frame.rows)) {
      error = 'RangeError: terminal dimensions must be positive safe integers';
    } else {
      this.#dimensions = { cols: frame.cols, rows: frame.rows };
    }
    this.#deps.send(
      error === undefined
        ? {
            type: 'pty:session-resize-ack',
            sid: this.#sid,
            opId: frame.opId,
            ok: true,
          }
        : {
            type: 'pty:session-resize-ack',
            sid: this.#sid,
            opId: frame.opId,
            ok: false,
            error,
          },
    );
  }

  resize(frame: Extract<PageToOwnerFrame, { type: 'pty:resize' }>): void {
    const run = this.#run(frame.rid);
    if (!run) {
      this.#deps.send({
        type: 'pty:resize-ack',
        sid: this.#sid,
        rid: frame.rid,
        opId: frame.opId,
        ok: false,
        error: `StaleRunError: ${frame.rid} is not active in ${this.#sid}`,
      });
      return;
    }
    if (!validDimension(frame.cols) || !validDimension(frame.rows)) {
      this.#deps.send({
        type: 'pty:resize-ack',
        sid: this.#sid,
        rid: frame.rid,
        opId: frame.opId,
        ok: false,
        error: 'RangeError: terminal dimensions must be positive safe integers',
      });
      return;
    }
    try {
      run.terminal.resize(frame.cols, frame.rows);
      this.#dimensions = { cols: frame.cols, rows: frame.rows };
      this.#deps.send({
        type: 'pty:resize-ack',
        sid: this.#sid,
        rid: frame.rid,
        opId: frame.opId,
        ok: true,
      });
    } catch (error) {
      this.#deps.send({
        type: 'pty:resize-ack',
        sid: this.#sid,
        rid: frame.rid,
        opId: frame.opId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  stdin(frame: Extract<PageToOwnerFrame, { type: 'pty:stdin' }>): void {
    const run = this.#run(frame.rid);
    if (
      !run ||
      run.stdinEnded ||
      !run.stdin.write(frame.data, (error) => this.#stdinAck(frame.rid, frame.opId, error?.message))
    ) {
      this.#stdinAck(frame.rid, frame.opId, `StdinClosedError: stdin is closed for ${frame.rid}`);
    }
  }

  endStdin(frame: Extract<PageToOwnerFrame, { type: 'pty:stdin-eof' }>): void {
    const run = this.#run(frame.rid);
    if (!run) {
      this.#stdinAck(frame.rid, frame.opId, `StaleRunError: ${frame.rid} is not active`);
      return;
    }
    run.stdinEnded = true;
    run.stdin.end((error) => this.#stdinAck(frame.rid, frame.opId, error?.message));
  }

  signal(rid: string): void {
    this.#run(rid)?.controller.abort();
  }

  close(opId: string): Promise<void> {
    return this.#shutdown().then(
      () => {
        this.#deps.send({ type: 'pty:close-ack', sid: this.#sid, opId, ok: true });
      },
      (error: unknown) => {
        this.#deps.send({
          type: 'pty:close-ack',
          sid: this.#sid,
          opId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  dispose(): void {
    void this.#shutdown();
  }

  async #execute(
    run: RunState,
    frame: Extract<PageToOwnerFrame, { type: 'pty:exec' }>,
  ): Promise<void> {
    let code = 0;
    let exit: ProcessExit = { code: 0, signal: null };
    let error: string | undefined;
    try {
      if (frame.line.trim() !== '') {
        const gate = this.#deps.beforeRun?.((chunk, stream) => {
          if (!run.controller.signal.aborted) this.#emitChunk(run, chunk, stream);
        });
        if (gate !== undefined) {
          const gatePromise = Promise.resolve(gate);
          await Promise.race([gatePromise, abortSettled(run.controller.signal)]);
          gatePromise.catch(() => {});
        }
      }
      if (run.controller.signal.aborted) {
        code = 130;
        exit = { code: null, signal: 'SIGINT' };
      } else {
        const size = run.terminal.current();
        const options = {
          onChunk: (chunk: string, stream: PtyStream) => this.#emitChunk(run, chunk, stream),
          signal: run.controller.signal,
          isTTY: frame.isTTY,
          cols: size.cols,
          rows: size.rows,
          stdin: run.stdin,
          terminal: run.terminal,
          awaitAbortSettlement: true,
        };
        const result = await this.#shell.run(frame.line, options);
        code = result.exitCode;
        exit = result.exit;
      }
    } catch (caught) {
      code = 1;
      exit = { code: 1, signal: null };
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (this.#active === run) this.#active = null;
      run.stdin.abort(
        new Error(`ClosedHandleError: pty run ${this.#sid}/${frame.rid} settled before delivery`),
      );
      run.terminal.dispose();
    }
    this.#deps.send({
      type: 'pty:exit',
      sid: this.#sid,
      rid: frame.rid,
      code,
      exit,
      cwd: this.#shell.cwd,
      env: publicEnv(this.#shell.envSnapshot()),
      ...(error === undefined ? {} : { error }),
    });
  }

  #run(rid: string): RunState | undefined {
    return this.#state === 'open' && this.#active?.rid === rid ? this.#active : undefined;
  }

  #emitChunk(run: RunState, chunk: string, stream: PtyStream): void {
    this.#deps.send({
      type: 'pty:chunk',
      sid: this.#sid,
      rid: run.rid,
      stream,
      seq: run.seq++,
      data: enc.encode(chunk),
    });
  }

  #emitRejectedExit(frame: Extract<PageToOwnerFrame, { type: 'pty:exec' }>, error: string): void {
    this.#deps.send({
      type: 'pty:exit',
      sid: this.#sid,
      rid: frame.rid,
      code: 1,
      exit: { code: 1, signal: null },
      cwd: this.#shell.cwd,
      env: publicEnv(this.#shell.envSnapshot()),
      error,
    });
  }

  #stdinAck(rid: string, opId: string, error?: string): void {
    this.#deps.send(
      error === undefined
        ? { type: 'pty:stdin-ack', sid: this.#sid, rid, opId, ok: true }
        : { type: 'pty:stdin-ack', sid: this.#sid, rid, opId, ok: false, error },
    );
  }

  #shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#state = 'closing';
    const run = this.#active;
    run?.controller.abort();
    this.#shutdownPromise = Promise.resolve(run?.done).then(async () => {
      await this.#shell.dispose();
      this.#state = 'closed';
    });
    return this.#shutdownPromise;
  }
}

export function createPtyServer(deps: PtyServerDeps): PtyServer {
  const sessions = new Map<string, PtySessionActor>();

  function missingRunAck(
    frame:
      | Extract<PageToOwnerFrame, { type: 'pty:resize' }>
      | Extract<PageToOwnerFrame, { type: 'pty:stdin' }>
      | Extract<PageToOwnerFrame, { type: 'pty:stdin-eof' }>,
  ): void {
    const error = `StaleRunError: no open pty session ${frame.sid}`;
    if (frame.type === 'pty:resize') {
      deps.send({
        type: 'pty:resize-ack',
        sid: frame.sid,
        rid: frame.rid,
        opId: frame.opId,
        ok: false,
        error,
      });
    } else {
      deps.send({
        type: 'pty:stdin-ack',
        sid: frame.sid,
        rid: frame.rid,
        opId: frame.opId,
        ok: false,
        error,
      });
    }
  }

  function handleFrame(frame: PageToOwnerFrame): void | Promise<void> {
    switch (frame.type) {
      case 'pty:open': {
        const existing = sessions.get(frame.sid);
        if (existing) {
          const error = existing.openError();
          deps.send(
            error === undefined
              ? { type: 'pty:ready', sid: frame.sid }
              : { type: 'pty:ready', sid: frame.sid, error },
          );
          return;
        }
        sessions.set(
          frame.sid,
          new PtySessionActor(
            frame.sid,
            deps.makeShell({ cwd: frame.cwd, env: frame.env }, frame.sid),
            deps,
          ),
        );
        deps.send({ type: 'pty:ready', sid: frame.sid });
        return;
      }
      case 'pty:exec': {
        const actor = sessions.get(frame.sid);
        if (actor) return actor.exec(frame);
        deps.send({
          type: 'pty:exit',
          sid: frame.sid,
          rid: frame.rid,
          code: 1,
          exit: { code: 1, signal: null },
          cwd: '/',
          env: {},
          error: `pty:exec for unknown session ${frame.sid} — no pty:open (protocol-order violation)`,
        });
        return Promise.resolve();
      }
      case 'pty:stdin': {
        const actor = sessions.get(frame.sid);
        if (actor) actor.stdin(frame);
        else missingRunAck(frame);
        return;
      }
      case 'pty:stdin-eof': {
        const actor = sessions.get(frame.sid);
        if (actor) actor.endStdin(frame);
        else missingRunAck(frame);
        return;
      }
      case 'pty:signal': {
        sessions.get(frame.sid)?.signal(frame.rid);
        return;
      }
      case 'pty:resize': {
        const actor = sessions.get(frame.sid);
        if (actor) actor.resize(frame);
        else missingRunAck(frame);
        return;
      }
      case 'pty:session-resize': {
        const actor = sessions.get(frame.sid);
        if (actor) actor.resizeSession(frame);
        else {
          deps.send({
            type: 'pty:session-resize-ack',
            sid: frame.sid,
            opId: frame.opId,
            ok: false,
            error: `ClosedHandleError: no open pty session ${frame.sid}`,
          });
        }
        return;
      }
      case 'pty:close': {
        const actor = sessions.get(frame.sid);
        if (!actor) {
          deps.send({ type: 'pty:close-ack', sid: frame.sid, opId: frame.opId, ok: true });
          return Promise.resolve();
        }
        return actor.close(frame.opId).finally(() => {
          if (sessions.get(frame.sid) === actor) sessions.delete(frame.sid);
        });
      }
      case 'pty:dev-server-req': {
        deps.onDevServerReq?.();
        return;
      }
      case 'pty:preview-req': {
        deps.onPreviewReq?.();
        return;
      }
      case 'pty:dev-config': {
        return Promise.resolve(
          deps.onDevConfig?.({
            templateId: frame.templateId,
            slug: frame.slug,
            setup: frame.setup,
          }),
        ).then(
          () => deps.send({ type: 'pty:dev-config-ready', id: frame.id }),
          (err: unknown) =>
            deps.send({
              type: 'pty:dev-config-ready',
              id: frame.id,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
      }
    }
  }

  return {
    handleFrame,
    dispose(): void {
      for (const actor of sessions.values()) actor.dispose();
      sessions.clear();
    },
  };
}
