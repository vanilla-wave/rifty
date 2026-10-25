import { type FsSync, normalizePath, syncMirror } from '@riftydev/vfs';
import {
  type EmnapiCorePatchFormat,
  applyEmnapiCoreOrphanedReferencePatch,
  emnapiCoreOrphanedReferencePatchPolicy,
} from './emnapi-core-install-policy.ts';

export interface PackageInstallOptions {
  readonly root: string;
  readonly fs?: FsSync;
}

export interface InstalledFilePreparation {
  readonly path: string;
  readonly bytes: Uint8Array;
}

interface FinalizerPackage {
  readonly version: string;
  readonly installPath: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Recover exact nested install paths from a verified npm v3 lock snapshot. */
export function finalizerPackagesFromLockfile(lockfile: unknown): readonly FinalizerPackage[] {
  const packages = record(record(lockfile)?.packages);
  if (packages === null) return [];
  const targets: FinalizerPackage[] = [];
  for (const [installPath, value] of Object.entries(packages)) {
    if (!/(?:^|\/)node_modules\/@emnapi\/core$/u.test(installPath)) continue;
    const version = record(value)?.version;
    if (typeof version !== 'string') {
      throw new Error(`@emnapi/core lockfile entry has no exact version: ${installPath}`);
    }
    targets.push({ version, installPath });
  }
  return targets;
}

const emnapiCoreFiles = [
  ['dist/emnapi-core.cjs.js', 'readable'],
  ['dist/emnapi-core.cjs.min.js', 'minified'],
] as const satisfies readonly (readonly [string, EmnapiCorePatchFormat])[];

/** Read-only transformations; publication and source validation share this authority. */
export function planToolchainInstallFiles(
  options: PackageInstallOptions,
): readonly InstalledFilePreparation[] {
  const fs = options.fs ?? syncMirror();
  const changes: InstalledFilePreparation[] = [];
  const lockfilePath = normalizePath(`${options.root}/package-lock.json`);
  const packages = fs.existsSync(lockfilePath)
    ? finalizerPackagesFromLockfile(
        JSON.parse(new TextDecoder().decode(fs.readFileBytesSync(lockfilePath))),
      )
    : [];
  for (const pkg of packages) {
    if (pkg.version !== emnapiCoreOrphanedReferencePatchPolicy.version) continue;
    const packageRoot = normalizePath(`${options.root}/${pkg.installPath}`);
    for (const [relativePath, format] of emnapiCoreFiles) {
      const path = `${packageRoot}/${relativePath}`;
      if (!fs.existsSync(path)) {
        throw new Error(`@emnapi/core patch failed: missing installed file ${path}`);
      }
      const source = new TextDecoder().decode(fs.readFileBytesSync(path));
      const prepared = applyEmnapiCoreOrphanedReferencePatch(source, format);
      if (prepared !== source) changes.push({ path, bytes: new TextEncoder().encode(prepared) });
    }
  }
  return changes;
}

/** Vite-independent installed-tree mutations shared by all project kinds. */
export function finalizeToolchainInstallFiles(options: PackageInstallOptions): void {
  const fs = options.fs ?? syncMirror();
  for (const change of planToolchainInstallFiles({ ...options, fs }))
    fs.writeFileSync(change.path, change.bytes);
}
