import { NotImplementedError } from '@riftydev/io';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import {
  type PackageAcquisitionAuthority,
  createPackageAcquisitionAuthority,
} from '../workers/package-acquisition-authority.ts';
import { type DepSnapshotV3, prepareDepSnapshotRestore } from './dep-snapshot.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from './install-stamp-authority.ts';
import { readPackageJsonText } from './install-stamp.ts';
import {
  type EnsureProjectDepsOptions,
  clearProjectTree,
  prepareProjectInstallTree,
} from './project-deps.ts';

export type TestEnsureProjectDepsOptions = Omit<
  EnsureProjectDepsOptions,
  'packageAcquisitionAuthority'
> & {
  readonly packageAcquisitionAuthority?: PackageAcquisitionAuthority;
  readonly installStampAuthority?: InstallStampAuthority;
};

/** Focused unit owner. Production injects the Workbench lifetime authority. */
export function createTestProjectPackageAcquisitionAuthority(
  opts: TestEnsureProjectDepsOptions,
): PackageAcquisitionAuthority {
  const stamps =
    opts.installStampAuthority ??
    createInstallStampAuthority({ vfs: opts.vfs, fsSync: opts.fsSync });
  return createPackageAcquisitionAuthority({
    stamps,
    ...(opts.flush ? { stampTransition: { flush: opts.flush } } : {}),
    observe: (event) => {
      if (event.type !== 'snapshot-rejected') return;
      const outcome = opts.install
        ? ' — falling back to install\n'
        : ' — dependencies remain absent (restore-only mode)\n';
      if (event.reason === 'snapshot-unavailable') {
        opts.log(`[real-vite/worker] baked snapshot unavailable (${event.snapshotId})${outcome}`);
      } else if (event.reason.startsWith('snapshot-fetch-failed:')) {
        opts.log(
          `[real-vite/worker] baked snapshot unavailable (${event.snapshotId}): ${event.reason
            .slice('snapshot-fetch-failed:'.length)
            .trim()}${outcome}`,
        );
      } else {
        opts.log(
          `[real-vite/worker] baked snapshot is stale (package.json or install artifacts drifted; re-run \`pnpm snapshots:bake\`)${outcome}`,
        );
      }
    },
    adapter: {
      readTrustedPackageLock: async (project) => {
        const path = `${project.root}/package-lock.json`;
        if (!(await opts.vfs.exists(path))) return { lockfileVersion: 3, packages: {} };
        return JSON.parse(await opts.vfs.readFileText(path)) as unknown;
      },
      prepareEnsure: async (command, execution) => {
        if (!command.replaceTreeOnMiss) return;
        if (execution.phase === 'snapshot-rejected') {
          clearProjectTree(opts.fsSync, command.project.root);
          opts.fsSync.writeFileSync(
            `${command.project.root}/package.json`,
            new TextEncoder().encode(command.packageJsonText),
          );
          return;
        }
        prepareProjectInstallTree(opts.fsSync, command.project.root, {
          packageJsonText: command.packageJsonText,
          currentSlug: command.project.slug,
          ...(execution.claim.priorSlug ? { priorSlug: execution.claim.priorSlug } : {}),
          priorTrustedTree: false,
        });
      },
      planSnapshotRestore: async ({ project, snapshot }) => {
        try {
          const payload = snapshot.payload as DepSnapshotV3;
          const prepared = await prepareDepSnapshotRestore(opts.fsSync, project.root, payload);
          const lockfile =
            payload.lockfile.length === 0
              ? { lockfileVersion: 3, packages: {} }
              : (JSON.parse(payload.lockfile) as unknown);
          return {
            status: 'ready',
            packages: payload.packages,
            shadowPlan: planShadowSubstitutionsFromLockfile(lockfile),
            apply: async () => prepared.apply(),
          };
        } catch (error) {
          return {
            status: 'rejected',
            reason: `snapshot-restore-plan-failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      },
      install: async (request) => {
        if (request.type !== 'ensure' || !opts.install) {
          throw new NotImplementedError('package-acquisition.project-install');
        }
        const result = await opts.install();
        return {
          result,
          shadowPlan: planShadowSubstitutionsFromLockfile(result.lockfile),
          packageJsonText: await readPackageJsonText(opts.vfs, request.project.root),
        };
      },
      reset: async () => {
        throw new NotImplementedError('package-acquisition.reset');
      },
      switchProject: async () => {
        throw new NotImplementedError('package-acquisition.project-switch');
      },
    },
  });
}
