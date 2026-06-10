/**
 * Solid-side glue for `@riftydev/shell` (M10 Tier 0 wiring).
 *
 * No Solid signals here — Solid state lives at the topmost glue point in
 * `App.tsx`, per the D-002 adapter discipline. The only Solid touch is
 * `onCleanup`, registering a no-op disposer for shape-parity with
 * `useRuntime.ts`.
 *
 * Why an adapter and not a top-level `'shell'` mode in `App.tsx`: App.tsx is
 * already a 292-line god-component (Tier 4 finding, 2026-05-26 review); a 4th
 * mode branch would harden the very pattern Tier 4 wants extracted. The shell
 * sits alongside the runtime as a peer session driving the same terminal, not
 * as a mutually-exclusive mode.
 */

import { Shell, type ShellCommand, type ShellOptions } from '@riftydev/shell';
import type { TerminalRawInput } from '@riftydev/terminal';
import { onCleanup } from 'solid-js';

type Writer = (chunk: string, stream?: 'stdout' | 'stderr') => void;

/**
 * Terminal context for a run: it's an interactive TTY, with its live width/
 * height. Forwarded into `ctx.isTTY`/`ctx.cols`/`ctx.rows` so `ls` column
 * layout + `--color=auto` SGR actually engage in the real terminal (they were
 * dead before — the adapter never forwarded these).
 */
export interface RunContext {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Public surface of `useShellSession`. `runLine` executes one shell line,
 * streaming stdout/stderr into the writer attached via `attachWriter`.
 *
 * `registerCommand` lets composition-root glue (e.g. `registerNpmShellCommand`
 * in `glue/npm-shell-command.ts`) wire custom builtins like `npm` / `node`
 * without the adapter knowing about them — otherwise `npm install foo` hits
 * the shell's "command not found" path with exit 127.
 *
 * `interrupt()` aborts the in-flight run (Ctrl+C / SIGINT). The terminal's
 * `onSignal` is wired to it so a running `sleep` / dev server winds down and
 * `run` resolves exit 130 (ADR-0089) — previously unreachable from the app.
 */
export interface ShellSession {
  attachWriter(write: Writer): void;
  runLine(input: string, term?: RunContext): Promise<number>;
  writeStdin(data: TerminalRawInput): void;
  interrupt(): void;
  registerCommand(name: string, cmd: ShellCommand): void;
  commandNames(): readonly string[];
  cwd(): string;
  env(): Record<string, string>;
  dispose(): void;
}

/**
 * Create a long-lived shell session. The session does no reactive work; the
 * call site may store it in a Solid signal to observe `cwd()` changes.
 */
export function useShellSession(options: ShellOptions = {}): ShellSession {
  let writer: Writer | null = null;
  // AbortController for the in-flight run; `interrupt()` aborts it (Ctrl+C).
  let active: AbortController | null = null;
  let activeStdin: StdinQueue | null = null;
  const shell = new Shell(options);

  // Disposer for lifecycle parity with `useRuntime`; the shell holds no host
  // resources today.
  onCleanup(() => {
    writer = null;
    active?.abort();
    activeStdin?.close();
    active = null;
    activeStdin = null;
    shell.dispose();
  });

  return {
    attachWriter(w: Writer): void {
      writer = w;
    },
    async runLine(input: string, term?: RunContext): Promise<number> {
      // No-op on empty input: re-render the prompt without touching shell state.
      if (input.trim().length === 0) return 0;
      const controller = new AbortController();
      const stdin = new StdinQueue();
      active = controller;
      activeStdin = stdin;
      try {
        const result = await shell.run(input, {
          onChunk: (chunk, stream) => {
            writer?.(chunk, stream);
          },
          signal: controller.signal,
          // The playground terminal is always an interactive TTY — engage column
          // layout + colour. Width/height come from xterm; fall back to 80x24.
          isTTY: true,
          cols: term?.cols,
          rows: term?.rows,
          stdin,
        });
        return result.exitCode;
      } finally {
        if (active === controller) active = null;
        if (activeStdin === stdin) activeStdin = null;
        stdin.close();
      }
    },
    writeStdin(data: TerminalRawInput): void {
      activeStdin?.write(data);
    },
    interrupt(): void {
      active?.abort();
    },
    registerCommand(name: string, cmd: ShellCommand): void {
      shell.registerCommand(name, cmd);
    },
    commandNames(): readonly string[] {
      return shell.commandNames();
    },
    cwd(): string {
      return shell.cwd;
    },
    env(): Record<string, string> {
      return shell.envSnapshot();
    },
    dispose(): void {
      writer = null;
      active?.abort();
      activeStdin?.close();
      active = null;
      activeStdin = null;
      shell.dispose();
    },
  };
}

class StdinQueue {
  private readonly enc = new TextEncoder();
  private readonly chunks: Uint8Array[] = [];
  private readonly readers: Array<(chunk: Uint8Array | null) => void> = [];
  private closed = false;

  write(data: TerminalRawInput): void {
    if (this.closed) return;
    const chunk = typeof data === 'string' ? this.enc.encode(data) : data;
    const reader = this.readers.shift();
    if (reader) {
      reader(chunk);
      return;
    }
    this.chunks.push(chunk);
  }

  async read(): Promise<Uint8Array | null> {
    const chunk = this.chunks.shift();
    if (chunk) return chunk;
    if (this.closed) return null;
    return new Promise((resolve) => {
      this.readers.push(resolve);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const reader of this.readers.splice(0)) reader(null);
  }
}
