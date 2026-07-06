/**
 * Public types for the shell.
 *
 * `ShellCommand` is the contract for both built-ins and user-registered
 * commands. The context is built per-invocation by the shell.
 */

export interface Writer {
  /**
   * Strings are display/text writes (encoded once at the sink); `Uint8Array`
   * flows through capture → pipes → redirects byte-identically (ADR-0198).
   */
  write(chunk: string | Uint8Array): void;
}

/**
 * Async stdin reader. `read()` resolves a chunk, or `null` at EOF — mirrors the
 * WASI `fd_read` `onStdin` model (ADR-0049). Absent on the context ⇒ no input is
 * connected; a filter that needs stdin must error cleanly, never silently stub
 * (ADR-0089).
 */
export interface StdinReader {
  read(): Promise<Uint8Array | null>;
}

export interface CommandContext {
  cwd: string;
  env: Record<string, string>;
  stdout: Writer;
  stderr: Writer;
  /** Present when input is connected (pipe RHS, `<` redirect, interactive). */
  readonly stdin?: StdinReader;
  /**
   * `true` when this command's stdout is an interactive terminal. Absent/false
   * ⇒ a redirect / pipe / non-TTY sink. Gate `--color=auto` SGR and column
   * width on this (ADR-0089): emitting SGR into a file/stream corrupts it.
   */
  readonly isTTY?: boolean;
  /** Terminal width / height when {@link isTTY}; consumers fall back to 80×24. */
  readonly cols?: number;
  readonly rows?: number;
  /**
   * Aborts when the foreground command is cancelled (Ctrl+C / SIGINT). A
   * long-running command observes this to return early (conventionally exit
   * `130`); absent ⇒ never cancelled (ADR-0089).
   */
  readonly signal?: AbortSignal;
}

export type ShellCommand = (args: string[], ctx: CommandContext) => Promise<number>;
