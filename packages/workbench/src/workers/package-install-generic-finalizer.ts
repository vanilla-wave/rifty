import { finalizeToolchainInstallFiles } from '@riftydev/shadow-registry/runtime';
import type { FsSync } from '@riftydev/vfs';
export { finalizerPackagesFromLockfile } from '@riftydev/shadow-registry/runtime';
export interface GenericPackageInstallFinalizerOptions {
  readonly root: string;
  readonly fs?: FsSync;
  readonly seedTemplateFiles?: () => void;
}
export function finalizeGenericPackageInstallFiles(
  options: GenericPackageInstallFinalizerOptions,
): void {
  options.seedTemplateFiles?.();
  finalizeToolchainInstallFiles(options);
}
