/**
 * Node-compatible `node:path` (POSIX flavour). Built on the same primitives as
 * `@riftydev/vfs/path`, plus the methods specific to the Node API.
 */
import {
  joinPath,
  normalizePath,
  basename as vfsBasename,
  dirname as vfsDirname,
  extname as vfsExtname,
  isAbsolute as vfsIsAbsolute,
} from '@riftydev/vfs';
import { getProcessCwd } from './process.ts';

export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

export const sep = '/';
export const delimiter = ':';

export function join(...parts: string[]): string {
  if (parts.length === 0) return '.';
  return joinPath(...parts);
}

export function resolve(...parts: string[]): string {
  let result = '/';
  let lastAbsolute = false;
  // Walk from the last argument backward — Node `path.resolve` interprets
  // arguments right-to-left, taking each segment as the new "absolute root"
  // until an absolute one is found.
  const collected: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part === undefined || part === '') continue;
    collected.unshift(part);
    if (vfsIsAbsolute(part)) {
      lastAbsolute = true;
      break;
    }
  }
  if (!lastAbsolute) {
    // Node parity: relative resolution anchors at process.cwd() (defaults to
    // '/workspace', see process.ts) — fs.resolvePath already does; keep in sync.
    collected.unshift(getProcessCwd());
  }
  result = normalizePath(collected.join('/'));
  if (!vfsIsAbsolute(result)) result = `/${result}`;
  return result;
}

export function normalize(p: string): string {
  if (p === '') return '.';
  const trailing = p.endsWith('/') && p !== '/';
  const out = normalizePath(p);
  if (trailing && !out.endsWith('/')) return `${out}/`;
  return out;
}
export const isAbsolute = (p: string): boolean => vfsIsAbsolute(p);
export const dirname = (p: string): string => vfsDirname(p);
export const basename = (p: string, ext?: string): string => vfsBasename(p, ext);
export const extname = (p: string): string => vfsExtname(p);

export function relative(from: string, to: string): string {
  const fromAbs = resolve(from);
  const toAbs = resolve(to);
  if (fromAbs === toAbs) return '';
  const fromParts = fromAbs.split('/').filter(Boolean);
  const toParts = toAbs.split('/').filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const down = toParts.slice(common);
  const segments: string[] = [];
  for (let i = 0; i < ups; i++) segments.push('..');
  segments.push(...down);
  return segments.join('/') || '.';
}

export function parse(p: string): ParsedPath {
  const root = vfsIsAbsolute(p) ? '/' : '';
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(p);
  const name = ext ? base.slice(0, base.length - ext.length) : base;
  return { root, dir, base, ext, name };
}

export function format(o: Partial<ParsedPath>): string {
  const dir = o.dir ?? o.root ?? '';
  const base = o.base ?? `${o.name ?? ''}${o.ext ?? ''}`;
  if (!dir) return base;
  if (dir.endsWith('/')) return `${dir}${base}`;
  return `${dir}/${base}`;
}

// `path.toNamespacedPath` (v9) — POSIX identity no-op. Windows namespacing
// (`\\?\C:\…`) is the only non-identity case, and rifty is POSIX-only
// (`win32 === posix`), so returning the input verbatim is faithful Node behaviour.
export function toNamespacedPath(p: string): string {
  return p;
}

export const posix = {
  sep,
  delimiter,
  join,
  resolve,
  normalize,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  toNamespacedPath,
};

// We don't ship `win32` — pet project, POSIX only.
export const win32 = posix;

const path = {
  sep,
  delimiter,
  join,
  resolve,
  normalize,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  toNamespacedPath,
  posix,
  win32,
};
export default path;
