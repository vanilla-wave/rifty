export interface ScmResourceRow {
  readonly path: string;
  readonly relativePath: string;
  readonly code: string;
  readonly side: 'index' | 'worktree';
  readonly badge: 'M' | 'U' | 'A' | 'D';
}

export interface ScmResourceGroups {
  readonly staged: readonly ScmResourceRow[];
  readonly changes: readonly ScmResourceRow[];
}

function relativePath(root: string, path: string): string {
  const prefix = root === '/' ? '/' : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\/+/, '');
}

function badgeForCode(code: string, side: 'index' | 'worktree'): ScmResourceRow['badge'] {
  if (code === '??') return 'U';
  const ch = (side === 'index' ? code[0] : code[1]) ?? 'M';
  if (ch === 'A') return 'A';
  if (ch === 'D') return 'D';
  return 'M';
}

function hasIndexChange(code: string): boolean {
  const index = code[0] ?? ' ';
  return index !== ' ' && index !== '?';
}

function hasWorktreeChange(code: string): boolean {
  return code === '??' || (code[1] ?? ' ') !== ' ';
}

function row(path: string, root: string, code: string, side: 'index' | 'worktree'): ScmResourceRow {
  return {
    path,
    relativePath: relativePath(root, path),
    code,
    side,
    badge: badgeForCode(code, side),
  };
}

export function scmRowsFromStatusMap(
  status: ReadonlyMap<string, string>,
  root: string,
): ScmResourceGroups {
  const staged: ScmResourceRow[] = [];
  const changes: ScmResourceRow[] = [];
  const prefix = root === '/' ? '/' : `${root}/`;
  for (const [path, code] of status) {
    if (path !== root && !path.startsWith(prefix)) continue;
    if (hasIndexChange(code)) staged.push(row(path, root, code, 'index'));
    if (hasWorktreeChange(code)) changes.push(row(path, root, code, 'worktree'));
  }
  return { staged, changes };
}
