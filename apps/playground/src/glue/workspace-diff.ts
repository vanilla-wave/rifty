/**
 * Whole-workspace HEAD↔worktree diff over the owner git RPC — the "final git
 * diff" of an AI session trace (ADR-0190). Lives in glue (not App.tsx): the
 * App source guard forbids `git.diff(` there — SCM ROW diffs must come from
 * blob bytes, while this structured whole-tree diff is a trace/export read.
 */
import type { DiffEntry } from '@riftydev/git';
import { bridgeGitOwnerRpc } from './git-owner-port.ts';
import type { OwnerBridgeKey } from './owner-bridge-key.ts';

export async function readHeadWorkdirDiff(key: OwnerBridgeKey): Promise<readonly DiffEntry[]> {
  const git = bridgeGitOwnerRpc(key);
  try {
    return await git.diff({ kind: 'head-workdir' });
  } finally {
    git.dispose();
  }
}
