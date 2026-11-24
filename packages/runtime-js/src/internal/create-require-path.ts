import { NotImplementedError } from '@riftydev/io';
import { isAbsolute } from '@riftydev/vfs';
import { fileURLToPathPosix } from './posix-file-url.ts';
import { hasURLScheme } from './url-scheme.ts';

/** Validate and normalize node:module createRequire's base path. */
export function createRequirePath(value: string | URL): string {
  try {
    if (typeof value !== 'string') return fileURLToPathPosix(value);
    if (hasURLScheme(value, 'file')) return fileURLToPathPosix(value);
    if (isAbsolute(value)) return value;
  } catch (error) {
    // A host's missing `URL` is its named gap, not an invalid base.
    if (error instanceof NotImplementedError) throw error;
    // Node presents every invalid createRequire base through one public code.
  }
  const error = new TypeError(
    'The argument filename must be a file URL object, file URL string, or absolute path string',
  ) as TypeError & { code: string };
  error.code = 'ERR_INVALID_ARG_VALUE';
  throw error;
}
