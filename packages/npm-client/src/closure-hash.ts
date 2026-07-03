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

export async function closureHashOf(lockfile: Lockfile): Promise<string> {
  const keys = Object.keys(lockfile.packages).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, lockfile.packages[k]]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}
