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
import { hasGlobMeta, matchSegment } from './commands/_glob.ts';
import { resolve } from './commands/_shared.ts';
import { type Token, isOp, tokenize } from './tokenize.ts';
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
  readonly tokens: Token[];
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
    const builtins = builtinCommands(
      (p) => {
        this._cwd = p;
      },
      // Lazy presence probe: `which` reads this.commands at invocation time,
      // after every builtin + any registerCommand has populated the map.
      (n) => this.commands.has(n),
    );
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

    // Reject bare `&` loudly; tokenizer emits it as a standalone operator token.
    if (tokens.some((t) => isOp(t) && t.op === '&')) {
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

        // An empty segment (e.g. the tail of a trailing `;` or `echo a ;`) is a
        // no-op: skip it entirely so it cannot overwrite lastExitCode with 0
        // (`false ;` must stay exit 1).
        if (seg.tokens.length === 0) continue;

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
    segmentTokens: Token[],
    options: RunOptions,
    signal: AbortSignal,
    abortPromise: Promise<typeof ABORTED>,
  ): Promise<RunResult> {
    if (segmentTokens.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

    if (segmentTokens.some((t) => isOp(t) && t.op === '<')) {
      throw new NotImplementedError(
        'shell.input-redirect',
        'use bash via wasi for < input redirect — M12 work item',
      );
    }

    if (segmentTokens.some((t) => isOp(t) && t.op === '|')) {
      throw new NotImplementedError(
        'shell.pipe',
        'pipe operator not yet supported — M12 work item',
      );
    }

    // Pop leading KEY=value env assignments (an operator ends the run).
    let i = 0;
    const overrides: Record<string, string> = {};
    while (i < segmentTokens.length) {
      const t = segmentTokens[i]!;
      if (isOp(t)) break;
      const v = t.value;
      const eq = v.indexOf('=');
      if (eq > 0 && /^[A-Za-z_][A-Za-z_0-9]*$/.test(v.slice(0, eq))) {
        overrides[v.slice(0, eq)] = v.slice(eq + 1);
        i++;
      } else break;
    }
    const rest = segmentTokens.slice(i);
    if (rest.length === 0) {
      Object.assign(this.env, overrides);
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    // Pull off `> path` / `>> path` redirection. bash removes redirections from
    // ANYWHERE in a simple command, not just the tail — scan right-to-left so the
    // RIGHTMOST target wins (last redirect for the fd) and every `>`/`>>`+word
    // pair leaves the argv (otherwise the op leaks as a literal argument, e.g.
    // `echo hi > out extra`). A target may start with `-` — after `>` it is a
    // filename, never a flag.
    let redirectTo: { path: string; append: boolean } | null = null;
    for (let k = rest.length - 1; k >= 0; k--) {
      const op = rest[k];
      if (!op || !isOp(op) || (op.op !== '>' && op.op !== '>>')) continue;
      const target = rest[k + 1];
      if (!target || isOp(target)) continue; // dangling `>` with no target — leave as-is
      if (!redirectTo) redirectTo = { path: target.value, append: op.op === '>>' };
      rest.splice(k, 2);
    }

    const cmdTok = rest[0];
    const cmd = cmdTok && !isOp(cmdTok) ? cmdTok.value : '';
    // Command-name token (rest[0]) stays literal; only ARGUMENTS glob-expand.
    const args = this.expandArgs(rest.slice(1));
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
      // Clean shell diagnostic — never dump a JS stack trace to the terminal.
      // Commands throw NotImplementedError for unsupported flags/features; its
      // message ("Not implemented: shell.X.flag (…)") is the right altitude.
      emit(`${cmd}: ${(err as Error).message}\n`, 'stderr');
      exitCode = 1;
    }

    // Flush to the redirect target. Truncate/create even when the command wrote
    // nothing — bash opens `> f` before running, so `grep nomatch x > f` empties
    // f. Skip only on a SIGINT abort: don't persist a partial buffer.
    if (redirectTo && exitCode !== SIGINT_EXIT) {
      try {
        const path = normalizePath(
          isAbsolute(redirectTo.path) ? redirectTo.path : joinPath(this._cwd, redirectTo.path),
        );
        const fs = syncMirror();
        const payload = encoder.encode(stdout);
        if (redirectTo.append && fs.existsSync(path)) {
          // Size by ENCODED byte length, not stdout.length (UTF-16 code units):
          // multibyte stdout would otherwise under-allocate → set() RangeError.
          const existing = fs.readFileBytesSync(path);
          const next = new Uint8Array(existing.length + payload.length);
          next.set(existing, 0);
          next.set(payload, existing.length);
          fs.writeFileSync(path, next);
        } else {
          fs.writeFileSync(path, payload);
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

  /**
   * Map argument tokens to argv strings, glob-expanding unquoted word tokens
   * (ADR-0084 part 2). Operators pass through as their literal `op`. A quoted
   * word is NEVER expanded (whole-word quote flag — a documented ADR-0084
   * limitation). An unquoted word with no glob meta passes literally.
   */
  private expandArgs(tokens: Token[]): string[] {
    const out: string[] = [];
    for (const t of tokens) {
      if (isOp(t)) {
        out.push(t.op);
      } else if (t.quoted) {
        out.push(t.value); // quoted word never globs (a quoted '' is KEPT)
      } else if (t.value === '') {
        // An unquoted word that expanded to nothing (`$UNSET`) produces NO word
        // at all (bash word-splitting). Critically stops `rm -rf $UNSET` from
        // collapsing to an empty path that resolves to cwd.
      } else if (!hasGlobMeta(t.value)) {
        out.push(t.value);
      } else {
        out.push(...this.expandGlob(t.value));
      }
    }
    return out;
  }

  /**
   * Single-segment glob expansion of one unquoted word. Splits at the LAST `/`:
   * the prefix resolves the search dir (against `_cwd`), the final segment is
   * the matched pattern. Dotfiles match only when the pattern leads with `.`
   * (bash). Zero matches or a readdir error → the ORIGINAL word verbatim (bash
   * nullglob-off). Multi-segment globbing (glob in a non-final segment) is out
   * of scope. Returns names mapped back through the original prefix, byte-sorted.
   */
  private expandGlob(word: string): string[] {
    const slash = word.lastIndexOf('/');
    const prefix = slash === -1 ? '' : word.slice(0, slash);
    const seg = slash === -1 ? word : word.slice(slash + 1);
    const dir = resolve(this._cwd, prefix === '' ? '.' : prefix);
    const includeDot = seg.startsWith('.');

    let entries: readonly { name: string }[];
    try {
      entries = syncMirror().readdirSync(dir);
    } catch {
      return [word]; // unreadable dir → literal (nullglob-off)
    }

    const matches: string[] = [];
    for (const entry of entries) {
      if (!includeDot && entry.name.startsWith('.')) continue;
      if (matchSegment(seg, entry.name)) {
        matches.push(prefix === '' ? entry.name : `${prefix}/${entry.name}`);
      }
    }
    if (matches.length === 0) return [word]; // no match → literal
    matches.sort(); // byte (lexicographic) order
    return matches;
  }
}

/**
 * Split tokens on `&&`/`||`/`;` into segments; each carries the joiner that
 * FOLLOWS it (`null` on the last). A trailing joiner (`echo a ;`) yields a final
 * empty segment — the run-loop SKIPS empty segments so they neither run nor
 * reset the exit code.
 */
function splitOnJoiners(tokens: Token[]): Segment[] {
  const segments: Segment[] = [];
  let current: Token[] = [];
  for (const t of tokens) {
    if (isOp(t) && (t.op === '&&' || t.op === '||' || t.op === ';')) {
      segments.push({ tokens: current, joiner: t.op });
      current = [];
    } else {
      current.push(t);
    }
  }
  segments.push({ tokens: current, joiner: null });
  return segments;
}
