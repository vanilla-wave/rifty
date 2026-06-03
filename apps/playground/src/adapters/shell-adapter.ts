/**
 * Solid-side glue for `@riftydev/shell` (M10 Tier 0 wiring).
 *
 * The hook owns one long-lived `Shell` instance plus a writer slot. The
 * caller (typically `App.tsx`) provides the writer via `attachWriter(write)`
 * once the terminal is mounted; the hook then routes every shell chunk to
 * that writer in real time via `Shell.run`'s `onChunk` callback.
 *
 * The hook is intentionally framework-light: there are no Solid signals
 * inside this file — Solid state lives at the topmost glue point in
 * `App.tsx`, per the D-002 adapter discipline. The only Solid touch here is
 * `onCleanup` to register a no-op disposer so the hook fits the same shape
 * as `useRuntime.ts`. The shell itself has no resources to release beyond
 * dropping references.
 *
 * Why an adapter and not a top-level `'shell'` mode in `App.tsx`: App.tsx is
 * already a 292-line god-component juggling 5 signals and 3 modes (Tier 4
 * finding in the 2026-05-26 review). Adding a 4th branch there would harden
 * the very pattern Tier 4 wants extracted. The shell sits alongside the
 * runtime as a peer session driving the same terminal, not as a mutually-
 * exclusive mode.
 */

import { Shell, type ShellCommand, type ShellOptions } from '@riftydev/shell';
import { onCleanup } from 'solid-js';

type Writer = (chunk: string, stream?: 'stdout' | 'stderr') => void;

/**
 * Public surface of `useShellSession`. `runLine(input)` executes one shell
 * line; its stdout/stderr stream into the writer attached via
 * `attachWriter`. `cwd()` reflects the shell's current working directory
 * after each `runLine` (mainly for prompt rendering / debugging).
 *
 * `registerCommand(name, cmd)` lets composition-root glue (e.g.
 * `registerNpmShellCommand` in `glue/npm-shell-command.ts`) wire custom
 * builtins like `npm` / `node` without the adapter having to know about
 * them. Without this, typing `npm install foo` at the terminal would hit
 * the shell's "command not found" path with exit 127.
 */
export interface ShellSession {
  attachWriter(write: Writer): void;
  runLine(input: string): Promise<number>;
  registerCommand(name: string, cmd: ShellCommand): void;
  cwd(): string;
  dispose(): void;
}

/**
 * Create a long-lived shell session. The returned object can be stored in
 * Solid signals at the call site if reactive consumers need to observe
 * `cwd()` changes; the session itself does no reactive work.
 */
export function useShellSession(options: ShellOptions = {}): ShellSession {
  let writer: Writer | null = null;
  const shell = new Shell(options);

  // Symmetric with `useRuntime` — having a disposer keeps the lifecycle
  // contract uniform across adapters even though the shell holds no host
  // resources today.
  onCleanup(() => {
    writer = null;
  });

  return {
    attachWriter(w: Writer): void {
      writer = w;
    },
    async runLine(input: string): Promise<number> {
      // Empty input is a no-op so the prompt can be re-rendered without
      // touching the shell state machine.
      if (input.trim().length === 0) return 0;
      const result = await shell.run(input, {
        onChunk: (chunk, stream) => {
          writer?.(chunk, stream);
        },
      });
      return result.exitCode;
    },
    registerCommand(name: string, cmd: ShellCommand): void {
      shell.registerCommand(name, cmd);
    },
    cwd(): string {
      return shell.cwd;
    },
    dispose(): void {
      writer = null;
    },
  };
}
