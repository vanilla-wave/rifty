const PRODUCTION_SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;
const TEST_SUPPORT_RE =
  /(?:^|\/)(?:__tests__|tests?|fixtures|_test-fixtures|test-fixtures)(?:\/|$)|(?:^|\/)(?:test-[^/]+|[^/]+-test-fixture|[^/]+\.(?:test|spec|test-fixture|contract-fixtures))\.[^./]+$/u;

/**
 * Autonomous-run path boundary shared by pickup, drift, and budget checks.
 * @returns {'production'|'test-support'|'other'}
 */
export function classifyAutonomousRunPath(path) {
  if (TEST_SUPPORT_RE.test(path)) return 'test-support';
  if (PRODUCTION_SOURCE_RE.test(path)) return 'production';
  return 'other';
}

/**
 * Parent of the first production-source commit. Contract+RED commits may
 * precede it in one PR; implementation cannot rewrite their authority later.
 */
export function pickupCommit(base, git, head = 'HEAD') {
  const prPaths = git('diff', '--name-only', base, head).trim().split('\n').filter(Boolean);
  if (!prPaths.some((path) => classifyAutonomousRunPath(path) === 'production')) return base;
  const commits = git('rev-list', '--first-parent', '--reverse', `${base}..${head}`)
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const commit of commits) {
    const parent = git('rev-parse', `${commit}^`).trim();
    const paths = git('diff', '--name-only', parent, commit).trim().split('\n').filter(Boolean);
    if (paths.some((path) => classifyAutonomousRunPath(path) === 'production')) return parent;
  }
  return base;
}
