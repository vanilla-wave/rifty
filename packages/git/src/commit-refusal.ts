/**
 * Shared rifty-git commit-refusal classifier (ADR-0184).
 *
 * Real git refuses to fabricate an empty commit (exit 1) and emits an exact
 * stdout summary per working-tree state. The shell `git commit` builtin and the
 * playground SCM owner RPC both need byte-identical refusals so panel-commit and
 * shell-commit behave the same on identical inputs — kept here on the git facade
 * rather than duplicated per realm (the precedent retained by
 * `porcelainStatusLines`, ADR-0284).
 */
import { isGitNotFound } from './errors.ts';
import type { Git } from './git.ts';
import { requireSupportedStatusEntries } from './status.ts';

/** git's exact stderr line for `commit -m ''` (an empty, non-amend message). */
export const EMPTY_COMMIT_MESSAGE_ERROR = 'Aborting commit due to empty commit message.';

/**
 * The exact stdout summary line git prints when there is nothing to commit, or
 * `null` when a staged change IS present (commit may proceed). Mirrors git
 * 2.50.1's wording for the common porcelain states.
 */
export async function commitRefusal(
  git: Pick<Git, 'status' | 'resolveRef'>,
): Promise<string | null> {
  const entries = requireSupportedStatusEntries(await git.status());
  const hasStaged = entries.some((e) => {
    const head = e.status[0];
    const stage = e.status[2];
    return stage !== '1' && !(head === '0' && stage === '0');
  });
  if (hasStaged) return null;
  const hasUnstagedTracked = entries.some(
    (e) => e.status[0] === '1' && e.status[2] === '1' && e.status[1] !== '1',
  );
  if (hasUnstagedTracked)
    return 'no changes added to commit (use "git add" and/or "git commit -a")';
  if (entries.some((e) => e.status === '020'))
    return 'nothing added to commit but untracked files present (use "git add" to track)';
  // Unborn is PROVEN absence (ADR-0357); a storage read failure surfaces as-is.
  const unborn = await git
    .resolveRef('HEAD')
    .then(() => false)
    .catch((error: unknown) => {
      if (isGitNotFound(error)) return true;
      throw error;
    });
  if (unborn) return 'nothing to commit (create/copy files and use "git add" to track)';
  return 'nothing to commit, working tree clean';
}
