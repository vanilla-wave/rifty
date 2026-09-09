import { type FsSync, VfsError, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { isInstallStampPath } from '../glue/install-stamp.ts';

export interface InstallClaimCopyEntry {
  readonly source: string;
  readonly target: string;
  readonly kind: 'file' | 'dir';
}

export function reservedInstallClaimError(path: string): VfsError {
  return new VfsError('EPERM', path, `EPERM: reserved install-stamp authority claim path: ${path}`);
}

export function canonicalClaimGuardPath(path: string): string {
  if (!isAbsolute(path)) throw new Error(`VFS path must be absolute (ADR-0199); got: '${path}'`);
  return normalizePath(path);
}

/** Shared claim ingress policy; no revision, journal, or dependency-byte tracking. */
export class InstallClaimGuard {
  constructor(private readonly fs: FsSync) {}

  assertPaths(paths: readonly string[]): void {
    const reserved = paths.map(canonicalClaimGuardPath).find(isInstallStampPath);
    if (reserved) throw reservedInstallClaimError(reserved);
  }

  copyPlan(source: string, target: string): readonly InstallClaimCopyEntry[] {
    const plan: InstallClaimCopyEntry[] = [];
    const visit = (currentSource: string, currentTarget: string): void => {
      if (isInstallStampPath(currentSource)) return;
      if (isInstallStampPath(currentTarget)) throw reservedInstallClaimError(currentTarget);
      const stat = this.fs.statSync(currentSource);
      if (stat.isFile) {
        plan.push({ source: currentSource, target: currentTarget, kind: 'file' });
        return;
      }
      plan.push({ source: currentSource, target: currentTarget, kind: 'dir' });
      for (const child of this.children(currentSource)) {
        visit(joinPath(currentSource, child.name), joinPath(currentTarget, child.name));
      }
    };
    visit(source, target);
    return plan;
  }

  firstInSubtree(root: string): string | null {
    if (isInstallStampPath(root)) return root;
    if (!this.fs.statSyncOrNull(root)?.isDirectory) return null;
    for (const child of this.children(root)) {
      const found = this.firstInSubtree(joinPath(root, child.name));
      if (found) return found;
    }
    return null;
  }

  firstInTransfer(source: string, target: string): string | null {
    if (isInstallStampPath(source)) return source;
    if (isInstallStampPath(target)) return target;
    if (!this.fs.statSync(source).isDirectory) return null;
    for (const child of this.children(source)) {
      const found = this.firstInTransfer(
        joinPath(source, child.name),
        joinPath(target, child.name),
      );
      if (found) return found;
    }
    return null;
  }

  private children(path: string) {
    return [...this.fs.readdirSync(path)].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }
}
