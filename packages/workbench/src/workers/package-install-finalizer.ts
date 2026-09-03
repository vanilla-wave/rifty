import {
  type GenericPackageInstallFinalizerOptions,
  finalizeGenericPackageInstallFiles,
} from './package-install-generic-finalizer.ts';
import { prepareViteCliAcquisitionFiles } from './vite-cli-prep.ts';

export { finalizerPackagesFromLockfile } from './package-install-generic-finalizer.ts';

export type PackageInstallFinalizerOptions = GenericPackageInstallFinalizerOptions;

/** Complete installed-tree mutations before the acquisition adapter returns for promotion. */
export async function finalizePackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): Promise<void> {
  finalizeGenericPackageInstallFiles(options);
  await prepareViteCliAcquisitionFiles(options.root);
}
