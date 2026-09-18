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
