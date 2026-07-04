/**
 * `@riftydev/eddy` — opt-in fast npm-install resolver service (ADR-0182).
 * Runs rifty's own resolution server-side and returns one `EddyBundleV1`
 * (lockfile + compressed tarballs). The client pre-seeds its tarball cache +
 * writes the lockfile, then the existing lockfile fast path installs with zero
 * packument network. Standard install is untouched and is the always-on
 * fallback.
 */
export {
  resolveBundle,
  type EddyResolveRequest,
  type EddyResolveResult,
  type EddyResolverDeps,
} from './resolver.ts';
export { EddyCache, type EddyCacheOptions, type CachedBundle } from './cache.ts';
export { createEddyServer, type EddyServer, type EddyServerOptions } from './server.ts';
export {
  MemoryBundleStore,
  type BundleStore,
  type MemoryBundleStoreOptions,
} from './bundle-store.ts';
export { S3BundleStore, type S3BundleStoreOptions } from './s3-bundle-store.ts';
export {
  MemoryTarballCache,
  TtlPackumentCache,
  type MemoryTarballCacheOptions,
  type TtlPackumentCacheOptions,
} from './shared-caches.ts';
export { readNpmClientVersion } from './npm-client-version.ts';
// Compatibility re-export: `closureHashOf` was exported from here before the
// implementation moved to `@riftydev/npm-client` (one shared impl, ADR-0194);
// existing `@riftydev/eddy` consumers must keep working.
export { closureHashOf } from '@riftydev/npm-client';
