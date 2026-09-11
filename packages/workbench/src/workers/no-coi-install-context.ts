import { OpfsFsSync, asyncVfs, syncMirror } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { InstallMirrorVfs } from '../glue/install-mirror-vfs.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createInstallClaimFs } from './install-claim-fs.ts';

/** One composition per Worker; raw capabilities stay in the owner. */
export function createNoCoiInstallContext() {
  const raw = syncMirror();
  const native = asyncVfs();
  if (!native) throw new Error('toolchain paired VFS is not ready');
  const guarded = createInstallClaimFs(raw);
  setSyncMirror(guarded.fs, { async: new SyncMirrorVfs() });
  return Object.freeze({
    fs: guarded.fs,
    // Validated snapshot payloads may replace a whole target subtree, including old claims.
    applicationFs: raw,
    // Structured clone owns the snapshot copy; guest reads remain detached.
    readRecoveryFile: (path: string) => raw.readFileBytesSync(path),
    claims: guarded.claims,
    installerVfs: new InstallMirrorVfs(raw instanceof OpfsFsSync ? raw : undefined, native),
    stamps: createInstallStampAuthority({
      vfs: new SyncMirrorVfs(),
      fsSync: guarded.fs,
      claimIo: guarded.claims,
    }),
  });
}
