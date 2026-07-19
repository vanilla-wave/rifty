import { makeGit, vfsToGitFs } from '@riftydev/git';
import type { Vfs } from '@riftydev/vfs';

const INITIAL_COMMIT_MESSAGE = 'Initial commit';
const GENERATED_BASELINE_FILES = new Set(['package-lock.json']);

function initialCommitAuthor(): {
  readonly name: string;
  readonly email: string;
  readonly timestamp: number;
  readonly timezoneOffset: number;
} {
  return {
    name: 'rifty',
    email: 'rifty@localhost',
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  };
}

async function headCommitExists(g: ReturnType<typeof makeGit>): Promise<boolean> {
  try {
    await g.resolveRef('HEAD');
    return true;
  } catch {
    return false;
  }
}

async function stageInitialTree(g: ReturnType<typeof makeGit>): Promise<boolean> {
  const changed = await g.status();
  for (const entry of changed) {
    if (entry.status === '111') continue;
    if (entry.status === '101' || entry.status === '100') await g.remove(entry.filepath);
    else await g.add(entry.filepath);
  }
  return changed.some((entry) => entry.status !== '111');
}

async function stageGeneratedBaseline(g: ReturnType<typeof makeGit>): Promise<boolean> {
  const changed = await g.status();
  let staged = false;
  for (const entry of changed) {
    if (!GENERATED_BASELINE_FILES.has(entry.filepath) || entry.status === '111') continue;
    if (entry.status === '101' || entry.status === '100') await g.remove(entry.filepath);
    else await g.add(entry.filepath);
    staged = true;
  }
  return staged;
}

async function hasSingleInitialCommit(g: ReturnType<typeof makeGit>): Promise<boolean> {
  try {
    const log = await g.log({ depth: 2 });
    return log.length === 1 && log[0]?.message.trim() === INITIAL_COMMIT_MESSAGE;
  } catch {
    return false;
  }
}

/**
 * Make a freshly-seeded Starter look like a normal project checkout: one real
 * root commit on `main`, clean worktree, generated files left ignored.
 */
export async function ensureStarterInitialCommit(vfs: Vfs, root: string): Promise<void> {
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
  if (!(await vfs.exists(`${root}/.git/HEAD`))) await g.init();
  if (await headCommitExists(g)) return;

  const hasChanges = await stageInitialTree(g);
  if (!hasChanges) return;

  const author = initialCommitAuthor();
  await g.commit({ message: INITIAL_COMMIT_MESSAGE, author, committer: author });
}

/**
 * Fold generated baseline artifacts produced after first seed (currently npm's
 * package-lock.json) into the Starter's single root commit. Only amends the
 * untouched one-commit Starter history and only stages known generated files,
 * so real user edits stay visible.
 */
export async function amendStarterGeneratedBaseline(vfs: Vfs, root: string): Promise<void> {
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
  if (!(await hasSingleInitialCommit(g))) return;
  if (!(await stageGeneratedBaseline(g))) return;

  const author = initialCommitAuthor();
  await g.commit({ message: INITIAL_COMMIT_MESSAGE, author, committer: author, amend: true });
}
