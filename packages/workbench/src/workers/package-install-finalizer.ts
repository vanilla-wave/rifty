import { prepareInstalledConsumerFiles } from '@riftydev/shadow-registry/runtime';
import {
  type GenericPackageInstallFinalizerOptions,
  finalizeGenericPackageInstallFiles,
} from './package-install-generic-finalizer.ts';

export { finalizerPackagesFromLockfile } from './package-install-generic-finalizer.ts';

export type PackageInstallFinalizerOptions = GenericPackageInstallFinalizerOptions;

/** Complete installed-tree mutations before the acquisition adapter returns for promotion. */
export async function finalizePackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): Promise<void> {
  finalizeGenericPackageInstallFiles(options);
  await prepareInstalledConsumerFiles(options.root);
}
