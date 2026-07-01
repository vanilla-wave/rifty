/**
 * Helpers shared by per-command builtin modules: path resolution + reusable
 * Text{En,De}coder instances. Kept allocation-free across commands.
 */

import { type VfsError, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import type { StdinReader } from '../types.ts';

/** Absolutize `p` against `cwd` (no-op if already absolute) and normalize. */
export function resolve(cwd: string, p: string): string {
  return normalizePath(isAbsolute(p) ? p : joinPath(cwd, p));
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();

/**
 * Drain a connected `ctx.stdin` to a single byte buffer (concatenating chunks
 * until EOF). Returns an empty buffer when no stdin is connected. Used by the
 * filter builtins (cat/grep/wc/head/tail) to read a pipe RHS or `< file`.
 */
export async function readAllStdin(ctx: { stdin?: StdinReader }): Promise<Uint8Array> {
  if (!ctx.stdin) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await ctx.stdin.read();
    if (chunk === null) break;
    chunks.push(chunk);
    total += chunk.length;
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Map a {@link VfsError} code to the GNU `strerror` text the file builtins print
 * after the operand (`cmd: path: <text>`). Single source for every command so
 * the wording can't drift (was copy-pasted per-file before).
 */
export function strerror(e: VfsError): string {
  switch (e.code) {
    case 'ENOENT':
      return 'No such file or directory';
    case 'EISDIR':
      return 'Is a directory';
    case 'ENOTDIR':
      return 'Not a directory';
    case 'EEXIST':
      return 'File exists';
    case 'ENOTEMPTY':
      return 'Directory not empty';
    case 'EINVAL':
      return 'Invalid argument';
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied';
    default:
      return e.code;
  }
}

/** Escape every RegExp metacharacter in `s` so it matches literally. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
