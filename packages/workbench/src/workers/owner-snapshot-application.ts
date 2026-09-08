import { prepareDepSnapshotApplication } from '../glue/dep-snapshot-application.ts';
import type { DepSnapshotV3 } from '../glue/dep-snapshot.ts';
import { discoverPackageMutationTransitions } from '../glue/package-mutation-executor.ts';
import type { OwnerPackageConfig, OwnerPackageStateOptions } from './owner-package-types.ts';
import type {
  PackageAcquisitionAdapter,
  SnapshotApplicationPlan,
} from './package-acquisition-types.ts';

export async function planOwnerSnapshotApplication(
  options: Pick<OwnerPackageStateOptions, 'fsSync' | 'flush'>,
  input: Parameters<NonNullable<PackageAcquisitionAdapter['planSnapshotApplication']>>[0],
): Promise<SnapshotApplicationPlan> {
  const payload = input.snapshot.payload as DepSnapshotV3 | undefined;
  if (payload === undefined) throw new Error('Snapshot application payload missing');
  const plan = await prepareDepSnapshotApplication(options.fsSync, input.project.root, payload, {
    conflict: input.conflict,
    ...(input.preflightRoot === undefined ? {} : { preflightRoot: input.preflightRoot }),
    flush: options.flush,
  });
  return {
    ...plan,
    transitions: discoverPackageMutationTransitions(
      options.fsSync,
      input.knownProjects,
      plan.intents,
    ),
  };
}

export function snapshotManifestConfig(
  config: OwnerPackageConfig,
  packageJsonText: string,
): OwnerPackageConfig {
  const manifest = JSON.parse(packageJsonText) as {
    readonly name?: unknown;
    readonly version?: unknown;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  return Object.freeze({
    ...config,
    cfg: Object.freeze({
      ...config.cfg,
      packageJson: packageJsonText,
      packageName:
        typeof manifest.name === 'string' && manifest.name.length > 0
          ? manifest.name
          : `rifty-workbench-${config.slug}`,
      packageVersion:
        typeof manifest.version === 'string' && manifest.version.length > 0
          ? manifest.version
          : '0.0.0',
      installDeps: Object.freeze({ ...manifest.dependencies }),
    }),
  });
}
