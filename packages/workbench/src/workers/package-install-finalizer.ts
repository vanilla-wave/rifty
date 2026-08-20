import { normalizePath, syncMirror } from '@riftydev/vfs';
import {
  type EmnapiCorePatchFormat,
  applyEmnapiCoreOrphanedReferencePatch,
  emnapiCoreOrphanedReferencePatchPolicy,
} from './emnapi-core-install-policy.ts';
import { prepareViteCliAcquisitionFiles } from './vite-cli-prep.ts';

export interface PackageInstallFinalizerOptions {
  readonly root: string;
  /** Acquisition-owned mutation; caller executes inside the package FIFO. */
  readonly seedTemplateFiles?: () => void;
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

function patchEmnapiCoreCopies(options: PackageInstallFinalizerOptions): void {
  const fs = syncMirror();
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
      if (prepared !== source) fs.writeFileSync(path, new TextEncoder().encode(prepared));
    }
  }
}

/** Complete installed-tree mutations before the acquisition adapter returns for promotion. */
export async function finalizePackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): Promise<void> {
  options.seedTemplateFiles?.();
  patchEmnapiCoreCopies(options);
  await prepareViteCliAcquisitionFiles(options.root);
}
