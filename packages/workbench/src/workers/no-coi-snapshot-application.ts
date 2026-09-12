import type { ToolchainApplySnapshotRequest } from '@riftydev/runtime-js/internal';
import type { FsSync, PersistFailureReport } from '@riftydev/vfs';
import { prepareDepSnapshotApplication } from '../glue/dep-snapshot-application.ts';
import { fetchVerifiedDepSnapshot } from '../glue/dep-snapshot.ts';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';

/** Explicit operation only; no saved-install certificate or automatic acquisition. */
export async function applyNoCoiSnapshot(
  input: ToolchainApplySnapshotRequest,
  options: {
    readonly fs: FsSync;
    readonly flush: () => Promise<PersistFailureReport | undefined>;
  },
) {
  const verified = await fetchVerifiedDepSnapshot(
    input.snapshot.assetUrl,
    input.snapshot.snapshotId,
  );
  if (verified.status !== 'matched') throw new Error('Dependency snapshot identity mismatch');
  const snapshot = verified.snapshot;
  if (snapshot.templateId !== input.snapshot.templateId)
    throw new Error('Dependency snapshot template mismatch');
  if (snapshot.installArtifactIdentity !== installArtifactIdentity)
    throw new Error('Dependency snapshot runtime compatibility mismatch');
  const plan = await prepareDepSnapshotApplication(options.fs, input.cwd, snapshot, {
    conflict: input.force === true ? 'overwrite' : 'error',
    flush: options.flush,
  });
  await plan.prepareCache();
  await plan.apply();
  const report = await options.flush();
  if (report !== undefined && report.total > 0)
    throw new Error('Snapshot payload persistence failed');
  return Object.freeze(
    plan.shadowPlan.bindings.map((binding) =>
      Object.freeze({
        adapterId: binding.adapterId,
        packagePath: `${input.cwd}/${binding.packagePath}`,
      }),
    ),
  );
}
