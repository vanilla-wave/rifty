import { finalizeToolchainInstallFiles } from '@riftydev/shadow-registry/runtime';
export { finalizerPackagesFromLockfile } from '@riftydev/shadow-registry/runtime';
export interface GenericPackageInstallFinalizerOptions {
  readonly root: string;
  readonly seedTemplateFiles?: () => void;
}
export function finalizeGenericPackageInstallFiles(
  options: GenericPackageInstallFinalizerOptions,
): void {
  options.seedTemplateFiles?.();
  finalizeToolchainInstallFiles(options);
}
