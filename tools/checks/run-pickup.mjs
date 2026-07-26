/** Production-source boundary shared by autonomous-run checks. */
export const PRODUCTION_SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;

/**
 * PR-branch head. GitHub PR CI checks out the synthetic merge ref (one merge
 * commit of main tip + PR head) — walking it first-parent collapses the PR
 * into a single diff and blinds every per-commit rule. Detect that shape
 * (merge commit whose FIRST parent lies on origin/main and whose second does
 * not) and return the true PR head; anywhere else return HEAD.
 */
export function prHead(git) {
  let parents;
  try {
    parents = git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/).slice(1);
  } catch {
    return 'HEAD';
  }
  if (parents.length !== 2) return 'HEAD';
  const onMain = (sha) => {
    try {
      git('merge-base', '--is-ancestor', sha, 'origin/main');
      return true;
    } catch {
      return false;
    }
  };
  if (onMain(parents[0]) && !onMain(parents[1])) return parents[1];
  return 'HEAD';
}

/**
 * Parent of the first production-source commit. Contract+RED commits may
 * precede it in one PR; implementation cannot rewrite their authority later.
 */
export function pickupCommit(base, git, head = 'HEAD') {
  const prPaths = git('diff', '--name-only', base, head).trim().split('\n').filter(Boolean);
  if (!prPaths.some((path) => PRODUCTION_SOURCE_RE.test(path))) return base;
  const commits = git('rev-list', '--first-parent', '--reverse', `${base}..${head}`)
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const commit of commits) {
    const parent = git('rev-parse', `${commit}^`).trim();
    const paths = git('diff', '--name-only', parent, commit).trim().split('\n').filter(Boolean);
    if (paths.some((path) => PRODUCTION_SOURCE_RE.test(path))) return parent;
  }
  return base;
}
