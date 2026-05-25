/**
 * Maps DOMException-style OPFS errors to {@link VfsError} with proper
 * POSIX-flavoured `code` values (ADR-0013 acceptance).
 *
 * Browser OPFS surfaces errors as `DOMException` instances whose `name` is
 * one of:
 *
 *   - `NotAllowedError`      — permission/lock denied              → EACCES
 *   - `QuotaExceededError`   — storage quota exhausted             → EDQUOT
 *   - `TypeMismatchError`    — kind mismatch (file vs directory)   → EISDIR / ENOTDIR
 *   - `NotFoundError`        — path missing                        → ENOENT
 *   - (anything else)        — unknown failure                     → EIO (with `.cause`)
 *
 * The `context` argument disambiguates `TypeMismatchError`: when the caller
 * was asking for a file but found a directory, the right code is `EISDIR`;
 * when asking for a directory but the entry is a file, it's `ENOTDIR`.
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
 * Translates an OPFS-thrown error into a {@link VfsError} with the right
 * POSIX code, preserving the original error as `.cause` for unknown cases.
 *
 * @param err - The raw error caught from an OPFS API call.
 * @param path - The user-visible path the op was working on.
 * @param context - Whether the caller was operating on a file or a directory
 *   (disambiguates `TypeMismatchError`).
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
      // Caller was asking about a `context` (file/dir) but the existing
      // entry has the other kind. Map to the POSIX code Node would emit:
      //   - file op on a directory      → EISDIR
      //   - directory op on a file path → ENOTDIR
      return new VfsError(context === 'file' ? 'EISDIR' : 'ENOTDIR', path, message);
    default:
      return new VfsError('EIO', path, message || `OPFS error on ${path}`, { cause: err });
  }
}
