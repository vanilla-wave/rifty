/**
 * Public types for the shell.
 *
 * `ShellCommand` is the contract for both built-ins and user-registered
 * commands. The context is built per-invocation by the shell.
 */

export interface Writer {
  write(chunk: string): void;
}

export interface CommandContext {
  cwd: string;
  env: Record<string, string>;
  stdout: Writer;
  stderr: Writer;
}

export type ShellCommand = (args: string[], ctx: CommandContext) => Promise<number>;
