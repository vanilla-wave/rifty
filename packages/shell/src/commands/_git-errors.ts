/**
 * Storage-failure classification for `git` command probes (ADR-0357): the
 * facade surfaces the exact `VfsError`; command probes must never re-collapse
 * it into a native-looking absence diagnostic. Classification is TYPE-first —
 * a `VfsError` is never absence even when its message mimics "could not find".
 */
import { VfsError } from '@riftydev/vfs';

/** True when an iso-git error is a "not found" plumbing error (vs a real bug). */
export function isNotFound(e: unknown): boolean {
  if (e instanceof VfsError) return false;
  const msg = e instanceof Error ? e.message : String(e);
  return (e as { name?: string })?.name === 'NotFoundError' || /could not find/i.test(msg);
}

/** Rethrow a storage failure; anything else falls through to the caller. */
export function throwIfStorageFailure(e: unknown): void {
  if (e instanceof VfsError) throw e;
}

/** Catch handler: storage failure rethrows; every other rejection → `fallback`. */
export function storageFailureOr<T>(fallback: T): (e: unknown) => T {
  return (e: unknown) => {
    throwIfStorageFailure(e);
    return fallback;
  };
}
