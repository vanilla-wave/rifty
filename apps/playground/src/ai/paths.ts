/**
 * Workspace-scoped path resolution for AI tools. Every tool path — absolute
 * or workspace-relative — must land inside the active workspace root;
 * escaping it is an error (the agent operates on the open project only).
 */

export function resolveWorkspacePath(root: string, input: string): string {
  const raw = input.trim();
  if (raw === '') throw new Error('path is empty');
  const joined = raw.startsWith('/') ? raw : `${root}/${raw}`;
  const parts: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) {
        throw new Error(`path "${input}" escapes the workspace root ${root}`);
      }
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const resolved = `/${parts.join('/')}`;
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`path "${input}" escapes the workspace root ${root}`);
  }
  return resolved;
}

/** Workspace-relative form for tool output (stable across roots). */
export function workspaceRelative(root: string, path: string): string {
  return path === root ? '.' : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
