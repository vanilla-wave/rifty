/**
 * Pure resolver for a `node <file>` argument (ADR-0154). Absolutizes the arg
 * against the shell cwd + confirms the file exists in the owner store, returning
 * a clean Node-shaped diagnostic on a miss (no throw, no silent stub).
 *
 * `@riftydev/vfs` exports no `resolve`; this mirrors the shell's own
 * `resolve(cwd, p)` (commands/_shared.ts) via the public path helpers:
 * `normalizePath(isAbsolute(p) ? p : joinPath(cwd, p))`.
 */
import { type FsSync, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export type ResolveResult = { ok: true; path: string } | { ok: false; message: string };

/** Resolve a `node <file>` arg against cwd + confirm it exists in the owner store. */
export function resolveNodeEntry(fs: FsSync, cwd: string, arg: string | undefined): ResolveResult {
  if (arg === undefined || arg === '') {
    return { ok: false, message: 'node: missing entry file\nUsage: node <file> [args]\n' };
  }
  const path = normalizePath(isAbsolute(arg) ? arg : joinPath(cwd, arg));
  if (!fs.existsSync(path)) return { ok: false, message: `node: cannot find module '${path}'\n` };
  return { ok: true, path };
}
