/**
 * Helpers shared by per-command builtin modules: path resolution + reusable
 * Text{En,De}coder instances. Kept allocation-free across commands.
 */

import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

/** Absolutize `p` against `cwd` (no-op if already absolute) and normalize. */
export function resolve(cwd: string, p: string): string {
  return normalizePath(isAbsolute(p) ? p : joinPath(cwd, p));
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();
