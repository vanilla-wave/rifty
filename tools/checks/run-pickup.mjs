/** Production-source boundary shared by autonomous-run checks. */
export const PRODUCTION_SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;

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
