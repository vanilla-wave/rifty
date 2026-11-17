/**
 * Project package-tree helpers shared by the owner package adapter: foreign-tree
 * clearing before install and template-owned node_modules seeding. Dependency
 * arrival itself is the package acquisition authority's: first materialization
 * (snapshot restore or deferred install, ADR-0394) and explicit npm install.
 * A saved open never restores a snapshot (ADR-0415).
 */
import { type VfsMutationIntent, dirname, joinPath, normalizePath } from '@riftydev/vfs';
import { isSegmentContained } from './project-seed-paths.ts';
import type { WorkspaceArchiveFs } from './workspace-archive.ts';

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
