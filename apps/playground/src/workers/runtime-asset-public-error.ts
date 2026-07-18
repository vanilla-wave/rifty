import { ShadowAssetError } from '@riftydev/npm-client';
import {
  RuntimeAssetError,
  type SerializedWorkbenchOwnerError,
  serializeWorkbenchOwnerError,
} from '../workbench/errors.ts';
import { PackageTreeUnattestedError } from './package-tree-unattested-error.ts';

/** Owner-only nominal projection. Internal evidence never enters page or PTY diagnostics. */
export function runtimeAssetPublicError(error: unknown): RuntimeAssetError | null {
  if (error instanceof RuntimeAssetError) return error;
  if (error instanceof ShadowAssetError) {
    return new RuntimeAssetError({
      phase: error.phase,
      recovery: error.recovery,
      requiredSetDigest: error.requiredSetDigest,
      ...(error.assetId === undefined ? {} : { assetId: error.assetId }),
      ...(error.usedBytes === undefined ? {} : { usedBytes: error.usedBytes }),
      ...(error.requiredBytes === undefined ? {} : { requiredBytes: error.requiredBytes }),
    });
  }
  if (error instanceof PackageTreeUnattestedError) {
    return new RuntimeAssetError({ phase: 'ready', recovery: 'retry' });
  }
  return null;
}

export function serializeRuntimeAssetOwnerError(error: unknown): SerializedWorkbenchOwnerError {
  return serializeWorkbenchOwnerError(runtimeAssetPublicError(error) ?? error);
}
