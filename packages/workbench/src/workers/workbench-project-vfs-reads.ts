import { basename } from '@riftydev/vfs';
import type { OwnerVfsSnapshotEntry } from '../glue/owner-vfs-protocol.ts';
import type { ProjectVfsDirectoryEntry } from '../workbench/project-vfs-protocol.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

type AtomicFileEntry = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }>;

function requiredVersion(authority: OwnerVfsAuthority, path: string): string {
  const version = authority.versionOf(path);
  if (version === null) throw new Error(`owner VFS version missing for ${path}`);
  return version;
}

export function atomicFile(authority: OwnerVfsAuthority, path: string): AtomicFileEntry {
  if (authority.statSyncOrNull(path)?.isFile !== true) {
    throw new Error(`No file exists at ${path}`);
  }
  const content = authority.readFileBytesSync(path);
  return {
    path,
    kind: 'file',
    size: content.byteLength,
    content,
    version: requiredVersion(authority, path),
  };
}

export function atomicDirectory(
  authority: OwnerVfsAuthority,
  path: string,
): readonly ProjectVfsDirectoryEntry[] {
  if (authority.statSyncOrNull(path)?.isDirectory !== true) {
    throw new Error(`No directory exists at ${path}`);
  }
  return authority
    .readdirSync(path)
    .map((child) => {
      const childPath = `${path}/${child.name}`;
      const kind = child.isDirectory ? ('dir' as const) : ('file' as const);
      const size = kind === 'dir' ? 0 : authority.statSync(childPath).size;
      if (size === undefined) throw new Error(`owner VFS file size missing for ${childPath}`);
      return Object.freeze({
        path: childPath,
        kind,
        size,
        version: requiredVersion(authority, childPath),
      });
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      const leftName = basename(left.path).toLowerCase();
      const rightName = basename(right.path).toLowerCase();
      return leftName < rightName
        ? -1
        : leftName > rightName
          ? 1
          : left.path.localeCompare(right.path);
    });
}
