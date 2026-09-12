import {
  type FlushOptions,
  type FsSync,
  type PersistFailureReport,
  VfsError,
  dirname,
} from '@riftydev/vfs';
import type { InstallStampClaimIo } from '../glue/install-stamp-authority.ts';
import { installStampPath, installTreeDir } from '../glue/install-stamp.ts';
import {
  InstallClaimGuard,
  canonicalClaimGuardPath,
  reservedInstallClaimError,
} from './install-claim-guard.ts';

export interface InstallClaimFs extends FsSync {
  loadFixture(files: Readonly<Record<string, string>>): void;
  flush(options?: FlushOptions): Promise<PersistFailureReport | undefined>;
  fence(): Promise<void>;
}

/** Construction-only capability; guest FsSync never receives raw claim writes. */
export function createInstallClaimFs(raw: FsSync): {
  readonly fs: InstallClaimFs;
  readonly claims: InstallStampClaimIo;
} {
  const guard = new InstallClaimGuard(raw);
  const guardedPath = (path: string): string => {
    guard.assertPaths([path]);
    return canonicalClaimGuardPath(path);
  };
  const canonicalRoot = (root: string): string => {
    if (canonicalClaimGuardPath(root) !== root)
      throw new Error(`install-stamp claim root must be canonical; got: '${root}'`);
    return root;
  };
  const fs: InstallClaimFs = {
    loadFixture(files) {
      guard.assertPaths(Object.keys(files));
      for (const [path, content] of Object.entries(files)) {
        const normalized = canonicalClaimGuardPath(path);
        fs.mkdirSync(dirname(normalized), { recursive: true });
        fs.writeFileSync(normalized, new TextEncoder().encode(content));
      }
    },
    existsSync: raw.existsSync.bind(raw),
    readFileBytesSync: (path) => raw.readFileBytesSync(path).slice(),
    readdirSync: raw.readdirSync.bind(raw),
    statSync: raw.statSync.bind(raw),
    statSyncOrNull: raw.statSyncOrNull.bind(raw),
    writeFileSync(path, data) {
      raw.writeFileSync(guardedPath(path), data);
    },
    mkdirSync(path, options) {
      raw.mkdirSync(guardedPath(path), options);
    },
    rmSync(path, options) {
      const normalized = guardedPath(path);
      const claim = guard.firstInSubtree(normalized);
      if (claim) throw reservedInstallClaimError(claim);
      raw.rmSync(normalized, options);
    },
    utimes(path, atime, mtime) {
      raw.utimes(guardedPath(path), atime, mtime);
    },
    copyFileSync(source, target) {
      raw.copyFileSync(guardedPath(source), guardedPath(target));
    },
    cpSync(source, target, options = {}) {
      const from = guardedPath(source);
      const to = guardedPath(target);
      if (raw.statSync(from).isFile) {
        fs.copyFileSync(from, to);
        return;
      }
      if (!options.recursive) throw new VfsError('EISDIR', source);
      if (to === from || to.startsWith(`${from}/`) || from === '/')
        throw new VfsError('EINVAL', source);
      const plan = guard.copyPlan(from, to);
      for (const entry of plan) {
        if (entry.kind === 'dir') fs.mkdirSync(entry.target, { recursive: true });
        else fs.copyFileSync(entry.source, entry.target);
      }
    },
    renameSync(source, target) {
      const from = guardedPath(source);
      const to = guardedPath(target);
      if (from !== to) {
        const claim = guard.firstInTransfer(from, to) ?? guard.firstInSubtree(to);
        if (claim) throw reservedInstallClaimError(claim);
      }
      raw.renameSync(from, to);
    },
    async flush(options) {
      return await (raw as FsSync & { flush?: InstallClaimFs['flush'] }).flush?.(options);
    },
    async fence() {
      await (raw as FsSync & { fence?: () => Promise<void> }).fence?.();
    },
  };
  function readInstallStampClaim(root: string): Uint8Array | null {
    const path = installStampPath(canonicalRoot(root));
    return raw.existsSync(path) ? raw.readFileBytesSync(path).slice() : null;
  }
  function writeInstallStampClaim(
    root: string,
    data: Uint8Array,
    options: { readonly mkdirTree: boolean },
  ): void {
    canonicalRoot(root);
    if (options.mkdirTree) fs.mkdirSync(installTreeDir(root), { recursive: true });
    raw.writeFileSync(installStampPath(root), data.slice());
  }
  function removeInstallStampClaim(root: string): void {
    raw.rmSync(installStampPath(canonicalRoot(root)), { recursive: true, force: true });
  }
  const claims: InstallStampClaimIo = {
    read: readInstallStampClaim,
    write: writeInstallStampClaim,
    remove: removeInstallStampClaim,
  };
  return Object.freeze({ fs, claims: Object.freeze(claims) });
}
