/**
 * Owner in-realm `BinExecutor` (ADR-0146 owner-resident shell, S1).
 *
 * The persistent workspace owner runs a shell-resolved
 * `node_modules/.bin/<name>` launcher shim IN ITS OWN REALM via `runNodeEntry`
 * — NOT by spawning a per-bin Worker (the superseded page-side executor did
 * that, ADR-0137). Because the owner already holds the installed `node_modules`
 * tree in its `syncMirror()`, the bin's relative `import`/`require` resolve
 * against a real tree (the gap ADR-0143 closed by moving npm + bin to the owner).
 *
 * Streaming: a bin program writes through the realm's global `process.stdout` /
 * `process.stderr` / `console` (Node parity — `console.log` IS stdout). We
 * redirect those writers into the command context for the run (so the pty
 * server forwards them as `pty:chunk`), set Node-shape `argv`/`env`/`cwd`, run
 * to completion, then RESTORE the realm stdio (runs are serial — the shell
 * awaits each `run` — so no nesting). A throw becomes a clean `ctx.stderr` line
 * + exit 1; an already-aborted `ctx.signal` short-circuits to exit 130, never a
 * silent 0.
 *
 * `getVfs`/`getProcess` are injected so the unit test drives a fixture
 * `MemoryFsSync` + the real `globalThis.process` without a Worker; production
 * wires the owner's `syncMirror()` and realm process.
 */

import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import type { BinExecutor, CommandContext, Writer } from '@riftydev/shell';
import { type FsSync, syncMirror } from '@riftydev/vfs';

// TODO(backlog: shell/d-owner-worker-milestone) Delete zero-caller P2 owner after
// app-build reachability gate; ADR-0150 child executor owns production.

/** Exit code for an interrupted run (128 + SIGINT(2)) — matches the shell. */
const SIGINT_EXIT = 130;

/** Subset of the realm `process` the executor reads + redirects. */
export interface OwnerProcessStdio {
  stdout: Writer;
  stderr: Writer;
  argv?: string[];
  env?: Record<string, string | undefined>;
}

export interface OwnerBinExecutorDeps {
  /** The owner's installed tree; defaults to the realm sync mirror. */
  readonly getVfs?: () => FsSync;
  /** The realm process to redirect; defaults to `globalThis.process`. */
  readonly getProcess?: () => OwnerProcessStdio;
  /** Runner seam (tests inject); defaults to the in-realm `runNodeEntry`. */
  readonly runEntry?: typeof runNodeEntry;
}

interface GlobalConsoleHolder {
  console: unknown;
}

/** Build the owner {@link BinExecutor}. */
export function createOwnerBinExecutor(deps: OwnerBinExecutorDeps = {}): BinExecutor {
  const getVfs = deps.getVfs ?? syncMirror;
  const getProcess = deps.getProcess ?? (() => globalThis.process as unknown as OwnerProcessStdio);
  const runEntry = deps.runEntry ?? runNodeEntry;

  return async (binPath: string, args: string[], ctx: CommandContext): Promise<number> => {
    // Already cancelled before we start: don't run the bin, report 130.
    if (ctx.signal?.aborted) return SIGINT_EXIT;

    const proc = getProcess();
    // Patch the WRITE functions (not the stdout/stderr objects): on some realms
    // `process.stdout` is a getter-only accessor, but `.write` is assignable —
    // and `.write` is exactly what a bin program calls.
    const savedStdoutWrite = proc.stdout.write;
    const savedStderrWrite = proc.stderr.write;
    const savedArgv = proc.argv;
    const savedEnv = proc.env;
    const consoleHolder = globalThis as unknown as GlobalConsoleHolder;
    const savedConsole = consoleHolder.console;

    // Redirect the realm stdio into the command context for the run. console
    // routes through process.stdout/stderr in Node, so a fresh Console over the
    // redirected writers carries console.log output into the terminal too.
    proc.stdout.write = (chunk: string) => ctx.stdout.write(chunk);
    proc.stderr.write = (chunk: string) => ctx.stderr.write(chunk);
    proc.argv = ['node', binPath, ...args];
    proc.env = { ...ctx.env };
    consoleHolder.console = makeConsole(ctx);

    try {
      await runEntry({
        vfs: getVfs(),
        entryPath: binPath,
        cwd: ctx.cwd,
        bin: isBinShim(binPath),
      });
      return 0;
    } catch (err) {
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    } finally {
      proc.stdout.write = savedStdoutWrite;
      proc.stderr.write = savedStderrWrite;
      proc.argv = savedArgv;
      proc.env = savedEnv;
      consoleHolder.console = savedConsole;
    }
  };
}

/** A resolved shell command path is a `.bin` launcher only under `node_modules/.bin/`. */
function isBinShim(path: string): boolean {
  return path.includes('/node_modules/.bin/');
}

/**
 * Minimal `console` over the redirected context writers. Mirrors Node: `log`/
 * `info`/`debug` → stdout, `warn`/`error` → stderr, each line newline-terminated.
 * A bin that imports `node:console` gets the kernel `Console` via the loader;
 * this only covers the realm GLOBAL `console.*` calls during the run.
 */
function makeConsole(ctx: CommandContext): Console {
  const fmt = (args: unknown[]): string => `${args.map(stringifyArg).join(' ')}\n`;
  const out = (...args: unknown[]): void => ctx.stdout.write(fmt(args));
  const err = (...args: unknown[]): void => ctx.stderr.write(fmt(args));
  return { log: out, info: out, debug: out, warn: err, error: err } as unknown as Console;
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}
