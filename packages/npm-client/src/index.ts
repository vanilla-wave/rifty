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
  type EddyRequestBody,
} from './eddy-request.ts';
export { link, buildLockfile, type ResolvedPackage, type Lockfile } from './linker.ts';
export { closureHashOf, canonicalClosureJson } from './closure-hash.ts';
// The bundle-adoption completeness gate, shared so eddy's durable store
// validates objects EXACTLY as strictly as the client adopts them (a store
// hit a client would reject must read as a miss and self-heal).
export { bundleCompletenessGap } from './installer-lockfile-reader.ts';
export { resolveOverride, type OverrideMap, type ResolvedOverrideTarget } from './overrides.ts';
export {
  install,
  type InstallOptions,
  type InstallProgressEvent,
  type InstallResult,
  type PackumentCacheLike,
} from './installer.ts';
export {
  TARBALL_CACHE_ROOT,
  VfsTarballCache,
  computeIntegrity,
  parseIntegrityAlgorithm,
  type IntegrityAlgorithm,
  type TarballCache,
} from './tarball-cache.ts';
