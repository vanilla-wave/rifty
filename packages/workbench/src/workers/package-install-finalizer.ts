import { prepareViteCliAcquisitionFiles } from './vite-cli-prep.ts';

export interface PackageInstallFinalizerOptions {
  readonly root: string;
  /** Acquisition-owned mutation; caller executes inside the package FIFO. */
  readonly seedTemplateFiles?: () => void;
}

/** Complete installed-tree mutations before the acquisition adapter returns for promotion. */
export async function finalizePackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): Promise<void> {
  options.seedTemplateFiles?.();
  await prepareViteCliAcquisitionFiles(options.root);
}
