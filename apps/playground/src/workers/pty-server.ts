/**
 * Owner-side pty server (ADR-0146 P2). Hosts a `Shell` per session in the
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
import type { OwnerToPageFrame, PageToOwnerFrame, PtyStream } from '../glue/pty-protocol.ts';

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
  readonly makeShell: (seed?: ShellSeed) => Shell;
  /**
   * Owner re-publishes dev-server state on a page request (ADR-0148 P4). Wired by
   * the bootstrap to the dev-server controller; the pty-server stays
   * dev-server-agnostic (it only forwards the request).
   */
  readonly onDevServerReq?: () => void;
  /**
   * Page updated the current preset's dev-server config (ADR-0148 P4) — the next
   * co-resident dev server boots this template/runtime. Forwarded to the bootstrap.
   */
  readonly onDevConfig?: (config: {
    templateId: string;
    slug: string;
    setup: 'instant' | 'from-scratch';
  }) => void;
}

export interface PtyServer {
  handleFrame(frame: PageToOwnerFrame): void | Promise<void>;
  dispose(): void;
}

const enc = new TextEncoder();

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
    if (!session) return;
    const run: RunState = { stdin: new StdinQueue(), controller: new AbortController(), seq: 0 };
    session.runs.set(frame.rid, run);
    let code = 0;
    let error: string | undefined;
    try {
      const result = await session.shell.run(frame.line, {
        onChunk: (chunk, stream) => emitChunk(sid, run, frame.rid, chunk, stream),
        signal: run.controller.signal,
        isTTY: frame.isTTY,
        cols: frame.cols,
        rows: frame.rows,
        stdin: run.stdin,
      });
      code = result.exitCode;
    } catch (err) {
      code = 1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      session.runs.delete(frame.rid);
      run.stdin.close();
    }
    deps.send({
      type: 'pty:exit',
      sid,
      rid: frame.rid,
      code,
      cwd: session.shell.cwd,
      env: session.shell.envSnapshot(),
      ...(error === undefined ? {} : { error }),
    });
  }

  function handleFrame(frame: PageToOwnerFrame): void | Promise<void> {
    switch (frame.type) {
      case 'pty:open': {
        if (!sessions.has(frame.sid)) {
          sessions.set(frame.sid, {
            shell: deps.makeShell({ cwd: frame.cwd, env: frame.env }),
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
      case 'pty:resize':
        // Dims are per-exec in v1; live resize is a follow-up.
        return;
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
      case 'pty:dev-config': {
        deps.onDevConfig?.({
          templateId: frame.templateId,
          slug: frame.slug,
          setup: frame.setup,
        });
        return;
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
