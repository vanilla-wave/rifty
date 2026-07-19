export { matchesRange, pickBestVersion, compare, parse } from './semver.ts';
export {
  RegistryClient,
  getRegistryBaseUrl,
  type Packument,
  type RegistryClientOptions,
  type VersionManifest,
  type Fetcher,
} from './registry.ts';
export { extractTarGz, parseTarEntries } from './unpacker.ts';
export {
  EDDY_BUNDLE_FORMAT,
  // Fixed member names, exported so eddy's durable store validates the SAME
  // container layout the client streams (no cross-package string drift).
  LOCKFILE_FILE,
  MANIFEST_FILE,
  packEddyBundle,
  unpackEddyBundle,
  type EddyBundleContents,
  type EddyBundleManifestV1,
  type EddyBundleSource,
  type EddyBundleTarballEntry,
  type UnpackedEddyBundleContents,
} from './eddy-bundle.ts';
export {
  startEddyPrefetch,
  type EddyPrefetchHandle,
  type StartEddyPrefetchOptions,
} from './eddy-prefetch.ts';
export {
  resolveEddyClosure,
  type EddyClosureSummary,
  type ResolveEddyClosureOptions,
} from './eddy-revalidate.ts';
export {
  bundleUrlFor,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
  // One wire-protocol home for the durable-store proof header — the server
  // sets it, the client gates learning on it (no cross-package string drift,
  // same rationale as MANIFEST_FILE/LOCKFILE_FILE above).
  EDDY_STORE_DURABLE_HEADER,
  type EddyRequestBody,
} from './eddy-request.ts';
export { link, buildLockfile, type ResolvedPackage, type Lockfile } from './linker.ts';
export { closureHashOf, canonicalClosureJson } from './closure-hash.ts';
export { serializePackageJson } from './package-json.ts';
// The bundle-adoption completeness gate, shared so eddy's durable store
// validates objects EXACTLY as strictly as the client adopts them (a store
// hit a client would reject must read as a miss and self-heal).
export { bundleCompletenessGap } from './installer-lockfile-reader.ts';
export { resolveOverride, type OverrideMap, type ResolvedOverrideTarget } from './overrides.ts';
export {
  install,
  type InstallAcquisitionProvenance,
  type InstallOptions,
  type InstallPackageProvenance,
  type InstallProgressEvent,
  type InstallResolution,
  type InstallResult,
  type InstallTreeResult,
  type PackageTransport,
  type PackumentCacheLike,
} from './installer.ts';
export {
  EMPTY_SHADOW_ASSET_PLAN,
  planBuiltinShadowAssets,
  type AppliedShadowSubstitution,
  type ShadowAssetDescriptor,
  type ShadowAssetPlan,
  type ShadowAssetSourceDescriptor,
} from './shadow-asset-plan.ts';
export { shadowAssetPlanFromLockfileBytes } from './shadow-asset-lockfile-facts.ts';
export {
  SHADOW_ASSET_MAX_READ_DEADLINE_MS,
  ShadowAssetError,
  ShadowAssetInstallError,
  ShadowAssetReadError,
  ShadowAssetStoreError,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  createStandardShadowAssetSource,
  type ShadowAssetAdmin,
  type ShadowAssetEnsureOptions,
  type ShadowAssetEnsureResult,
  type ShadowAssetFailure,
  type ShadowAssetFailurePhase,
  type ShadowAssetInstaller,
  type ShadowAssetManager,
  type ShadowAssetProgress,
  type ShadowAssetReadFailure,
  type ShadowAssetReadFailureReason,
  type ShadowAssetReadOptions,
  type ShadowAssetReadyReceipt,
  type ShadowAssetRuntimeReader,
  type ShadowAssetSource,
  type ShadowAssetSourceRequest,
  type ShadowAssetSourceResult,
  type ShadowAssetStorage,
  type ShadowAssetStorageClass,
  type ShadowAssetStorageEntry,
  type ShadowAssetStorageSnapshot,
  type ShadowAssetStoreFailure,
  type ShadowAssetTransportFailure,
  type ShadowAssetUsage,
} from './shadow-assets.ts';
export {
  SHADOW_ASSET_CAPABILITY,
  ShadowAssetPortError,
  createBuiltinShadowAssetPortClient,
  createShadowAssetPortClient,
  startShadowAssetPortServer,
  type ShadowAssetPortClient,
  type BuiltinShadowAssetRuntimeBinding,
  type ShadowAssetPortFailure,
  type ShadowAssetPortFailurePhase,
  type ShadowAssetPortServer,
} from './shadow-asset-message-port.ts';
export {
  TARBALL_CACHE_ROOT,
  VfsTarballCache,
  computeIntegrity,
  parseIntegrityAlgorithm,
  type IntegrityAlgorithm,
  type TarballCache,
} from './tarball-cache.ts';
