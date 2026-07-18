/**
 * Stable content hash of a resolved closure (ADR-0182 §6 immutable artifact
 * key). Order-independent over package-map keys, but includes the exact
 * npm-client-owned shadow-substitution trace: equal trees with different
 * provenance are different closures. Excludes the manifest `resolvedAt` (varies
 * per resolution) so a re-resolve of an unchanged closure is a cache hit.
 *
 * ONE implementation shared by eddy (which stamps the manifest) and the client
 * (which re-derives it to verify a bundle's self-claimed `closureHash` — a
 * content-addressed bundle must hash to the hash it names, ADR-0194). Async +
 * WebCrypto so it runs unchanged in the browser install path and Node eddy; the
 * `sha256-<standard-base64>` shape byte-matches Node's `digest('base64')`.
 */
import type { Lockfile } from './linker.ts';

/** Recursively key-sort plain objects so JSON insertion order can't leak into
 * the hash — `dependencies`/`bin`/`peerDependencies` maps describe the SAME
 * closure whatever order a packument (or a future serializer) emitted them. */
function deepCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCanonical);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) out[k] = deepCanonical(record[k]);
    return out;
  }
  return value;
}

/**
 * The canonical (order-independent, DEEPLY key-sorted) serialization the
 * closure hash is computed over — ONE definition, so `@riftydev/eddy`'s SYNC
 * `closureHashOf` (Node-only, kept for its pre-existing string-returning API)
 * can never drift from the async hash below.
 */
export function canonicalClosureJson(lockfile: Lockfile): string {
  const keys = Object.keys(lockfile.packages).sort();
  const packages = keys.map((key) => [key, deepCanonical(lockfile.packages[key])]);
  if (lockfile.rifty === undefined) return JSON.stringify(packages);
  return JSON.stringify({ packages, rifty: deepCanonical(lockfile.rifty) });
}

export async function closureHashOf(lockfile: Lockfile): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalClosureJson(lockfile)),
  );
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}
