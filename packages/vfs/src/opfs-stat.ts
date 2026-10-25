import type { IndexEntry } from './opfs-preload.ts';
import type { FsStat } from './stat-metadata.ts';

export function opfsStat(
  entry: IndexEntry,
  path: string,
  index: ReadonlyMap<string, IndexEntry>,
  times: { readonly atime: number; readonly mtime: number },
): FsStat {
  const directory = entry.kind === 'dir';
  return {
    isFile: !directory,
    isDirectory: directory,
    size: directory ? 0 : entry.size,
    ...times,
    metadata: { ...entry.metadata },
    nlink: directory
      ? 2 +
        [...(entry.children ?? [])].filter(
          (name) => index.get(path === '/' ? `/${name}` : `${path}/${name}`)?.kind === 'dir',
        ).length
      : 1,
  };
}
