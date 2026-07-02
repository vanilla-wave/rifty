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
import { resolveBin } from './bin-resolver.ts';
import { builtinCommands } from './builtins.ts';
import { hasGlobMeta, matchSegment } from './commands/_glob.ts';
import { resolve } from './commands/_shared.ts';
import type { ShellJobListItem } from './commands/jobs.ts';
import { type Token, isOp, tokenize } from './tokenize.ts';
import type { CommandContext, ShellCommand, StdinReader } from './types.ts';

/**
 * Runs a resolved `node_modules/.bin/<name>` launcher shim as a Node entry and
 * resolves its exit code (ADR-0137). Receives the absolute shim path, the
 * post-glob argv, and the command context (stdout/stderr/cwd/env/signal).
 */
export type BinExecutor = (binPath: string, args: string[], ctx: CommandContext) => Promise<number>;

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Injected by the host to run a resolved `.bin` shim (ADR-0137). Executing a
   * Node program needs a Worker realm the shell layer can't reach, so the
   * playground wires it; absent ⇒ a resolved shim reports exit 126 ("installed,
   * no Node runtime here") rather than the 127 of a genuine miss.
   */
  execBin?: BinExecutor;
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
   * handler observes `ctx.signal` and winds down (ADR-0089).
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
  readonly stdin?: CommandContext['stdin'];
}

type Joiner = '&&' | '||' | ';' | null;
interface Segment {
  readonly tokens: Token[];
  readonly joiner: Joiner; // joiner FOLLOWING this segment; null on the last
}

interface BackgroundJob {
  readonly id: number;
  readonly command: string;
  readonly tokens: readonly Token[];
  readonly controller: AbortController;
  status: ShellJobListItem['status'];
}

const encoder = new TextEncoder();

/** Resolved by the abort race when the foreground run is cancelled. */
const ABORTED = Symbol('shell.aborted');

/** Exit code for a command interrupted by SIGINT (128 + SIGINT(2)). */
const SIGINT_EXIT = 130;

/**
 * Known external tools whose names fuzzy-match a builtin (npx→npm, cut→cat,
 * sed→seq, tree→true, code→node, cls→ls, …). Suppressing the suggestion stops a
 * confidently-WRONG one-click `Run <builtin>` that would run an unrelated tool.
 */
const SUGGESTION_DENYLIST = new Set([
  'npx',
  'yarn',
  'pnpm',
  'bun',
  'sed',
  'awk',
  'cut',
  'tree',
  'code',
  'vim',
  'nano',
  'python',
  'cls',
  'curl',
  'wget',
]);

/** Package managers that get a directed npm nudge instead of `command not found`. */
const PACKAGE_MANAGERS = new Set(['npx', 'yarn', 'pnpm', 'bun']);

/** Directed nudge for a recognized package manager (rifty wires only npm). */
function packageManagerNudge(cmd: string): string | null {
  return PACKAGE_MANAGERS.has(cmd)
    ? `${cmd}: not available — rifty wires npm (try: npm install …)\n`
    : null;
}

function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[] = Array.from({ length: rows * cols }, () => 0);
  const at = (row: number, col: number): number => dist[row * cols + col] ?? 0;
  const set = (row: number, col: number, value: number): void => {
    dist[row * cols + col] = value;
  };

  for (let row = 0; row < rows; row++) set(row, 0, row);
  for (let col = 0; col < cols; col++) set(0, col, col);

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      let best = Math.min(at(row - 1, col) + 1, at(row, col - 1) + 1, at(row - 1, col - 1) + cost);
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        best = Math.min(best, at(row - 2, col - 2) + 1);
      }
      set(row, col, best);
    }
  }

  return at(a.length, b.length);
}

function suggestionThreshold(input: string): number {
  if (input.length <= 2) return 0;
  if (input.length <= 5) return 1;
  return 2;
}

/**
 * A promise that resolves to {@link ABORTED} when `signal` fires, plus a
 * `cleanup` that detaches the listener so a settled run leaks nothing
 * (ADR-0089 §83). Resolves immediately when already aborted.
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
  private readonly customCommands: Map<string, ShellCommand> = new Map();
  private readonly backgroundJobs: BackgroundJob[] = [];
  private backgroundSeq = 0;
  private readonly execBin?: BinExecutor;

  constructor(options: ShellOptions = {}) {
    this._cwd = normalizePath(options.cwd ?? '/');
    this.env = { ...(options.env ?? {}) };
    this.execBin = options.execBin;
    const builtins = builtinCommands(
      (p) => {
        this._cwd = p;
      },
      // Lazy presence probe: `which` reads this.commands at invocation time,
      // after every builtin + any registerCommand has populated the map.
      (n) => this.commands.has(n),
      () => this.listBackgroundJobs(),
      // `which` reports installed-CLI hits at the LIVE cwd (cd mutates it).
      (n) => resolveBin(this._cwd, n),
      // `help` lists the live registry (builtins + host-registered programs).
      () => this.commandNames(),
    );
    for (const [name, cmd] of Object.entries(builtins)) this.commands.set(name, cmd);
  }

  get cwd(): string {
    return this._cwd;
  }

  envSnapshot(): Record<string, string> {
    return { ...this.env };
  }

  registerCommand(name: string, cmd: ShellCommand): void {
    this.commands.set(name, cmd);
    this.customCommands.set(name, cmd);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  commandNames(): readonly string[] {
    return [...this.commands.keys()].sort();
  }

  dispose(): void {
    for (const job of this.backgroundJobs) {
      if (job.status === 'Running') job.controller.abort();
    }
  }

  private suggestCommand(cmd: string): string | null {
    // A known external tool fuzzy-matching a builtin is a wrong suggestion, not
    // a typo — never offer it (the harm is a confidently-wrong one-click action).
    if (SUGGESTION_DENYLIST.has(cmd)) return null;
    let best: { name: string; distance: number } | null = null;
    for (const name of this.commands.keys()) {
      const distance = damerauLevenshtein(cmd, name);
      if (
        best &&
        (distance > best.distance ||
          (distance === best.distance && name.length <= best.name.length))
      ) {
        continue;
      }
      best = { name, distance };
    }
    if (!best || best.distance > suggestionThreshold(cmd)) return null;
    return best.name;
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

    const background = this.trailingBackground(line, tokens);
    if (background) {
      if (background.foregroundTokens.length === 0) {
        return this.startBackgroundJob(background.line, background.backgroundTokens, options);
      }
      const foreground = await this.runTokens(background.foregroundTokens, options);
      if (
        (background.joiner === '&&' && foreground.exitCode !== 0) ||
        (background.joiner === '||' && foreground.exitCode === 0)
      ) {
        return foreground;
      }
      const started = await this.startBackgroundJob(
        background.line,
        background.backgroundTokens,
        options,
      );
      return {
        exitCode: started.exitCode,
        stdout: foreground.stdout + started.stdout,
        stderr: foreground.stderr + started.stderr,
      };
    }

    return this.runTokens(tokens, options);
  }

  private async runTokens(tokens: readonly Token[], options: RunOptions): Promise<RunResult> {
    // Reject non-trailing bare `&` loudly; tokenizer emits it as an operator token.
    if (tokens.some((t) => isOp(t) && t.op === '&')) {
      throw new NotImplementedError(
        'shell.background',
        'only trailing background execution (`cmd &`) is supported',
      );
    }

    const segments = splitOnJoiners(tokens);

    // Per-run cancellation (ADR-0089): the host signal forwards into an
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

        // An abort that landed BEFORE this segment (incl. a pre-aborted host
        // signal) cancels it outright — a cancelled command must not start.
        if (controller.signal.aborted) break;

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

    if (!executedAny) {
      // Nothing ran: either every segment was empty (trailing `;` tails — exit
      // 0) or the run was aborted before its first segment — SIGINT's 130,
      // matching a shell's kill-before-start.
      return { exitCode: controller.signal.aborted ? 130 : 0, stdout: '', stderr: '' };
    }

    return { exitCode: lastExitCode, stdout, stderr };
  }

  private trailingBackground(
    line: string,
    tokens: readonly Token[],
  ): {
    readonly line: string;
    readonly foregroundTokens: readonly Token[];
    readonly backgroundTokens: readonly Token[];
    readonly joiner: Exclude<Joiner, null> | null;
  } | null {
    const last = tokens[tokens.length - 1];
    if (!last || !isOp(last) || last.op !== '&') return null;
    const body = tokens.slice(0, -1);
    if (body.length === 0) {
      throw new NotImplementedError('shell.background', 'missing command before `&`');
    }
    const joinerIdx = findLastJoinerIndex(body);
    if (joinerIdx === -1) {
      return {
        line: stripTrailingAmp(line),
        foregroundTokens: [],
        backgroundTokens: body,
        joiner: null,
      };
    }
    const joiner = body[joinerIdx];
    if (!joiner || !isOp(joiner) || !isJoiner(joiner.op)) {
      throw new Error('shell.trailingBackground: invalid joiner index');
    }
    const backgroundTokens = body.slice(joinerIdx + 1);
    if (backgroundTokens.length === 0) {
      throw new NotImplementedError('shell.background', 'missing command before `&`');
    }
    return {
      line: tokensToShellLine(backgroundTokens),
      foregroundTokens: body.slice(0, joinerIdx + 1),
      backgroundTokens,
      joiner: joiner.op,
    };
  }

  private async startBackgroundJob(
    line: string,
    tokens: readonly Token[],
    options: RunOptions,
  ): Promise<RunResult> {
    for (const token of tokens) {
      if (!isOp(token)) continue;
      if (token.op === '&') {
        throw new NotImplementedError('shell.background', 'only one trailing `&` is supported');
      }
      if (token.op === '|') {
        throw new NotImplementedError(
          'shell.pipe',
          'pipes in a background job (`a | b &`) are not supported — run the pipeline in the foreground',
        );
      }
      if (token.op === '<') {
        throw new NotImplementedError(
          'shell.input-redirect',
          'input redirect in a background job (`cmd < file &`) is not supported — run it in the foreground',
        );
      }
    }

    const job: BackgroundJob = {
      id: ++this.backgroundSeq,
      command: line,
      tokens,
      controller: new AbortController(),
      status: 'Running',
    };
    this.backgroundJobs.push(job);
    const started = this.formatJob(job);
    options.onChunk?.(started, 'stdout');
    void this.runBackgroundJob(job, options);
    return { exitCode: 0, stdout: started, stderr: '' };
  }

  private async runBackgroundJob(job: BackgroundJob, options: RunOptions): Promise<void> {
    const shell = this.cloneForBackground();
    try {
      const result = await shell.runTokens(job.tokens, {
        onChunk: options.onChunk,
        signal: job.controller.signal,
        isTTY: options.isTTY,
        cols: options.cols,
        rows: options.rows,
      });
      job.status = result.exitCode === 0 ? 'Done' : `Exit ${result.exitCode}`;
    } catch (err) {
      job.status = 'Exit 1';
      options.onChunk?.(`${job.command}: ${(err as Error).message}\n`, 'stderr');
    } finally {
      options.onChunk?.(this.formatJob(job), 'stdout');
    }
  }

  private cloneForBackground(): Shell {
    const shell = new Shell({ cwd: this._cwd, env: this.env, execBin: this.execBin });
    for (const [name, command] of this.customCommands) shell.registerCommand(name, command);
    return shell;
  }

  private listBackgroundJobs(): readonly ShellJobListItem[] {
    return this.backgroundJobs.map((job) => ({
      id: job.id,
      command: job.command,
      status: job.status,
    }));
  }

  private formatJob(job: ShellJobListItem): string {
    return `[${job.id}] ${job.status} ${job.command}\n`;
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

    // Split into pipeline stages on `|`. One stage is the common path; a
    // multi-stage pipeline BUFFERS each stage's stdout into the next's stdin.
    const stages = splitOnPipe(segmentTokens);
    if (stages.length === 1) {
      return this.runSimpleCommand(stages[0]!, options.stdin, true, options, signal, abortPromise);
    }

    let pipeStdin = options.stdin;
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    for (let s = 0; s < stages.length; s++) {
      const isLast = s === stages.length - 1;
      // Only the final stage streams stdout to the terminal; every stage's
      // stderr passes through (bash does not pipe stderr). Pipeline exit = the
      // last stage's exit (POSIX; no pipefail).
      const res = await this.runSimpleCommand(
        stages[s]!,
        pipeStdin,
        isLast,
        options,
        signal,
        abortPromise,
      );
      stderr += res.stderr;
      exitCode = res.exitCode;
      if (signal.aborted) break; // SIGINT cancels the whole pipeline
      if (isLast) stdout = res.stdout;
      else pipeStdin = bufferStdin(encoder.encode(res.stdout));
    }
    return { exitCode, stdout, stderr };
  }

  /**
   * Run one simple command (a single pipeline stage): env-prefix popping,
   * `< file` input redirect + trailing `>`/`>>` output redirect extraction,
   * command lookup and execution. `stdin` feeds `ctx.stdin` (a `< file` overrides
   * it); `streamStdout` gates whether stdout chunks reach `onChunk` — false for a
   * non-final pipe stage, whose stdout is captured for the next stage.
   */
  private async runSimpleCommand(
    segmentTokens: Token[],
    stdin: StdinReader | undefined,
    streamStdout: boolean,
    options: RunOptions,
    signal: AbortSignal,
    abortPromise: Promise<typeof ABORTED>,
  ): Promise<RunResult> {
    if (segmentTokens.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

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

    // Symmetric `< path` input redirect: same right-to-left scan, rightmost wins.
    // Reads the file as the stage's stdin (overriding any inherited pipe stdin).
    let redirectFrom: string | null = null;
    for (let k = rest.length - 1; k >= 0; k--) {
      const op = rest[k];
      if (!op || !isOp(op) || op.op !== '<') continue;
      const target = rest[k + 1];
      if (!target || isOp(target)) continue; // dangling `<` with no target — leave as-is
      if (redirectFrom === null) redirectFrom = target.value;
      rest.splice(k, 2);
    }

    const cmdTok = rest[0];
    const cmd = cmdTok && !isOp(cmdTok) ? cmdTok.value : '';
    // Command-name token (rest[0]) stays literal; only ARGUMENTS glob-expand.
    const args = this.expandArgs(rest.slice(1));
    // Resolution order (ADR-0137): registered (builtins + registerCommand) →
    // walk-up `node_modules/.bin/<name>` → miss.
    let handler = this.commands.get(cmd);

    let stdout = '';
    let stderr = '';
    const emit = (chunk: string, stream: ChunkStream): void => {
      // onChunk first so the terminal sees the chunk before it lands in the blob.
      // Fires even for redirected-stdout writes (diverted to a file later) — by
      // design, so semantics stay composable. A non-final pipe stage
      // (streamStdout=false) captures stdout SILENTLY — it feeds the next stage,
      // not the terminal; stderr always streams (bash never pipes stderr).
      if (stream === 'stderr' || streamStdout) options.onChunk?.(chunk, stream);
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    };

    // `< file` reads the file as stdin (overrides inherited pipe stdin). A miss
    // is a clean exit-1 diagnostic and the command does NOT run (bash).
    let stageStdin = stdin;
    if (redirectFrom !== null) {
      try {
        const inPath = normalizePath(
          isAbsolute(redirectFrom) ? redirectFrom : joinPath(this._cwd, redirectFrom),
        );
        stageStdin = bufferStdin(syncMirror().readFileBytesSync(inPath));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const reason = code === 'EISDIR' ? 'Is a directory' : 'No such file or directory';
        emit(`${cmd}: ${redirectFrom}: ${reason}\n`, 'stderr');
        return { exitCode: 1, stdout, stderr };
      }
    }

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
      // A redirected OR non-final-pipe sink is never a TTY (ADR-0089): force
      // isTTY false so `ls --color=auto > f` / `ls | cat` write no SGR bytes.
      isTTY: redirectTo || !streamStdout ? false : (options.isTTY ?? false),
      cols: options.cols,
      rows: options.rows,
      stdin: stageStdin,
      signal,
    };

    if (!handler) {
      const binPath = resolveBin(this._cwd, cmd);
      if (binPath === null) {
        // A recognized package manager → a directed npm nudge INSTEAD of the
        // generic miss + a wrong `Did you mean 'npm'?`.
        const nudge = packageManagerNudge(cmd);
        if (nudge) {
          emit(nudge, 'stderr');
          return { exitCode: 127, stdout, stderr };
        }
        emit(`${cmd}: command not found\n`, 'stderr');
        const suggestion = this.suggestCommand(cmd);
        if (suggestion) emit(`Did you mean '${suggestion}'?\n`, 'stderr');
        return { exitCode: 127, stdout, stderr };
      }
      if (!this.execBin) {
        // Shim present but no Node executor wired — installed, not runnable
        // here. Exit 126 ("command found, cannot execute"), never a silent
        // stub or a misleading 127 miss.
        emit(`${cmd}: cannot execute ${binPath}: no Node executor configured\n`, 'stderr');
        return { exitCode: 126, stdout, stderr };
      }
      // Run the resolved shim through the normal handler path so it inherits
      // SIGINT abort-race and `>` redirect flush for free.
      const execBin = this.execBin;
      handler = (a, c) => execBin(binPath, a, c);
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
   * (ADR-0091 part 2). Operators pass through as their literal `op`. A quoted
   * word is NEVER expanded (whole-word quote flag — a documented ADR-0091
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
function splitOnJoiners(tokens: readonly Token[]): Segment[] {
  const segments: Segment[] = [];
  let current: Token[] = [];
  for (const t of tokens) {
    if (isOp(t) && isJoiner(t.op)) {
      segments.push({ tokens: current, joiner: t.op });
      current = [];
    } else {
      current.push(t);
    }
  }
  segments.push({ tokens: current, joiner: null });
  return segments;
}

/** Split a segment's tokens on `|` into pipeline stages (each a `Token[]`). */
function splitOnPipe(tokens: readonly Token[]): Token[][] {
  const stages: Token[][] = [];
  let current: Token[] = [];
  for (const t of tokens) {
    if (isOp(t) && t.op === '|') {
      stages.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  stages.push(current);
  return stages;
}

/**
 * One-shot {@link StdinReader} over `bytes`: yields the buffer once, then EOF
 * (`null`); empty input reads EOF immediately. This is the buffered pipe
 * hand-off — a stage's captured stdout becomes the next stage's stdin.
 */
function bufferStdin(bytes: Uint8Array): StdinReader {
  let done = false;
  return {
    read(): Promise<Uint8Array | null> {
      if (done) return Promise.resolve(null);
      done = true;
      return Promise.resolve(bytes.length > 0 ? bytes : null);
    },
  };
}

function isJoiner(op: string): op is Exclude<Joiner, null> {
  return op === '&&' || op === '||' || op === ';';
}

function findLastJoinerIndex(tokens: readonly Token[]): number {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token && isOp(token) && isJoiner(token.op)) return i;
  }
  return -1;
}

function tokensToShellLine(tokens: readonly Token[]): string {
  return tokens.map((token) => (isOp(token) ? token.op : quoteShellWord(token.value))).join(' ');
}

function quoteShellWord(value: string): string {
  if (value.length > 0 && !/[\s'"\\;&|<>]/u.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function stripTrailingAmp(line: string): string {
  let end = line.length;
  while (end > 0 && /\s/u.test(line[end - 1] ?? '')) end--;
  if (line[end - 1] !== '&') return line.trimEnd();
  return line.slice(0, end - 1).trimEnd();
}
