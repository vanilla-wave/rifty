import { dirname } from '@riftydev/vfs';

export type GitDecorationKind = 'modified' | 'untracked' | 'added' | 'deleted';

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
  deleted: 3,
  added: 2,
  untracked: 1,
};

const BADGE_FOR_KIND: Record<GitDecorationKind, NonNullable<GitDecoration['badge']>> = {
  untracked: 'U',
  added: 'A',
  modified: 'M',
  deleted: 'D',
};

/**
 * rifty-git porcelain `XY` → one VS Code-style file decoration kind. A worktree
 * deletion (`Y=D`, incl. `MD`/`AD`) dominates as deleted; an index addition
 * (`X=A`, incl. `AM`) reads as added (green); any other M (`MM`/`M `/` M`) is
 * modified (orange). Mirrors VS Code's green=added/untracked, orange=modified,
 * red=deleted, instead of a "staged is blue" rule that hides the worktree side.
 */
export function gitDecorationKind(code: string): GitDecorationKind | null {
  const index = code[0] ?? ' ';
  const worktree = code[1] ?? ' ';
  if (index === '?' && worktree === '?') return 'untracked';
  if (worktree === 'D') return 'deleted';
  if (index === 'A') return 'added';
  if (index === 'M' || worktree === 'M') return 'modified';
  if (index === 'D') return 'deleted';
  return null;
}

function badgeForCode(kind: GitDecorationKind): GitDecoration['badge'] {
  return BADGE_FOR_KIND[kind];
}

function fileDecoration(code: string): GitDecoration | null {
  const kind = gitDecorationKind(code);
  if (!kind) return null;
  const badge = badgeForCode(kind);
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
