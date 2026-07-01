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
export { EddyCache, type EddyCacheOptions } from './cache.ts';
export { createEddyServer, type EddyServer, type EddyServerOptions } from './server.ts';
export { closureHashOf } from './closure-hash.ts';
export { readNpmClientVersion } from './npm-client-version.ts';
