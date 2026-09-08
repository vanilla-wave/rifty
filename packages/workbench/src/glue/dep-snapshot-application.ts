import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import type { PersistFailureReport } from '@riftydev/vfs';
import { type DepSnapshotV3, verifyDepSnapshotReplayCache } from './dep-snapshot.ts';
import {
  type WorkspaceOverlayFs,
  prepareWorkspaceArchiveOverlay,
} from './workspace-archive-overlay.ts';
import { decodeWorkspaceArchive, prepareWorkspaceArchiveImport } from './workspace-archive.ts';

function encodedText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** Full producer validation/preflight has no filesystem or install-claim effects. */
export async function prepareDepSnapshotApplication(
  fs: WorkspaceOverlayFs,
  root: string,
  snapshot: DepSnapshotV3,
  options: {
    readonly conflict: 'error' | 'overwrite';
    readonly preflightRoot?: string;
    readonly flush: () => Promise<PersistFailureReport | undefined>;
  },
) {
  await verifyDepSnapshotReplayCache(snapshot);
  const project = decodeWorkspaceArchive(
    {
      version: 1,
      root: '/workspace',
      files: [
        {
          path: 'package.json',
          encoding: 'base64',
          content: encodedText(snapshot.packageJsonText),
        },
        { path: 'package-lock.json', encoding: 'base64', content: encodedText(snapshot.lockfile) },
      ],
      directories: ['node_modules'],
    },
    { root, rebase: true },
  );
  // Validate original legacy schema/paths before composing disjoint decoded namespaces.
  const nodeModules = decodeWorkspaceArchive(snapshot.nodeModules, {
    root: `${project.root}/node_modules`,
    rebase: true,
  });
  const overlay = prepareWorkspaceArchiveOverlay(
    fs,
    {
      root: project.root,
      files: [...project.files, ...nodeModules.files],
      directories: [...project.directories, ...nodeModules.directories],
    },
    options,
  );
  const cache = prepareWorkspaceArchiveImport(fs, snapshot.tarballCache, {
    root: TARBALL_CACHE_ROOT,
    replace: false,
  });
  const shadowPlan = planShadowSubstitutionsFromLockfile(
    snapshot.lockfile.length === 0
      ? { lockfileVersion: 3, packages: {} }
      : (JSON.parse(snapshot.lockfile) as unknown),
  );
  return {
    packages: snapshot.packages,
    packageJsonText: snapshot.packageJsonText,
    shadowPlan,
    intents: overlay.intents,
    async prepareCache() {
      cache.apply();
      const report = await options.flush();
      if (report !== undefined && report.total > 0)
        throw new Error('Snapshot replay cache persistence failed');
    },
    async apply() {
      overlay.apply();
    },
  };
}
