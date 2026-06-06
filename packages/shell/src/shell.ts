/**
 * `Shell` — minimal command dispatcher.
 *
 * `run(line)` tokenizes, splits on `&&`/`||`/`;` joiners (quoted instances stay
 * literal — the tokenizer only emits joiners outside quotes), and runs segments
 * per POSIX short-circuit semantics; final exit is the LAST executed segment.
 *
 * Streaming: when `options.onChunk` is supplied, every `ctx.stdout.write` /
 * `ctx.stderr.write` invokes the callback synchronously _before_ the captured
 * run-blob is appended, so the terminal sees `npm install` / `vite dev` output
 * live instead of after `await`. `RunResult` still keeps the full blob for
 * callers that read it.
 *
 * `cwd`/`env` are mutable; only built-in `cd` can mutate cwd (via closure).
 * Custom commands see only a snapshot via the context.
 */

import { NotImplementedError } from '@riftydev/io';
import { isAbsolute, joinPath, normalizePath, syncMirror } from '@riftydev/vfs';
import { builtinCommands } from './builtins.ts';
import { tokenize } from './tokenize.ts';
import type { CommandContext, ShellCommand } from './types.ts';

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Stream identifier for `RunOptions.onChunk`. */
export type ChunkStream = 'stdout' | 'stderr';

/**
 * Per-call options for {@link Shell.run}.
 *
 * `onChunk` fires synchronously on each stdout/stderr write, BEFORE the chunk is
 * appended to the captured `RunResult` blob (order: callback -> capture). Keep it
 * fast. Optional and additive — omitting it preserves the blob-at-the-end contract.
 */
export interface RunOptions {
  readonly onChunk?: (chunk: string, stream: ChunkStream) => void;
  /**
   * Host-supplied cancellation (Ctrl+C / SIGINT). When it fires, `run` aborts
   * its internal per-run controller and resolves with exit `130` even if a
   * handler never returns on its own (a `vite`/`node http` dev server) — the
   * foreground complement to background `&`. Cooperative, not a hard kill: the
   * handler observes `ctx.signal` and winds down (ADR-0082).
   */
  readonly signal?: AbortSignal;
  /**
   * Whether the run's stdout sink is an interactive terminal. Propagated to
   * `ctx.isTTY` for non-redirected segments (a redirected/piped child always
   * gets a non-TTY context). Default `false` — the color-safe default (GNU
   * `--color=auto` emits no SGR when unsure).
   */
  readonly isTTY?: boolean;
  readonly cols?: number;
  readonly rows?: number;
}

type Joiner = '&&' | '||' | ';' | null;
interface Segment {
  readonly tokens: string[];
  readonly joiner: Joiner; // joiner FOLLOWING this segment; null on the last
}

const encoder = new TextEncoder();

/** Resolved by the abort race when the foreground run is cancelled. */
const ABORTED = Symbol('shell.aborted');

/** Exit code for a command interrupted by SIGINT (128 + SIGINT(2)). */
const SIGINT_EXIT = 130;

/**
 * A promise that resolves to {@link ABORTED} when `signal` fires, plus a
 * `cleanup` that detaches the listener so a settled run leaks nothing
 * (ADR-0082 §83). Resolves immediately when already aborted.
 */
function abortRace(signal: AbortSignal): {
  promise: Promise<typeof ABORTED>;
  cleanup: () => void;
} {
  let onAbort: (() => void) | null = null;
  const promise = new Promise<typeof ABORTED>((resolve) => {
    if (signal.aborted) {
      resolve(ABORTED);
      return;
    }
    onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    cleanup: () => {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    },
  };
}

export class Shell {
  private _cwd: string;
  private readonly env: Record<string, string>;
  private readonly commands: Map<string, ShellCommand> = new Map();

  constructor(options: ShellOptions = {}) {
    this._cwd = normalizePath(options.cwd ?? '/');
    this.env = { ...(options.env ?? {}) };
    const builtins = builtinCommands((p) => {
      this._cwd = p;
    });
    for (const [name, cmd] of Object.entries(builtins)) this.commands.set(name, cmd);
  }

  get cwd(): string {
    return this._cwd;
  }

  registerCommand(name: string, cmd: ShellCommand): void {
    this.commands.set(name, cmd);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Execute a single shell input line.
   *
   * @param line   the raw line as typed at the terminal
   * @param options per-call hooks (`onChunk` for live streaming — see {@link RunOptions})
   * @returns exit code of the last executed segment plus captured stdout/stderr
   */
  async run(line: string, options: RunOptions = {}): Promise<RunResult> {
    // Inline env overrides (`FOO=bar cmd $FOO`) apply to the command, NOT to
    // expansion on the same line — POSIX: `FOO=bar echo $FOO` prints the OUTER FOO.
    const tokens = tokenize(line, this.env);
    if (tokens.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

    // Reject bare `&` loudly; tokenizer emits it as a standalone token.
    if (tokens.includes('&')) {
      throw new NotImplementedError(
        'shell.background',
        'background execution with `&` is not supported — drop the `&` and run it foreground',
      );
    }

    const segments = splitOnJoiners(tokens);

    // Per-run cancellation (ADR-0082): the host signal forwards into an
    // internal controller whose `signal` each command observes via `ctx.signal`.
    // A SIGINT resolves `run` (exit 130) even if a handler never returns on its
    // own (a dev server) — cooperative, not a hard kill.
    const controller = new AbortController();
    const host = options.signal;
    const forwardAbort = () => controller.abort();
    if (host) {
      if (host.aborted) controller.abort();
      else host.addEventListener('abort', forwardAbort, { once: true });
    }
    const abort = abortRace(controller.signal);

    let stdout = '';
    let stderr = '';
    let lastExitCode = 0;
    let executedAny = false;

    try {
      for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx]!;

        // Short-circuit based on the PREVIOUS segment's joiner.
        if (idx > 0) {
          const prevJoiner = segments[idx - 1]!.joiner;
          if (prevJoiner === '&&' && lastExitCode !== 0) continue;
          if (prevJoiner === '||' && lastExitCode === 0) continue;
          // `;` or null: always run
        }

        const segResult = await this.runSegment(
          seg.tokens,
          options,
          controller.signal,
          abort.promise,
        );
        stdout += segResult.stdout;
        stderr += segResult.stderr;
        lastExitCode = segResult.exitCode;
        executedAny = true;
        // Ctrl+C aborts the whole line — stop the chain.
        if (controller.signal.aborted) break;
      }
    } finally {
      abort.cleanup();
      if (host) host.removeEventListener('abort', forwardAbort);
    }

    // Theoretically unreachable (empty token list handled above); explicit for clarity.
    if (!executedAny) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    return { exitCode: lastExitCode, stdout, stderr };
  }

  /**
   * Run a single segment (no joiner handling): env-prefix popping,
   * trailing-redirect extraction, command lookup and execution.
   */
  private async runSegment(
    segmentTokens: string[],
    options: RunOptions,
    signal: AbortSignal,
    abortPromise: Promise<typeof ABORTED>,
  ): Promise<RunResult> {
    if (segmentTokens.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

    if (segmentTokens.includes('<')) {
      throw new NotImplementedError(
        'shell.input-redirect',
        'use bash via wasi for < input redirect — M12 work item',
      );
    }

    if (segmentTokens.includes('|')) {
      throw new NotImplementedError(
        'shell.pipe',
        'pipe operator not yet supported — M12 work item',
      );
    }

    // Pop leading KEY=value env assignments.
    let i = 0;
    const overrides: Record<string, string> = {};
    while (i < segmentTokens.length) {
      const t = segmentTokens[i]!;
      const eq = t.indexOf('=');
      if (eq > 0 && /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.slice(0, eq))) {
        overrides[t.slice(0, eq)] = t.slice(eq + 1);
        i++;
      } else break;
    }
    const rest = segmentTokens.slice(i);
    if (rest.length === 0) {
      Object.assign(this.env, overrides);
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    // Pull off trailing `> path` / `>> path` redirection.
    let redirectTo: { path: string; append: boolean } | null = null;
    if (rest.length >= 2) {
      const op = rest[rest.length - 2];
      const target = rest[rest.length - 1];
      if ((op === '>' || op === '>>') && target && !target.startsWith('-')) {
        redirectTo = { path: target, append: op === '>>' };
        rest.splice(rest.length - 2, 2);
      }
    }

    const cmd = rest[0]!;
    const args = rest.slice(1);
    const handler = this.commands.get(cmd);

    let stdout = '';
    let stderr = '';
    const emit = (chunk: string, stream: ChunkStream): void => {
      // onChunk first so the terminal sees the chunk before it lands in the blob.
      // Fires even for redirected-stdout writes (diverted to a file later) — by
      // design, so semantics stay composable; the caller decides what to do.
      options.onChunk?.(chunk, stream);
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    const ctx: CommandContext = {
      cwd: this._cwd,
      env: { ...this.env, ...overrides },
      stdout: {
        write(c: string): void {
          emit(c, 'stdout');
        },
      },
      stderr: {
        write(c: string): void {
          emit(c, 'stderr');
        },
      },
      // A redirected (and future piped) sink is never a TTY (ADR-0082): force
      // isTTY false so `ls --color=auto > f` writes no SGR bytes into the file.
      isTTY: redirectTo ? false : (options.isTTY ?? false),
      cols: options.cols,
      rows: options.rows,
      signal,
    };

    if (!handler) {
      emit(`${cmd}: command not found\n`, 'stderr');
      return { exitCode: 127, stdout, stderr };
    }

    let exitCode = 0;
    try {
      const handlerPromise = handler(args, ctx);
      const raced = await Promise.race([handlerPromise, abortPromise]);
      if (raced === ABORTED) {
        // SIGINT won the race: resolve now (exit 130). The handler keeps
        // running until it honors ctx.signal — swallow its eventual settle so
        // a late rejection isn't an unhandled rejection (cooperative abort).
        void handlerPromise.then(undefined, () => {});
        exitCode = SIGINT_EXIT;
      } else {
        exitCode = raced;
      }
    } catch (err) {
      emit(`${(err as Error).stack ?? (err as Error).message}\n`, 'stderr');
      exitCode = 1;
    }

    // Don't flush a partial buffer to the redirect target on a SIGINT abort.
    if (redirectTo && stdout.length > 0 && exitCode !== SIGINT_EXIT) {
      try {
        const path = normalizePath(
          isAbsolute(redirectTo.path) ? redirectTo.path : joinPath(this._cwd, redirectTo.path),
        );
        const fs = syncMirror();
        if (redirectTo.append && fs.existsSync(path)) {
          const existing = fs.readFileBytesSync(path);
          const next = new Uint8Array(existing.length + stdout.length);
          next.set(existing, 0);
          next.set(encoder.encode(stdout), existing.length);
          fs.writeFileSync(path, next);
        } else {
          fs.writeFileSync(path, encoder.encode(stdout));
        }
        stdout = '';
      } catch (err) {
        // Loud failure: don't silently dump the redirected payload onto stdout
        // (callers expected a file). Exit 1 + EREDIRECT-tagged stderr so log
        // scanners can detect the failure unambiguously.
        emit(
          `${cmd}: redirect write failed: ${redirectTo.path}: ${(err as Error).message} [EREDIRECT]\n`,
          'stderr',
        );
        stdout = '';
        exitCode = 1;
      }
    }

    return { exitCode, stdout, stderr };
  }
}

/**
 * Split tokens on `&&`/`||`/`;` into segments; each carries the joiner that
 * FOLLOWS it (`null` on the last). A trailing joiner (`echo a ;`) yields a final
 * empty segment — harmless, the run-loop short-circuits on empty segments.
 */
function splitOnJoiners(tokens: string[]): Segment[] {
  const segments: Segment[] = [];
  let current: string[] = [];
  for (const t of tokens) {
    if (t === '&&' || t === '||' || t === ';') {
      segments.push({ tokens: current, joiner: t });
      current = [];
    } else {
      current.push(t);
    }
  }
  segments.push({ tokens: current, joiner: null });
  return segments;
}
