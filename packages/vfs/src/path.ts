/**
 * POSIX-style path utilities for VFS. We don't depend on Node's `path` so this
 * works untouched inside Workers / browsers / Node.
 */

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export function normalizePath(p: string): string {
  if (p === '' || p === '.') return '/';
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
