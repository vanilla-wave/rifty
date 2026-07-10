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

import type { Shell, StdinReader } from '@riftydev/shell';
import type {
  OwnerToPageFrame,
  PageToOwnerFrame,
  PtyRunOrigin,
  PtyStream,
} from '../glue/pty-protocol.ts';
import { ptyRunMayOutliveExit } from './pty-run-lifetime.ts';

/**
 * Async stdin pipe fed by `pty:stdin` frames; `read()` resolves a queued chunk,
 * or `null` at EOF (mirrors the WASI `fd_read` model). Moved from
 * `terminal-manager.ts` — its sole owner is now this server (S2 drops the PAGE copy).
 */
class StdinQueue implements StdinReader {
  readonly #chunks: Uint8Array[] = [];
  readonly #readers: Array<(chunk: Uint8Array | null) => void> = [];
  #closed = false;

  write(data: Uint8Array): void {
    if (this.#closed) return;
    const reader = this.#readers.shift();
    if (reader) {
      reader(data);
      return;
    }
    this.#chunks.push(data);
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.#chunks.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.#closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#readers.push(resolve);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const reader of this.#readers.splice(0)) reader(null);
  }
}

interface RunState {
  readonly stdin: StdinQueue;
  readonly controller: AbortController;
  seq: number;
}

interface Session {
  readonly shell: Shell;
  readonly runs: Map<string, RunState>;
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
  /** Brackets the command itself (after the dependency gate), preserving origin. */
  readonly onRunStart?: (run: { sid: string; rid: string; origin: PtyRunOrigin }) => void;
  readonly onRunSettled?: (run: {
    sid: string;
    rid: string;
    origin: PtyRunOrigin;
    mayOutlivePty: boolean;
  }) => void;
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

export function createPtyServer(deps: PtyServerDeps): PtyServer {
  const sessions = new Map<string, Session>();

  function emitChunk(
    sid: string,
    run: RunState,
    rid: string,
    chunk: string,
    stream: PtyStream,
  ): void {
    deps.send({ type: 'pty:chunk', sid, rid, stream, seq: run.seq++, data: enc.encode(chunk) });
  }

  async function exec(
    sid: string,
    frame: Extract<PageToOwnerFrame, { type: 'pty:exec' }>,
  ): Promise<void> {
    const session = sessions.get(sid);
    if (!session) {
      // No open session for this sid (protocol-order violation / owner restart).
      // Emit a synthetic error-exit so the page run promise settles LOUD instead
      // of hanging the terminal line forever (AGENTS.md §Fidelity — no silent stub).
      deps.send({
        type: 'pty:exit',
        sid,
        rid: frame.rid,
        code: 1,
        cwd: '/',
        env: {},
        error: `pty:exec for unknown session ${sid} — no pty:open (protocol-order violation)`,
      });
      return;
    }
    const run: RunState = { stdin: new StdinQueue(), controller: new AbortController(), seq: 0 };
    session.runs.set(frame.rid, run);
    let code = 0;
    let error: string | undefined;
    const origin = frame.origin ?? 'user';
    let commandStarted = false;
    let mayOutlivePty = false;
    try {
      // A blank line is a shell no-op — nothing it runs needs deps, so it skips
      // the gate (instant prompt, no restore-progress noise on empty Enter).
      if (frame.line.trim() !== '') {
        const gate = deps.beforeRun?.((chunk, stream) => {
          // Progress from a gate the user already aborted is noise at the next
          // prompt (the page routes post-exit chunks to the terminal).
          if (!run.controller.signal.aborted) emitChunk(sid, run, frame.rid, chunk, stream);
        });
        if (gate !== undefined) {
          // Abort-aware gate: pty:signal/pty:close during a slow deps restore
          // settles the run NOW (the restore keeps running for the next run —
          // it is shared state, not owned by this run). Waiting it out left the
          // terminal `busy` for the whole restore after a Ctrl-C.
          const gatePromise = Promise.resolve(gate);
          await Promise.race([gatePromise, abortSettled(run.controller.signal)]);
          // A gate failure AFTER the abort won the race has no run to fail —
          // swallow it so it cannot surface as an unhandled rejection.
          gatePromise.catch(() => {});
        }
      }
      if (run.controller.signal.aborted) {
        // pty:signal / pty:close landed while the gate was pending: the user
        // stopped the run before it started — never invoke the command.
        code = 130;
      } else {
        commandStarted = true;
        deps.onRunStart?.({ sid, rid: frame.rid, origin });
        const result = await session.shell.run(frame.line, {
          onChunk: (chunk, stream) => emitChunk(sid, run, frame.rid, chunk, stream),
          signal: run.controller.signal,
          isTTY: frame.isTTY,
          cols: frame.cols,
          rows: frame.rows,
          stdin: run.stdin,
        });
        code = result.exitCode;
        // Classify only after a non-throwing run. Unsupported background forms
        // never launched work and must not create a proactive dirty guard.
        mayOutlivePty = ptyRunMayOutliveExit(frame.line, session.shell.envSnapshot());
      }
    } catch (err) {
      code = 1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (commandStarted) {
        deps.onRunSettled?.({ sid, rid: frame.rid, origin, mayOutlivePty });
      }
      session.runs.delete(frame.rid);
      run.stdin.close();
    }
    deps.send({
      type: 'pty:exit',
      sid,
      rid: frame.rid,
      code,
      cwd: session.shell.cwd,
      env: publicEnv(session.shell.envSnapshot()),
      ...(error === undefined ? {} : { error }),
    });
  }

  function handleFrame(frame: PageToOwnerFrame): void | Promise<void> {
    switch (frame.type) {
      case 'pty:open': {
        if (!sessions.has(frame.sid)) {
          sessions.set(frame.sid, {
            shell: deps.makeShell({ cwd: frame.cwd, env: frame.env }, frame.sid),
            runs: new Map(),
          });
        }
        deps.send({ type: 'pty:ready', sid: frame.sid });
        return;
      }
      case 'pty:exec':
        return exec(frame.sid, frame);
      case 'pty:stdin': {
        sessions.get(frame.sid)?.runs.get(frame.rid)?.stdin.write(frame.data);
        return;
      }
      case 'pty:stdin-eof': {
        sessions.get(frame.sid)?.runs.get(frame.rid)?.stdin.close();
        return;
      }
      case 'pty:signal': {
        sessions.get(frame.sid)?.runs.get(frame.rid)?.controller.abort();
        return;
      }
      case 'pty:close': {
        const session = sessions.get(frame.sid);
        if (session) for (const run of session.runs.values()) run.controller.abort();
        sessions.delete(frame.sid);
        return;
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
      for (const session of sessions.values()) {
        for (const run of session.runs.values()) run.controller.abort();
      }
      sessions.clear();
    },
  };
}
