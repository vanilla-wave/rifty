/**
 * Single source of truth for the `cache → fetch → integrity-check → write cache`
 * trio used by both the lockfile fast path and the live-resolve path in
 * `installer.ts`.
 *
 * Before this helper existed the two pipelines were copy-pasted and had
 * drifted behaviorally:
 *
 * - Fast path verified the bytes returned by the network against the
 *   lockfile-pinned integrity and threw `EINTEGRITY` on mismatch.
 * - Live-resolve path skipped network-side verification entirely: even when
 *   `manifest.dist.integrity` was present, the freshly fetched bytes were
 *   stored to the cache without checking they matched the manifest's pin
 *   (silent stub per CLAUDE.md §"Code quality"). A registry returning the
 *   wrong tarball for a (name, version) pair would propagate unnoticed.
 *
 * The helper closes that divergence:
 *
 *  1. Look up cache by integrity hash. The cache implementation
 *     ({@link TarballCache.get}) re-verifies bytes on disk against the
 *     expected integrity and returns `null` on mismatch (corruption guard —
 *     see `tests/conformance/npm/lockfile-reuse.test.ts`). When non-null is
 *     returned we treat the bytes as already-verified and return them as a
 *     cache hit.
 *  2. On cache miss (or cache corruption), fetch via `getTarball`.
 *  3. Compute the integrity of the fetched bytes. If a `spec.integrity` was
 *     supplied (lockfile pin or manifest), compare; on mismatch throw
 *     `EINTEGRITY` (no silent reuse). If no expected integrity was given,
 *     the computed value is returned to the caller so it can be persisted
 *     in the lockfile entry.
 *  4. Write the verified bytes into the cache, keyed by the
 *     resolved-or-computed integrity.
 *  5. Return `{ bytes, cacheHit, integrity }` — `integrity` is what the
 *     caller should persist in the lockfile (matches what the cache is now
 *     keyed by).
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
  if (spec.integrity) {
    const cached = await ctx.cache.get(spec.name, spec.version, spec.integrity);
    if (cached) {
      return { bytes: cached, cacheHit: true, integrity: spec.integrity };
    }
  }

  const bytes = await ctx.getTarball(spec.resolved);
  // Compute integrity using the algorithm declared by `spec.integrity` so
  // the comparison is apples-to-apples. When no expected integrity is
  // supplied (e.g. a registry with no manifest pin), default to sha512 —
  // matches what modern npm packuments produce.
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
