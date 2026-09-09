import {
  type InstalledFilePreparation,
  planInstalledConsumerFiles,
  planToolchainInstallFiles,
} from '@riftydev/shadow-registry/runtime';
import { syncMirror } from '@riftydev/vfs';
import type { GenericPackageInstallFinalizerOptions } from './package-install-generic-finalizer.ts';

export { finalizerPackagesFromLockfile } from './package-install-generic-finalizer.ts';

export type PackageInstallFinalizerOptions = GenericPackageInstallFinalizerOptions;

/** The same installed-file recipe governs publication, restoration and source admission. */
export function planPackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): readonly InstalledFilePreparation[] {
  const fs = options.fs ?? syncMirror();
  return [
    ...planToolchainInstallFiles({ root: options.root, fs }),
    ...planInstalledConsumerFiles(options.root, undefined, fs),
  ];
}

/** Complete installed-tree mutations before the acquisition adapter returns for promotion. */
export async function finalizePackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): Promise<void> {
  options.seedTemplateFiles?.();
  const fs = options.fs ?? syncMirror();
  for (const change of planPackageInstallFiles({ ...options, fs }))
    fs.writeFileSync(change.path, change.bytes);
}
