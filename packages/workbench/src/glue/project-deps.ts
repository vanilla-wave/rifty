/**
 * Dependency arrival for a real-project boot (ADR-0135), in priority order:
 *
 *   1. **stamp** — a tree stamped for THIS project `slug` already sits in OPFS
 *      (reuse is keyed on the slug, not the deps: two projects can share deps
 *      yet must not reuse each other's tree) → do nothing;
 *   2. **snapshot** — a baked asset matching the template AND the current
 *      package.json deps → restore it (no network, no resolver);
 *   3. **install** — clear any foreign node_modules + lockfile (a prior preset's
 *      tree poisons a from-scratch install — EBROKENLOCK), then real `install()`
 *      through the registry.
 *
 * from-scratch presets pass no `snapshotUrl`, so on a slug miss they run the
 * visible install (never a silent snapshot restore). Because the slug differs
 * from the instant default that shares the same template, a from-scratch preset
 * shows its install even when OPFS was already warmed by an instant preset.
 *
 * Paths 2 and 3 finish by stamping the tree. On OPFS, boot/restore first writes
 * a PENDING stamp (visible but untrusted), then a fire-and-forget drain promotes
 * it to a trusted stamp only after the tree is clean. A dirty proof leaves the
 * claim pending and untrusted. The dev line never waits; a reload before
 * promotion just re-runs dependency arrival. Any snapshot
 * failure — fetch, deps drift, restore — degrades to install; a broken asset
 * never bricks the boot. Extracted from the worker bootstrap so the priority
 * logic is unit-testable outside a worker realm.
 */
import type { InstallResult } from '@riftydev/npm-client';
import {
  type PersistFailureReport,
  type Vfs,
  type VfsMutationIntent,
  dirname,
  joinPath,
  normalizePath,
} from '@riftydev/vfs';
import {
  type PackageAcquisitionAuthority,
  PackageAcquisitionError,
} from '../workers/package-acquisition-authority.ts';
import { type DepSnapshotV3, fetchDepSnapshot as realFetchDepSnapshot } from './dep-snapshot.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import type { InstallStampPromotionResult } from './install-stamp-authority.ts';
import { isStampedTreeDamage, readPackageJsonText } from './install-stamp.ts';
import { isSegmentContained } from './project-seed-paths.ts';
import type { WorkspaceArchiveFs } from './workspace-archive.ts';

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
      onPromotion: (result) => reportPromotion(opts, result),
    });

    switch (provenance.outcome) {
      case 'existing':
        opts.log(
          `[real-vite/worker] node_modules reused via install stamp (${provenance.packages} packages, install skipped)\n`,
        );
        return { source: 'stamp', packages: provenance.packages };
      case 'snapshot':
        opts.log(
          `[real-vite/worker] baked node_modules restored (${provenance.packages} packages, no install needed)\n`,
        );
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
      reportSnapshotFailures(opts, error.snapshotFailures);
      return { source: 'none', packages: 0 };
    }
    throw error;
  }
}

/** Drop a foreign/stale node_modules + lockfile so a from-scratch install starts
 *  clean (best-effort: a fresh boot has nothing to remove). */
export function clearProjectTree(fsSync: WorkspaceArchiveFs, root: string): void {
  fsSync.rmSync(joinPath(root, 'node_modules'), { recursive: true, force: true });
  fsSync.rmSync(joinPath(root, 'package-lock.json'), { force: true });
}

export interface PrepareProjectInstallTreeOptions {
  /** Optional owned manifest replacement; omit when the live project owns package.json. */
  readonly packageJsonText?: string;
  readonly currentSlug: string;
  readonly priorSlug?: string;
  readonly priorTrustedTree: boolean;
}

/** Keep a covering lock for the same project; foreign claims own neither tree nor lock. */
export function prepareProjectInstallTree(
  fsSync: WorkspaceArchiveFs,
  root: string,
  opts: PrepareProjectInstallTreeOptions,
): void {
  if (opts.priorTrustedTree) return;
  fsSync.rmSync(joinPath(root, 'node_modules'), { recursive: true, force: true });
  if (opts.priorSlug !== undefined && opts.priorSlug !== opts.currentSlug) {
    fsSync.rmSync(joinPath(root, 'package-lock.json'), { force: true });
  }
  if (opts.packageJsonText !== undefined) {
    const packageJsonPath = joinPath(root, 'package.json');
    const expectedPackageJson = new TextEncoder().encode(opts.packageJsonText);
    const currentPackageJson = fsSync.existsSync(packageJsonPath)
      ? fsSync.readFileBytesSync(packageJsonPath)
      : undefined;
    if (
      currentPackageJson === undefined ||
      currentPackageJson.byteLength !== expectedPackageJson.byteLength ||
      currentPackageJson.some((byte, index) => byte !== expectedPackageJson[index])
    ) {
      fsSync.writeFileSync(packageJsonPath, expectedPackageJson);
    }
  }
}

function isTemplateNodeModulesFile(root: string, path: string): boolean {
  const nodeModules = normalizePath(`${root}/node_modules`);
  const normalized = normalizePath(path);
  return normalized !== nodeModules && isSegmentContained(normalized, nodeModules);
}

/** Exact missing template-owned files; sample only at the package FIFO head. */
export function templateNodeModulesSeedMutationIntents(
  fsSync: Pick<WorkspaceArchiveFs, 'existsSync'>,
  root: string,
  seedFiles: Readonly<Record<string, string | Uint8Array>>,
): readonly VfsMutationIntent[] {
  return [...new Set(Object.keys(seedFiles).map((path) => normalizePath(path)))]
    .filter((path) => isTemplateNodeModulesFile(root, path) && !fsSync.existsSync(path))
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ kind: 'write', path }));
}

/** Materialize template-owned declaration packages inside an active claim. */
export function seedTemplateNodeModulesFiles(
  fsSync: WorkspaceArchiveFs,
  root: string,
  seedFiles: Readonly<Record<string, string | Uint8Array>>,
): void {
  const encoder = new TextEncoder();
  for (const [path, content] of Object.entries(seedFiles)) {
    const normalized = normalizePath(path);
    if (!isTemplateNodeModulesFile(root, normalized)) continue;
    fsSync.mkdirSync(dirname(normalized), { recursive: true });
    if (!fsSync.existsSync(normalized)) {
      fsSync.writeFileSync(
        normalized,
        typeof content === 'string' ? encoder.encode(content) : content.slice(),
      );
    }
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

function reportSnapshotFailures(
  opts: EnsureProjectDepsOptions,
  failures: readonly { readonly snapshotId: string; readonly reason: string }[],
): void {
  if (failures.length === 0) return;
  // The lifetime authority may use a different observer; keep restore-only failure loud here.
  for (const failure of failures) reportSnapshotFailure(opts, failure.snapshotId, failure.reason);
}

function reportSnapshotFailure(
  opts: EnsureProjectDepsOptions,
  snapshotId: string,
  reason: string,
): void {
  const outcome = opts.install
    ? ' — falling back to install\n'
    : ' — dependencies remain absent (restore-only mode)\n';
  if (reason === 'snapshot-unavailable') {
    opts.log(`[real-vite/worker] baked snapshot unavailable (${snapshotId})${outcome}`);
    return;
  }
  if (reason.startsWith('snapshot-fetch-failed:')) {
    const detail = reason.slice('snapshot-fetch-failed:'.length).trim();
    opts.log(`[real-vite/worker] baked snapshot unavailable (${snapshotId}): ${detail}${outcome}`);
    return;
  }
  if (reason.startsWith('snapshot-restore-failed:')) {
    opts.log(
      `[real-vite/worker] baked snapshot restore failed: ${reason.slice('snapshot-restore-failed:'.length).trim()}${outcome}`,
    );
    return;
  }
  opts.log(
    `[real-vite/worker] baked snapshot is stale (package.json or install artifacts drifted; re-run \`pnpm snapshots:bake\`)${outcome}`,
  );
}

function reportPromotion(
  opts: EnsureProjectDepsOptions,
  result: InstallStampPromotionResult,
): void {
  if (result.status === 'trusted' || result.status === 'stale') return;
  switch (result.reason) {
    case 'guarded-scope-not-durable': {
      const example = result.report?.failures.find((failure) =>
        isStampedTreeDamage(failure.path, opts.root),
      );
      const sample = example ? ` (first: ${example.op} ${example.path}: ${example.message})` : '';
      opts.log(
        `[real-vite/worker] WARNING: node_modules failed to persist${sample} — trusted stamp publication blocked; the pending claim remains untrusted and the next boot re-runs dependency arrival\n`,
      );
      return;
    }
    case 'claim-not-durable':
      opts.log(
        '[real-vite/worker] WARNING: pending install stamp failed to persist — promotion skipped; the next boot re-runs dependency arrival\n',
      );
      return;
    case 'identity-drift':
      opts.log(
        '[real-vite/worker] WARNING: package.json deps changed before install stamp promotion — trusted stamp publication blocked; the pending claim remains untrusted and the next boot re-runs dependency arrival\n',
      );
      return;
    case 'tree-missing':
      opts.log(
        '[real-vite/worker] WARNING: node_modules vanished before install stamp promotion — the next boot re-runs dependency arrival\n',
      );
      return;
    case 'claim-replaced':
      opts.log(
        '[real-vite/worker] WARNING: install stamp claim was replaced before promotion — the next boot re-runs dependency arrival\n',
      );
      return;
    case 'revocation-not-durable':
      opts.log(
        '[real-vite/worker] CRITICAL: a trusted install stamp over a damaged tree could not be revoked durably; reload is unsafe until browser storage recovers\n',
      );
      return;
    case 'flush-failed':
    case 'write-failed':
      opts.log(
        `[real-vite/worker] WARNING: stamp durability check failed: ${result.error ?? result.reason}\n`,
      );
  }
}
