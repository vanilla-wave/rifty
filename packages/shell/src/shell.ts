/**
 * `Shell` — minimal command dispatcher.
 *
 * Steps for `run(line, options?)`:
 *   1. Tokenize the whole line (see `tokenize.ts`).
 *   2. Split on `&&` / `||` / `;` joiners — quoted instances stay literal
 *      because the tokenizer only emits joiner tokens outside quotes.
 *   3. For each segment in order, evaluate per joiner semantics:
 *        - `&&` runs next iff previous exit === 0
 *        - `||` runs next iff previous exit !== 0
 *        - `;`  always runs next
 *      The final exit code is the exit of the LAST executed segment (POSIX).
 *   4. Each segment goes through `runSegment` which:
 *        - rejects unsupported redirects (`<` -> `NotImplementedError`)
 *        - rejects pipes (`|`) loudly
 *        - rejects bare `&` (background) loudly
 *        - pops env assignments off the front
 *        - extracts a trailing `> path` / `>> path` redirection
 *        - dispatches to the command registry (exit 127 if not found)
 *
 * Streaming: when `options.onChunk` is supplied, every `ctx.stdout.write` /
 * `ctx.stderr.write` call from a command (including builtins) invokes the
 * callback synchronously _before_ the captured run-blob is appended. This
 * lets the terminal see `npm install` progress bars and `vite dev` request
 * logs in real time instead of receiving the entire blob after `await`.
 *
 * The returned `RunResult.stdout` / `RunResult.stderr` keep the full
 * captured payload so existing callers that read the blob continue to work.
 *
 * The shell holds a mutable `cwd` and `env`; commands can mutate cwd through
 * the closure passed to built-in `cd`. Custom commands cannot — they only see
 * a snapshot via the context.
 */

import { NotImplementedError } from '@rifty/io';
import { isAbsolute, joinPath, normalizePath, syncMirror } from '@rifty/vfs';
import { builtinCommands } from './builtins.ts';
import { tokenize } from './tokenize.ts';
import type { ShellCommand } from './types.ts';

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Stream identifier for `RunOptions.onChunk`. Mirrors the union the
 * terminal/runtime layers use elsewhere in the playground.
 */
export type ChunkStream = 'stdout' | 'stderr';

/**
 * Per-call options for {@link Shell.run}.
 *
 * `onChunk` is called synchronously whenever a command writes to stdout or
 * stderr. The callback fires BEFORE the chunk is appended to the captured
 * `RunResult` blob, so order is: callback -> capture. Implementations should
 * keep the callback fast (a single `terminal.write(chunk, stream)` is the
 * intended use).
 *
 * `onChunk` is optional and additive — calling `run(line)` without options
 * preserves the original "return the blob at the end" contract.
 */
export interface RunOptions {
  readonly onChunk?: (chunk: string, stream: ChunkStream) => void;
}

type Joiner = '&&' | '||' | ';' | null;
interface Segment {
  readonly tokens: string[];
  readonly joiner: Joiner; // joiner that FOLLOWS this segment; null on the last one
}

const encoder = new TextEncoder();

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
   * @param options optional per-call hooks (currently: `onChunk` for live
   *               stdout/stderr streaming — see {@link RunOptions})
   * @returns final `RunResult` containing the exit code of the last executed
   *          segment and the captured stdout/stderr across the whole chain
   */
  async run(line: string, options: RunOptions = {}): Promise<RunResult> {
    // Tokenise with the shell's current env so `$VAR` expands. Inline env
    // overrides (e.g. `FOO=bar cmd $FOO`) follow bash semantics: the override
    // applies to the command being run, NOT to expansion in the same line.
    // That matches POSIX (`FOO=bar echo $FOO` prints the OUTER FOO).
    const tokens = tokenize(line, this.env);
    if (tokens.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

    // Background `&` is not supported. The tokenizer emits a bare `&` token so
    // we can reject it loudly instead of accidentally treating it as part of
    // the previous arg.
    if (tokens.includes('&')) {
      throw new NotImplementedError(
        'shell.background',
        'background execution with `&` is not supported — drop the `&` and run it foreground',
      );
    }

    const segments = splitOnJoiners(tokens);

    let stdout = '';
    let stderr = '';
    let lastExitCode = 0;
    let executedAny = false;

    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx]!;

      // Decide if this segment should run, based on the joiner attached to
      // the PREVIOUS segment.
      if (idx > 0) {
        const prevJoiner = segments[idx - 1]!.joiner;
        if (prevJoiner === '&&' && lastExitCode !== 0) continue;
        if (prevJoiner === '||' && lastExitCode === 0) continue;
        // `;` or null: always run
      }

      const segResult = await this.runSegment(seg.tokens, options);
      stdout += segResult.stdout;
      stderr += segResult.stderr;
      lastExitCode = segResult.exitCode;
      executedAny = true;
    }

    // If nothing ever ran (e.g. all segments were skipped by `&&` chains
    // after an early failure), the final exit code is the last failure.
    if (!executedAny) {
      // Empty token list path already handled above; this is theoretically
      // unreachable, but be explicit so the contract stays clear.
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    return { exitCode: lastExitCode, stdout, stderr };
  }

  /**
   * Run a single segment (no joiner handling). Implements env-prefix popping,
   * trailing-redirect extraction, command lookup and execution. The `options`
   * carry the optional `onChunk` callback for live streaming.
   */
  private async runSegment(segmentTokens: string[], options: RunOptions): Promise<RunResult> {
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

    // Pop env assignments (KEY=value) off the front.
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

    // Pull off trailing redirection: `... > path` or `... >> path`.
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
      // onChunk first so the terminal sees the chunk synchronously _before_
      // it lands in the captured blob. If the chunk is destined for a file
      // (redirect path below), it will be diverted later; the stream callback
      // still fires for stdout writes by design — the caller decides what to
      // do with the redirected-stdout chunks (a terminal would typically
      // ignore them when the segment ends up redirected, but exposing them
      // keeps semantics composable).
      options.onChunk?.(chunk, stream);
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    const ctx = {
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
    };

    if (!handler) {
      emit(`${cmd}: command not found\n`, 'stderr');
      return { exitCode: 127, stdout, stderr };
    }

    let exitCode = 0;
    try {
      exitCode = await handler(args, ctx);
    } catch (err) {
      emit(`${(err as Error).stack ?? (err as Error).message}\n`, 'stderr');
      exitCode = 1;
    }

    if (redirectTo && stdout.length > 0) {
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
        // Loud failure: do NOT silently drop the redirected payload onto
        // stdout (callers expected it in a file). Surface as exit code 1
        // with an EREDIRECT-tagged stderr line so a caller scanning logs
        // can detect "redirect write failed" unambiguously.
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
 * Split a token list on `&&` / `||` / `;` joiner tokens into segments. Each
 * segment carries the joiner that FOLLOWS it (or `null` for the final
 * segment). A trailing joiner (e.g. `echo a ;`) yields a final empty segment
 * with `joiner: null`; the run-loop short-circuits on empty segments so this
 * stays harmless.
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
