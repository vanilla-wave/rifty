import type { FsSync, VfsMutationGuard } from '@riftydev/vfs';

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

/** Current terminal grid, in character cells. */
export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

/** Run-scoped source of current and future foreground terminal dimensions. */
export interface TerminalResizeSource {
  current(): TerminalSize;
  subscribe(listener: (size: TerminalSize) => void): () => void;
}

/** Process-control signals currently supported by shell-backed runtimes. */
export type ProcessExitSignal = 'SIGINT' | 'SIGTERM';

/** Exact Node-style process exit: code and signal are mutually exclusive. */
export type ProcessExit =
  | { readonly code: number; readonly signal: null }
  | { readonly code: null; readonly signal: ProcessExitSignal };

/** Built-ins return a status; process-backed commands preserve the exact exit. */
export type ShellCommandResult = number | ProcessExit;

export interface CommandContext {
  cwd: string;
  env: Record<string, string>;
  /** File namespace owned by this shell invocation. */
  readonly fileSystem?: FsSync;
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
  /** Present only for an interactive foreground sink. */
  readonly terminal?: TerminalResizeSource;
  /**
   * Aborts when the foreground command is cancelled (Ctrl+C / SIGINT). A
   * long-running command observes this to return early (conventionally exit
   * `130`); absent ⇒ never cancelled (ADR-0089).
   */
  readonly signal?: AbortSignal;
  /** Host policy boundary for authoritative VFS mutations. */
  readonly mutationGuard?: VfsMutationGuard;
  /** Synchronous namespace policy over one complete absolute-path plan. */
  readonly assertPortablePaths?: (absolutePaths: readonly string[]) => void;
}

export type ShellCommand = (args: string[], ctx: CommandContext) => Promise<ShellCommandResult>;
