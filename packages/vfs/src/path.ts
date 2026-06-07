/**
 * POSIX-style path utilities for VFS. We don't depend on Node's `path` so this
 * works untouched inside Workers / browsers / Node.
 */

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export function normalizePath(p: string): string {
  if (p === '' || p === '.') return '/';
  // Fast path (#10, perf audit 2026-06-05): an already-normalized ABSOLUTE
  // path is returned untouched — no split/stack alloc. Absolute-only by
  // design; relative inputs fall through to the slow path unchanged.
  if (p === '/') return '/';
  if (p.startsWith('/') && !p.endsWith('/') && !p.includes('//')) {
    let dotted = false;
    for (const seg of p.slice(1).split('/')) {
      if (seg === '.' || seg === '..') {
        dotted = true;
        break;
      }
    }
    if (!dotted) return p;
  }
  const absolute = isAbsolute(p);
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!absolute) {
        stack.push('..');
      }
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join('/');
  if (absolute) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

export function joinPath(...segments: string[]): string {
  if (segments.length === 0) return '.';
  const filtered = segments.filter((s) => s.length > 0);
  if (filtered.length === 0) return '.';
  const first = filtered[0] ?? '';
  const absolute = isAbsolute(first);
  const joined = filtered.join('/').replace(/\/+/g, '/');
  const normalized = normalizePath(joined);
  if (absolute && !isAbsolute(normalized)) return `/${normalized}`;
  return normalized;
}

export function dirname(p: string): string {
  const normalized = normalizePath(p);
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return normalized.slice(0, idx);
}

export function basename(p: string, ext?: string): string {
  const normalized = normalizePath(p);
  if (normalized === '/') return '';
  const idx = normalized.lastIndexOf('/');
  const tail = idx === -1 ? normalized : normalized.slice(idx + 1);
  if (ext !== undefined && tail.endsWith(ext) && tail !== ext) {
    return tail.slice(0, tail.length - ext.length);
  }
  return tail;
}

/**
 * Like {@link dirname} but skips the internal `normalizePath` pass.
 * **Precondition:** `p` MUST already be a normalized absolute path (the output
 * of {@link normalizePath}/{@link normalizeAbsolute}). Internal-only fast path
 * (#10, perf audit 2026-06-05) — NOT exported; UNSAFE on un-normalized input.
 */
export function dirnameNormalized(p: string): string {
  if (p === '/') return '/';
  const idx = p.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return p.slice(0, idx);
}

/**
 * Like {@link basename} but skips the internal `normalizePath` pass.
 * **Precondition:** `p` MUST already be a normalized absolute path. Internal-only
 * fast path (#10, perf audit 2026-06-05) — NOT exported; UNSAFE on un-normalized input.
 */
export function basenameNormalized(p: string, ext?: string): string {
  if (p === '/') return '';
  const idx = p.lastIndexOf('/');
  const tail = idx === -1 ? p : p.slice(idx + 1);
  if (ext !== undefined && tail.endsWith(ext) && tail !== ext) {
    return tail.slice(0, tail.length - ext.length);
  }
  return tail;
}

export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx);
}

/**
 * Split a normalised absolute path into its segments. `'/'` -> `[]`,
 * `'/a/b'` -> `['a', 'b']`. Used by backends that store dirs as a tree.
 */
export function segments(p: string): string[] {
  const normalized = normalizePath(p);
  if (normalized === '/' || normalized === '') return [];
  const stripped = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  return stripped.split('/');
}

/**
 * Normalise `p` and coerce to an absolute POSIX path. Relative inputs like
 * `'foo/bar'` or `'./foo/../bar.txt'` become `'/foo/bar'` and `'/bar.txt'`
 * respectively. Backends rely on this to keep their manual path-slicing
 * (parent + child name) honest even when callers pass relative paths.
 *
 * This is the documented invariant for `Vfs` / `FsSync` entry points: every
 * public method normalises its `path` argument before forwarding to the
 * backend.
 */
export function normalizeAbsolute(p: string): string {
  const normalized = normalizePath(p);
  if (normalized.startsWith('/')) return normalized;
  if (normalized === '.') return '/';
  return `/${normalized}`;
}
