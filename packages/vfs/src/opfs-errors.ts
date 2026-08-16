/**
 * Maps DOMException-style OPFS errors to {@link VfsError} with POSIX `code`
 * values (ADR-0013). OPFS surfaces errors as `DOMException` by `name`:
 *
 *   - `NotAllowedError`          → EACCES   (permission/lock denied)
 *   - `QuotaExceededError`       → EDQUOT   (quota exhausted)
 *   - `TypeMismatchError`        → EISDIR / ENOTDIR (kind mismatch; see `context`)
 *   - `InvalidModificationError` → ENOTEMPTY (rm non-empty dir w/o recurse)
 *   - `NotFoundError`            → ENOENT   (path missing)
 *   - (anything else)            → EIO      (with `.cause`)
 */

import { VfsError } from './errors.ts';

export type OpfsErrorContext = 'file' | 'dir';

function errorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') {
    return err.name;
  }
  return '';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * Translates an OPFS-thrown error into a {@link VfsError} with the right POSIX
 * code, preserving the original as `.cause` for unknown cases.
 *
 * @param err - Raw error caught from an OPFS API call.
 * @param path - User-visible path the op was working on.
 * @param context - File or directory; disambiguates `TypeMismatchError`.
 */
export function mapOpfsError(err: unknown, path: string, context: OpfsErrorContext): VfsError {
  const name = errorName(err);
  const message = errorMessage(err);
  switch (name) {
    case 'NotFoundError':
      return new VfsError('ENOENT', path, message);
    case 'NotAllowedError':
      return new VfsError('EACCES', path, message);
    case 'QuotaExceededError':
      return new VfsError('EDQUOT', path, message);
    case 'TypeMismatchError':
      // Entry has the other kind than `context`; match Node's code:
      // file op on a dir → EISDIR, dir op on a file → ENOTDIR.
      return new VfsError(context === 'file' ? 'EISDIR' : 'ENOTDIR', path, message);
    case 'InvalidModificationError':
      // `removeEntry` on a non-empty dir without `recursive: true`; Node's
      // `fs.rmSync` raises ENOTEMPTY here, so consumers branch on one code.
      return new VfsError('ENOTEMPTY', path, message);
    default:
      return new VfsError('EIO', path, message || `OPFS error on ${path}`, { cause: err });
  }
}

/**
 * Chromium materializes `createWritable()`'s atomic swap through a sibling
 * `<name>.crswap` directory entry; the raw iterator lists it like a real
 * file while a write is in flight, and a killed realm can orphan it (fault:
 * torn-state × Storage (OPFS) read surface). The rifty OPFS backend
 * reserves the suffix: enumeration drops FILE entries carrying it — after a
 * crash-reload a program sees the target entry (complete or the empty
 * created-not-swapped torn state), never the platform's mid-op temp — and
 * creation refuses loudly, because Chromium ALLOWS user files with the
 * suffix (probed 2026-08-16), so a silent enumeration filter alone would
 * hide real user data. Loud per-backend gap: real Node accepts such names;
 * pure-memory backends keep full fidelity.
 */
export const CRSWAP_SUFFIX = '.crswap';

export function isCrswapArtifactName(name: string): boolean {
  return name.endsWith(CRSWAP_SUFFIX);
}

/** Refuse creating/renaming-to a reserved `*.crswap` path on OPFS backends. */
export function assertNotCrswapReserved(path: string): void {
  if (isCrswapArtifactName(path)) {
    throw new VfsError(
      'EINVAL',
      path,
      `"${CRSWAP_SUFFIX}" names are reserved by the OPFS backend (Chromium atomic-swap temp namespace)`,
    );
  }
}
