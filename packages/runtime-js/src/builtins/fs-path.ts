/**
 * Path kit shared by every `node:fs` surface (fs.ts, fs-streams.ts, fs-watch.ts):
 * one `PathLike` → string coercion and ONE cwd-anchored resolution. Extracted
 * from fs.ts (review 2026-07-05) after `createReadStream('data.txt')` skipped
 * cwd resolution and silently hit `/data.txt` — any fs entry point that does
 * its own path handling instead of importing this kit recreates that bug.
 */

import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { getProcessCwd } from './process.ts';

export type PathLike = string | URL | Uint8Array;

export function pathToString(p: PathLike): string {
  if (typeof p === 'string') return p;
  if (p instanceof URL) {
    // Node's fs accepts file:// URLs; decode to a path.
    if (p.protocol !== 'file:') {
      throw Object.assign(new TypeError('Only file: URLs are supported'), {
        code: 'ERR_INVALID_URL_SCHEME',
      });
    }
    return decodeURIComponent(p.pathname);
  }
  if (p instanceof Uint8Array) return new TextDecoder().decode(p);
  throw new TypeError('fs path must be string, Buffer, or URL');
}

/**
 * Resolve a user-facing fs path: relative names anchor at the runtime's cwd
 * (process.cwd(), default '/workspace'); absolute paths are normalised directly.
 * The syncMirror always sees absolute paths.
 */
export function resolvePath(p: PathLike): string {
  const str = pathToString(p);
  if (isAbsolute(str)) return normalizePath(str);
  // joinPath already normalizes internally and getProcessCwd() is always an
  // absolute normalized path, so its result is already absolute+normalized —
  // the outer normalizePath was a redundant no-op pass (#6, perf audit
  // 2026-06-05). joinPath itself is NOT touched (45+ callers).
  return joinPath(getProcessCwd(), str);
}
