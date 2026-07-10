import type { PtyRunOrigin } from '../glue/pty-protocol.ts';
import type { WorkspaceMutation } from '../glue/scoped-vfs.ts';

export interface PtyRunIdentity {
  readonly sid: string;
  readonly rid: string;
  readonly origin: PtyRunOrigin;
}

export interface PtyRunSettlement extends PtyRunIdentity {
  /** `cmd &`: work may mutate the shared VFS after the foreground PTY exits. */
  readonly mayOutlivePty: boolean;
}

export interface ScratchDirtyTracker {
  /** Bind after the owner index port exists; runs cannot start before owner-ready. */
  bind(markActiveScratchDirty: () => void): void;
  startRun(run: PtyRunIdentity): void;
  settleRun(run: PtyRunSettlement): void;
  onWorkspaceMutation(mutation: WorkspaceMutation): void;
}

function runKey(sid: string, rid: string): string {
  return `${sid}\0${rid}`;
}

function touchesScratch(paths: readonly string[]): boolean {
  return paths.some((path) => path === '/scratch' || path.startsWith('/scratch/'));
}

/**
 * Owner-side bridge from real VFS mutations to ADR-0165 scratch protection.
 * Programmatic boot runs are baseline construction; user runs are edits. The
 * VFS observer is below every shell/fs operation, so no command-name allowlist
 * can drift (`echo`, `mkdir`, `mv`, and child `node:fs` share this path).
 * Concurrent runs share one VFS without async-context identity: while any user
 * run is open, a `/scratch` mutation is conservatively protected. This can add
 * a discard prompt during overlap; the alternative can silently wipe bytes.
 * A user `cmd &` is a one-way protection boundary: mark dirty at foreground
 * settle, before detached work can mutate later or a Starter pick can wipe the
 * tree. Boot-origin background work remains baseline construction and is not
 * marked. The extra dirty for a no-op background job is intentional.
 */
export function createScratchDirtyTracker(): ScratchDirtyTracker {
  const userRuns = new Set<string>();
  let markActiveScratchDirty: (() => void) | undefined;

  return {
    bind(mark): void {
      markActiveScratchDirty = mark;
    },
    startRun(run): void {
      if (run.origin === 'user') userRuns.add(runKey(run.sid, run.rid));
    },
    settleRun(run): void {
      const wasUserRun = userRuns.delete(runKey(run.sid, run.rid));
      if (wasUserRun && run.origin === 'user' && run.mayOutlivePty) {
        markActiveScratchDirty?.();
      }
    },
    onWorkspaceMutation(mutation): void {
      if (userRuns.size === 0 || !touchesScratch(mutation.paths)) return;
      markActiveScratchDirty?.();
    },
  };
}
