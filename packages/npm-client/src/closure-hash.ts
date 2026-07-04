/**
 * Stable content hash of a resolved closure (ADR-0182 §6 immutable artifact
 * key). Order-independent over the lockfile's package keys, so the same resolved
 * graph yields the same hash regardless of walk order — the key for the
 * immutable `closure-hash → bundle` tier. Excludes the manifest `resolvedAt`
 * (varies per resolution) so a re-resolve of an unchanged closure is a cache hit.
 *
 * ONE implementation shared by eddy (which stamps the manifest) and the client
 * (which re-derives it to verify a bundle's self-claimed `closureHash` — a
 * content-addressed bundle must hash to the hash it names, ADR-0194). Async +
 * WebCrypto so it runs unchanged in the browser install path and Node eddy; the
 * `sha256-<standard-base64>` shape byte-matches Node's `digest('base64')`.
 */
import type { Lockfile } from './linker.ts';

/**
 * The canonical (order-independent) serialization the closure hash is computed
 * over — ONE definition, so `@riftydev/eddy`'s SYNC `closureHashOf` (Node-only,
 * kept for its pre-existing string-returning API) can never drift from the
 * async hash below.
 */
export function canonicalClosureJson(lockfile: Lockfile): string {
  const keys = Object.keys(lockfile.packages).sort();
  return JSON.stringify(keys.map((k) => [k, lockfile.packages[k]]));
}

export async function closureHashOf(lockfile: Lockfile): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalClosureJson(lockfile)),
  );
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}
