/**
 * Stable content hash of a resolved closure (ADR-0182 §6 immutable artifact
 * key). Order-independent over the lockfile's package keys, so the same
 * resolved graph yields the same hash regardless of walk order — the key for
 * the immutable `closure-hash → bundle` tier. Excludes the manifest's
 * `resolvedAt` timestamp (which varies per resolution) so a re-resolve of an
 * unchanged closure is a cache hit.
 */
import { createHash } from 'node:crypto';
import type { Lockfile } from '@riftydev/npm-client';

export function closureHashOf(lockfile: Lockfile): string {
  const keys = Object.keys(lockfile.packages).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, lockfile.packages[k]]));
  return `sha256-${createHash('sha256').update(canonical).digest('base64')}`;
}
