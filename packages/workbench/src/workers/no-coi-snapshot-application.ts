import {
  type SnapshotProgress,
  type ToolchainApplySnapshotRequest,
  checkedRuntimeFsFlush,
} from '@riftydev/runtime-js/internal';
import type { FsSync, PersistFailureReport } from '@riftydev/vfs';
import { prepareDepSnapshotApplication } from '../glue/dep-snapshot-application.ts';
import {
  fetchVerifiedDepSnapshot,
  prepareDepSnapshotForRuntimeTier,
} from '../glue/dep-snapshot.ts';
import {
  installArtifactIdentity,
  installArtifactIdentityForTier,
} from '../glue/install-artifact-identity.ts';

/** Explicit operation only; no saved-install certificate or automatic acquisition. */
export async function applyNoCoiSnapshot(
  input: ToolchainApplySnapshotRequest,
  options: {
    readonly fs: FsSync;
    readonly flush: (
      onProgress?: (counts: { persisted: number; total: number }) => void,
    ) => Promise<PersistFailureReport | undefined>;
    readonly onProgress?: (progress: SnapshotProgress) => void;
  },
) {
  const verified = await fetchVerifiedDepSnapshot(
    input.snapshot.assetUrl,
    input.snapshot.snapshotId,
    (bytes, total) =>
      options.onProgress?.({ phase: 'fetch', bytes, ...(total === undefined ? {} : { total }) }),
  );
  if (verified.status !== 'matched') throw mismatch('identity');
  const source = verified.snapshot;
  if (source.templateId !== input.snapshot.templateId) throw mismatch('template');
  if (
    source.installArtifactIdentity !== installArtifactIdentity &&
    source.installArtifactIdentity !== installArtifactIdentityForTier('coi')
  )
    throw mismatch('runtime compatibility');
  const snapshot = await prepareDepSnapshotForRuntimeTier(source, 'no-coi');
  const plan = await prepareDepSnapshotApplication(options.fs, input.cwd, snapshot, {
    runtimeTier: 'no-coi',
    conflict: input.force === true ? 'overwrite' : 'error',
    onProgress: (written, total) => options.onProgress?.({ phase: 'entries', written, total }),
    flush: async () => {
      await checkedRuntimeFsFlush(() =>
        options.flush((counts) => options.onProgress?.({ phase: 'flush-cache', ...counts })),
      );
      return undefined;
    },
  });
  await plan.prepareCache();
  await plan.apply();
  await checkedRuntimeFsFlush(() =>
    options.flush((counts) => options.onProgress?.({ phase: 'flush-payload', ...counts })),
  );
  return Object.freeze(
    plan.shadowPlan.bindings.map((binding) =>
      Object.freeze({
        adapterId: binding.adapterId,
        packagePath: `${input.cwd}/${binding.packagePath}`,
      }),
    ),
  );
}

function mismatch(reason: string): Error {
  return Object.assign(new Error(`Dependency snapshot ${reason} mismatch`), {
    name: 'SandboxSnapshotMismatchError',
  });
}
