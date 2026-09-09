import { createMemoryFs } from '@riftydev/vfs/internal';
import { planPackageInstallFiles } from '../workers/package-install-finalizer.ts';
import type { DepSnapshotV3 } from './dep-snapshot.ts';
import { prepareWorkspaceArchiveImport } from './workspace-archive.ts';

/** Validate only incoming bytes; preparing a live overlay could alter untargeted saved files. */
export function assertPreparedDependencySnapshot(snapshot: DepSnapshotV3): void {
  const { fsSync } = createMemoryFs();
  const root = '/snapshot';
  fsSync.mkdirSync(root, { recursive: true });
  const encoder = new TextEncoder();
  fsSync.writeFileSync(`${root}/package.json`, encoder.encode(snapshot.packageJsonText));
  if (snapshot.lockfile.length > 0)
    fsSync.writeFileSync(`${root}/package-lock.json`, encoder.encode(snapshot.lockfile));
  prepareWorkspaceArchiveImport(fsSync, snapshot.nodeModules, {
    root: `${root}/node_modules`,
    rebase: true,
  }).apply();
  const changes = planPackageInstallFiles({ root, fs: fsSync });
  if (changes.length > 0) {
    throw new Error(
      `Dependency snapshot requires installed-file preparation; rebake before apply: ${changes
        .map(({ path }) => path.slice(root.length))
        .join(', ')}`,
    );
  }
}
