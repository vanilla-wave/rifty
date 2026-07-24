/**
 * Single source of truth for the `cache → fetch → integrity-check → write cache`
 * trio used by both the lockfile fast path and the live-resolve path in
 * `installer.ts`.
 *
 * Closes a prior divergence: the live-resolve path skipped network-side
 * verification, storing freshly fetched bytes to cache without checking them
 * against `manifest.dist.integrity` (silent stub per CLAUDE.md §"Code
 * quality") — a registry serving the wrong tarball for a (name, version)
 * propagated unnoticed. The fast path verified; the helper makes both verify.
 *
 * Cache lookups re-verify on-disk bytes against expected integrity and return
 * `null` on mismatch (corruption guard — see
 * `tests/conformance/npm/lockfile-reuse.test.ts`). On miss, fetch + compare to
 * `spec.integrity` (throw `EINTEGRITY` on mismatch, never silent reuse); when
 * no expected integrity is given, the computed value is returned for the
 * caller to persist in the lockfile. Returned `integrity` matches what the
 * cache is now keyed by.
 */

import { type TarballCache, computeIntegrity, parseIntegrityAlgorithm } from './tarball-cache.ts';

export interface FetchSpec {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  /** Expected integrity hash. When present, fetched bytes are verified
   * against it; mismatch → throws `EINTEGRITY`. When absent, the computed
   * integrity is returned for the caller to persist. */
  readonly integrity?: string;
}

export interface FetchAndUnpackResult {
  readonly bytes: Uint8Array;
  readonly cacheHit: boolean;
  /** Integrity hash that the bytes match — either the supplied
   * `spec.integrity` or the value computed from the fetched bytes. */
  readonly integrity: string;
}

export interface FetchAndUnpackCtx {
  readonly cache: TarballCache;
  readonly getTarball: (url: string) => Promise<Uint8Array>;
  readonly signal?: AbortSignal;
}

/**
 * Resolve a single (name, version) tarball into bytes, going through the
 * cache when possible and verifying integrity on the network path.
 *
 * Throws an `EINTEGRITY`-coded error on network-bytes mismatch against
 * `spec.integrity`.
 */
export async function fetchAndUnpackToCache(
  spec: FetchSpec,
  ctx: FetchAndUnpackCtx,
): Promise<FetchAndUnpackResult> {
  if (ctx.signal?.aborted) {
    throw ctx.signal.reason instanceof Error
      ? ctx.signal.reason
      : new Error('npm tarball acquisition aborted');
  }
  if (spec.integrity) {
    const cached = await ctx.cache.get(spec.name, spec.version, spec.integrity);
    if (cached) {
      return { bytes: cached, cacheHit: true, integrity: spec.integrity };
    }
  }

  const bytes = await ctx.getTarball(spec.resolved);
  if (ctx.signal?.aborted) {
    throw ctx.signal.reason instanceof Error
      ? ctx.signal.reason
      : new Error('npm tarball acquisition aborted');
  }
  // Match the algorithm declared by `spec.integrity` so the comparison is
  // apples-to-apples; default sha512 (what modern npm packuments produce)
  // when no expected integrity is supplied.
  let algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha512';
  if (spec.integrity) {
    const parsed = parseIntegrityAlgorithm(spec.integrity);
    if (parsed === null) {
      throw Object.assign(
        new Error(
          `Unsupported integrity algorithm in ${spec.name}@${spec.version}: ${spec.integrity}`,
        ),
        {
          code: 'EINTEGRITY',
          packageName: spec.name,
          version: spec.version,
          expected: spec.integrity,
        },
      );
    }
    algorithm = parsed;
  }
  const actual = await computeIntegrity(bytes, algorithm);
  if (spec.integrity && actual !== spec.integrity) {
    throw Object.assign(
      new Error(
        `Integrity mismatch for ${spec.name}@${spec.version}: expected ${spec.integrity}, got ${actual}`,
      ),
      {
        code: 'EINTEGRITY',
        packageName: spec.name,
        version: spec.version,
        expected: spec.integrity,
        actual,
      },
    );
  }
  await ctx.cache.put(spec.name, spec.version, actual, bytes);
  return { bytes, cacheHit: false, integrity: actual };
}
