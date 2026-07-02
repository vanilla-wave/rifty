/**
 * The seam between App.tsx and the lazily-loaded AI module (ADR-0190): AI
 * consumes EXISTING playground adapters — the owner snapshot mirror, the
 * acked owner-RPC fs, the shared terminal manager path, the preview iframe,
 * the ts-LS client and the git owner bridge — through this context object.
 * App.tsx constructs it; nothing here re-creates a bridge. Types only:
 * importing this file stays erased, so the eager App bundle gains no AI code.
 */
import type { DiffEntry } from '@riftydev/git';
import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import type { AgentBenchRegistrar } from '../glue/agent-bench.ts';
import type { OwnerRpcFs } from '../glue/owner-rpc-fs.ts';
import type { SnapshotFs } from '../glue/snapshot-fs.ts';

export interface AgentShellResult {
  readonly exitCode: number;
  /** Everything the command wrote to the terminal (stdout + stderr, ANSI included). */
  readonly output: string;
}

export interface AiPreviewAccess {
  /** The REAL preview iframe the user sees (PreviewPanel), or null when unmounted. */
  frame(): HTMLIFrameElement | null;
  /** Live previewable ports (dev server + node servers); empty when none. */
  ports(): readonly number[];
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
  /** Same-origin preview iframe access for the preview_* tools. */
  preview: AiPreviewAccess;
  /**
   * ts-LS diagnostics for `path` — the SAME client + readiness gate the
   * Problems panel uses. Rejects loudly (naming why) when the language
   * service is unavailable for this project.
   */
  tsDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  /**
   * agent-bench hook: external validation harness only. Not public API.
   * Non-null only under `?agentBench=1` (ADR-0191); the AI panel registers
   * the live session's exportTrace/metadata bridge here.
   */
  agentBench: AgentBenchRegistrar | null;
}
