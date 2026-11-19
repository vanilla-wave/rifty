import { NotImplementedError } from '@riftydev/io';
import type { InstallResult } from '@riftydev/npm-client';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import type { PersistFailureReport, Vfs } from '@riftydev/vfs';
import {
  type PackageAcquisitionAuthority,
  PackageAcquisitionError,
  createPackageAcquisitionAuthority,
} from '../workers/package-acquisition-authority.ts';
import {
  type DepSnapshotV3,
  prepareDepSnapshotRestore,
  fetchDepSnapshot as realFetchDepSnapshot,
} from './dep-snapshot.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from './install-stamp-authority.ts';
import { readPackageJsonText } from './install-stamp.ts';
import { clearProjectTree, prepareProjectInstallTree } from './project-deps.ts';
import type { WorkspaceArchiveFs } from './workspace-archive.ts';

/**
 * Test harness for the package authority's `ensure` command: stamp → snapshot →
 * install over one FIFO; `log` receives raw authority reason codes. Production retired this stamp-miss restore; instant
 * dependencies arrive only by first materialization or explicit apply
 * (ADR-0135 correction 2026-11-17, ADR-0394, ADR-0415).
 */
export type ProjectDepsSource = 'stamp' | 'snapshot' | 'install' | 'none';

export interface EnsureProjectDepsResult {
  readonly source: ProjectDepsSource;
  readonly packages: number;
}

export interface EnsureProjectDepsOptions {
  /** Async surface of the realm's VFS (stamp + package.json reads). */
  readonly vfs: Vfs;
  /** Sync surface of the SAME store (archive restore writes). */
  readonly fsSync: WorkspaceArchiveFs;
  readonly root: string;
  readonly templateId: string;
  /** Expected `templateId` inside the baked snapshot. Defaults to `templateId`. */
  readonly snapshotTemplateId?: string;
  /** Project identity (preset slug) — the install-stamp reuse key. A stamp from
   *  a different slug never suppresses this project's install. */
  readonly slug: string;
  /** Baked snapshot URL; absent → no snapshot restore. */
  readonly snapshotUrl?: string;
  /** Exact manifest this acquisition owns; defaults to the current file. */
  readonly packageJsonText?: string;
  /**
   * Runs the real installer; returns the installed package count. OPTIONAL:
   * omit for a RESTORE-ONLY call (instant preset at owner-seed) — then a stampless,
   * snapshotless tree resolves to `'none'` (deps left absent) instead of a
   * network install. The faithful from-scratch install is the explicit `npm install`
   * command, never a dev-line side effect.
   */
  readonly install?: () => Promise<InstallResult>;
  readonly log: (line: string) => void;
  /** Test seam; defaults to fetch + gunzip + parse. */
  readonly fetchSnapshot?: (url: string) => Promise<DepSnapshotV3 | null>;
  /**
   * Drains the realm's OPFS write-through and reports persist failures
   * (ADR-0187 Corrected). NEVER awaited on the boot critical path — it promotes
   * a PENDING stamp after a clean drain or leaves it untrusted after tree damage.
   * Optional: absent on the memory backend and in restore-only harnesses.
   */
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
  /** One owner-realm FIFO shared with terminal npm. */
  readonly packageAcquisitionAuthority: PackageAcquisitionAuthority;
  /** Clear foreign dependency-owned files after durable demotion. */
  readonly replaceTreeOnMiss?: boolean;
}

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
    // Raw authority reason codes: assertions pin product data, not harness prose.
    observe: (event) => {
      if (event.type === 'snapshot-rejected')
        opts.log(`snapshot-rejected ${event.snapshotId} ${event.reason}\n`);
    },
    adapter: {
      readPackageLock: async (project) => {
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

export async function ensureProjectDependencies(
  opts: EnsureProjectDepsOptions,
): Promise<EnsureProjectDepsResult> {
  const packageJsonText =
    opts.packageJsonText ?? (await readPackageJsonText(opts.vfs, opts.root)) ?? '';
  const authority = opts.packageAcquisitionAuthority;
  try {
    const provenance = await authority.dispatch({
      type: 'ensure',
      project: {
        projectId: opts.slug,
        root: opts.root,
        slug: opts.slug,
        identity: installArtifactIdentity,
      },
      packageJsonText,
      ...(opts.snapshotUrl
        ? {
            snapshotSource: {
              snapshotId: opts.snapshotUrl,
              resolve: () => resolveProjectSnapshot(opts),
            },
          }
        : {}),
      fallback: opts.install ? 'install' : 'snapshot-only',
      replaceTreeOnMiss: opts.replaceTreeOnMiss ?? opts.install !== undefined,
      onPromotion: (result) => {
        if (result.status === 'refused') opts.log(`promotion refused ${result.reason}\n`);
      },
    });

    switch (provenance.outcome) {
      case 'existing':
        return { source: 'stamp', packages: provenance.packages };
      case 'snapshot':
        return { source: 'snapshot', packages: provenance.packages };
      case 'installed':
        return { source: 'install', packages: provenance.packages.length };
    }
  } catch (error) {
    if (
      error instanceof PackageAcquisitionError &&
      error.failure === 'snapshot-unavailable' &&
      !opts.install
    ) {
      return { source: 'none', packages: 0 };
    }
    throw error;
  }
}

async function resolveProjectSnapshot(opts: EnsureProjectDepsOptions) {
  if (!opts.snapshotUrl) {
    return { status: 'rejected' as const, reason: 'snapshot-not-configured' };
  }
  const fetchSnapshot = opts.fetchSnapshot ?? realFetchDepSnapshot;
  const snapshot = await fetchSnapshot(opts.snapshotUrl);
  if (!snapshot) {
    return { status: 'rejected' as const, reason: 'snapshot-unavailable' };
  }
  const expectedSnapshotTemplateId = opts.snapshotTemplateId ?? opts.templateId;
  if (snapshot.templateId !== expectedSnapshotTemplateId) {
    return { status: 'rejected' as const, reason: 'snapshot-template-mismatch' };
  }
  return {
    status: 'candidate' as const,
    snapshot: {
      snapshotId: opts.snapshotUrl,
      identity: snapshot.installArtifactIdentity,
      packageJsonText: snapshot.packageJsonText,
      payload: snapshot,
    },
  };
}
