/**
 * The seam between App.tsx and the lazily-loaded AI module (ADR-0190): AI
 * consumes EXISTING playground adapters — the owner snapshot mirror, the
 * acked owner-RPC fs, the shared terminal manager path and the git owner
 * bridge — through this context object. App.tsx constructs it; nothing here
 * re-creates a bridge. Types only: importing this file stays erased, so the
 * eager App bundle gains no AI code.
 */
import type { DiffEntry } from '@riftydev/git';
import type { OwnerRpcFs } from '../glue/owner-rpc-fs.ts';
import type { SnapshotFs } from '../glue/snapshot-fs.ts';

export interface AgentShellResult {
  readonly exitCode: number;
  /** Everything the command wrote to the terminal (stdout + stderr, ANSI included). */
  readonly output: string;
}

export interface AiAppContext {
  /** Active workspace root (live accessor — follows project switches). */
  root(): string;
  /** Read-only mirror of the owner tree (excludes node_modules; big files content-less). */
  snapshot: SnapshotFs;
  /** Acked writes to the owner store — resolve only after the owner reflects them. */
  fs: OwnerRpcFs;
  /**
   * Run one line in the dedicated, visible "AI agent" terminal session —
   * the SAME owner pty path a user terminal uses. Commands are serialized
   * app-side; `signal` forwards a cooperative SIGINT.
   */
  runShellLine(line: string, signal?: AbortSignal): Promise<AgentShellResult>;
  /** `head-workdir` diff of the active workspace (session trace export). */
  gitDiff(): Promise<readonly DiffEntry[]>;
  /** Editor-write parity hook (dirty tracking) — fired after agent text writes. */
  fileWritten(path: string, content: string): void;
}
