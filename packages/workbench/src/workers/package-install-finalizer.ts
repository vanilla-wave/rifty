import type { ShadowAssetInstallError } from '@riftydev/npm-client';
import { prepareViteCliAcquisitionFiles } from './vite-cli-prep.ts';

export interface PackageInstallFinalizerOptions {
  readonly root: string;
  /** Acquisition-owned mutation; caller executes inside the package FIFO. */
  readonly seedTemplateFiles?: () => void;
}

type FinalizablePackageInstallResult =
  | Readonly<{ status: 'not-required' }>
  | Readonly<{ status: 'post-tree-failure'; error: ShadowAssetInstallError }>
  | Readonly<{ status?: 'installed' }>;

const POST_TREE_FINALIZATION_FAILURE_MESSAGE =
  'runtime-asset failure and package-tree finalization both failed';

class PostTreePackageFinalizationFailure extends AggregateError {
  constructor(assetError: ShadowAssetInstallError, finalizerError: unknown) {
    super([assetError, finalizerError], POST_TREE_FINALIZATION_FAILURE_MESSAGE);
    this.name = 'AggregateError';
  }
}

/** One causal pair: npm wrote the tree, then its acquisition finalizer also failed. */
export function postTreePackageFinalizationFailure(
  assetError: ShadowAssetInstallError,
  finalizerError: unknown,
): AggregateError {
  return new PostTreePackageFinalizationFailure(assetError, finalizerError);
}

export function isPostTreePackageFinalizationFailure(error: unknown): error is AggregateError {
  return error instanceof PostTreePackageFinalizationFailure;
}

/** Complete installed-tree mutations before the acquisition adapter returns for promotion. */
export async function finalizePackageInstallFiles(
  options: PackageInstallFinalizerOptions,
): Promise<void> {
  options.seedTemplateFiles?.();
  await prepareViteCliAcquisitionFiles(options.root);
}

/** Typed adapter commit: all final tree writes, plus exact post-tree causal failure. */
export async function finalizePackageInstallResult<T extends FinalizablePackageInstallResult>(
  installed: T,
  options: PackageInstallFinalizerOptions,
): Promise<T> {
  if (installed.status === 'not-required') return installed;
  try {
    await finalizePackageInstallFiles(options);
  } catch (finalizerError) {
    if (installed.status === 'post-tree-failure') {
      throw postTreePackageFinalizationFailure(installed.error, finalizerError);
    }
    throw finalizerError;
  }
  return installed;
}
