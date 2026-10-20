import { Buffer } from '@riftydev/io';
import type { Lockfile } from '@riftydev/npm-client';
import { reprojectShadowLockfile } from '@riftydev/npm-client/internal';
import type { ShadowRuntimeTier } from '@riftydev/shadow-registry/internal';
import type { DepSnapshotV3 } from './dep-snapshot.ts';
import {
  installArtifactIdentity,
  installArtifactIdentityForTier,
} from './install-artifact-identity.ts';

/** Caller verifies replay-cache integrity first; only generated facade bytes may change. */
export function projectDependencySnapshotTier(
  snapshot: DepSnapshotV3,
  runtimeTier?: ShadowRuntimeTier,
): DepSnapshotV3 {
  if (runtimeTier === undefined) return snapshot;
  if (
    snapshot.installArtifactIdentity !== installArtifactIdentity &&
    snapshot.installArtifactIdentity !== installArtifactIdentityForTier('coi')
  ) {
    throw new Error('Dependency snapshot install-artifact identity mismatch');
  }
  const selectedIdentity = installArtifactIdentityForTier(runtimeTier);
  if (snapshot.lockfile.length === 0)
    return snapshot.installArtifactIdentity === selectedIdentity
      ? snapshot
      : { ...snapshot, installArtifactIdentity: selectedIdentity };
  const result = reprojectShadowLockfile(JSON.parse(snapshot.lockfile) as Lockfile, runtimeTier);
  if (result.replacements.length === 0)
    return snapshot.installArtifactIdentity === selectedIdentity
      ? snapshot
      : { ...snapshot, installArtifactIdentity: selectedIdentity };
  let files = [...snapshot.nodeModules.files];
  let directories = [...(snapshot.nodeModules.directories ?? [])];
  for (const replacement of result.replacements) {
    const root = replacement.installPath.slice('node_modules/'.length);
    const prefix = `${root}/`;
    files = files.filter((file) => !file.path.startsWith(prefix));
    directories = directories.filter((path) => path !== root && !path.startsWith(prefix));
    for (const file of replacement.files) {
      const path = `${prefix}${file.path}`;
      files.push({
        path,
        encoding: 'base64',
        content: Buffer.from(file.content).toString('base64'),
      });
      const parts = path.split('/');
      for (let count = 1; count < parts.length; count++)
        directories.push(parts.slice(0, count).join('/'));
    }
  }
  return {
    ...snapshot,
    installArtifactIdentity: selectedIdentity,
    lockfile: JSON.stringify(result.lockfile),
    nodeModules: {
      ...snapshot.nodeModules,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      directories: [...new Set(directories)].sort(),
    },
  };
}
