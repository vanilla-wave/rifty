export { matchesRange, pickBestVersion, compare, parse } from './semver.ts';
export {
  RegistryClient,
  getRegistryBaseUrl,
  type Packument,
  type VersionManifest,
  type Fetcher,
} from './registry.ts';
export { extractTarGz, parseTarEntries } from './unpacker.ts';
export {
  EDDY_BUNDLE_FORMAT,
  packEddyBundle,
  unpackEddyBundle,
  type EddyBundleContents,
  type EddyBundleManifestV1,
  type EddyBundleTarballEntry,
} from './eddy-bundle.ts';
export { streamTarEntries } from './eddy-bundle-stream.ts';
export {
  startEddyPrefetch,
  type EddyPrefetchHandle,
  type StartEddyPrefetchOptions,
} from './eddy-prefetch.ts';
export {
  bundleUrlFor,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
  type EddyRequestBody,
} from './eddy-request.ts';
export { link, buildLockfile, type ResolvedPackage, type Lockfile } from './linker.ts';
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
