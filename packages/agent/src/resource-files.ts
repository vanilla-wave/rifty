import type { Ignore } from 'ignore';
import type { AgentFiles, AgentResourceDiagnostic } from './types.ts';

const encoder = new TextEncoder();

// Node readdir orders UTF-8 names, including astral code points (ADR-0440 parity).
function comparePaths(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta) return delta;
  }
  return a.length - b.length;
}

export function resourcePath(dir: string, name: string): string {
  return `${dir === '/' ? '' : dir}/${name}`;
}

export function resourceWarning(
  diagnostics: AgentResourceDiagnostic[],
  path: string,
  error: unknown,
): void {
  diagnostics.push({
    type: 'warning',
    path,
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function resourceEntries(
  files: AgentFiles,
  path: string,
  diagnostics: AgentResourceDiagnostic[],
): Promise<Awaited<ReturnType<AgentFiles['list']>>> {
  try {
    const prefix = resourcePath(path, '');
    const entries = (await files.list(path)).filter((entry) => {
      const name = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : '';
      if (name && !name.includes('/')) return true;
      diagnostics.push({
        type: 'warning',
        path: entry.path,
        message: `Host list entry is not a direct child of ${path}`,
      });
      return false;
    });
    return entries.sort((a, b) => comparePaths(a.path, b.path));
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      )
    )
      resourceWarning(diagnostics, path, error);
    return [];
  }
}

/**
 * Pi 0.85.1 package-manager `addIgnoreRules`: `.gitignore`/`.ignore`/`.fdignore` in `dir`,
 * patterns anchored at `prefix` (relative to the walk base); unreadable files are swallowed.
 */
export async function addIgnoreRules(
  files: AgentFiles,
  dir: string,
  prefix: string,
  entries: Awaited<ReturnType<AgentFiles['list']>>,
  matcher: Ignore,
): Promise<void> {
  for (const name of ['.gitignore', '.ignore', '.fdignore']) {
    const path = resourcePath(dir, name);
    if (!entries.some((entry) => entry.path === path && entry.kind === 'file')) continue;
    try {
      const patterns = (await files.read(path)).split(/\r?\n/).flatMap((line) => {
        if (!line.trim() || line.trim().startsWith('#')) return [];
        let pattern = line;
        const negated = pattern.startsWith('!');
        if (negated || pattern.startsWith('\\!')) pattern = pattern.slice(1);
        if (pattern.startsWith('/')) pattern = pattern.slice(1);
        return [`${negated ? '!' : ''}${prefix}${pattern}`];
      });
      matcher.add(patterns);
    } catch {
      // CLI addIgnoreRules swallows unreadable ignore files (package-manager.js).
    }
  }
}
