import { dirname } from '@riftydev/vfs';

export type GitDecorationKind = 'modified' | 'untracked' | 'staged' | 'deleted';

export interface GitDecoration {
  readonly kind: GitDecorationKind;
  readonly badge?: 'M' | 'U' | 'A' | 'D';
  readonly title: string;
}

export interface GitDecorationMaps {
  readonly files: ReadonlyMap<string, GitDecoration>;
  readonly folders: ReadonlyMap<string, GitDecoration>;
}

const FOLDER_PRIORITY: Record<GitDecorationKind, number> = {
  modified: 4,
  staged: 3,
  untracked: 2,
  deleted: 1,
};

export function gitDecorationKind(code: string): GitDecorationKind | null {
  const index = code[0] ?? ' ';
  const worktree = code[1] ?? ' ';
  if (index === '?' && worktree === '?') return 'untracked';
  if (index === 'D' || worktree === 'D') return 'deleted';
  if (index === 'M' || index === 'A') return 'staged';
  if (worktree === 'M') return 'modified';
  return null;
}

function badgeForCode(kind: GitDecorationKind, code: string): GitDecoration['badge'] {
  if (kind === 'modified') return 'M';
  if (kind === 'untracked') return 'U';
  if (kind === 'deleted') return 'D';
  return code[0] === 'A' ? 'A' : 'M';
}

function fileDecoration(code: string): GitDecoration | null {
  const kind = gitDecorationKind(code);
  if (!kind) return null;
  const badge = badgeForCode(kind, code);
  return { kind, badge, title: `rifty-git status: ${badge} ${kind}` };
}

function folderDecoration(kind: GitDecorationKind): GitDecoration {
  return { kind, badge: undefined, title: `rifty-git status: descendant ${kind}` };
}

function mergeFolderKind(
  prev: GitDecorationKind | undefined,
  next: GitDecorationKind,
): GitDecorationKind {
  if (!prev) return next;
  return FOLDER_PRIORITY[next] > FOLDER_PRIORITY[prev] ? next : prev;
}

export function gitStatusDecorationMaps(status: ReadonlyMap<string, string>): GitDecorationMaps {
  const files = new Map<string, GitDecoration>();
  const folders = new Map<string, GitDecorationKind>();

  for (const [path, code] of status) {
    const decoration = fileDecoration(code);
    if (!decoration) continue;
    files.set(path, decoration);

    let folder = dirname(path);
    while (folder !== '.' && folder !== '/') {
      folders.set(folder, mergeFolderKind(folders.get(folder), decoration.kind));
      const parent = dirname(folder);
      if (parent === folder) break;
      folder = parent;
    }
  }

  return {
    files,
    folders: new Map([...folders].map(([path, kind]) => [path, folderDecoration(kind)])),
  };
}

export function decorationForPath(maps: GitDecorationMaps, path: string): GitDecoration | null {
  return maps.files.get(path) ?? maps.folders.get(path) ?? null;
}
