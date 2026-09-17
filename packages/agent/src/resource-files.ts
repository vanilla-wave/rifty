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
    return [...(await files.list(path))].sort((a, b) => comparePaths(a.path, b.path));
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
