import { normalizePath } from '@riftydev/vfs';

const WORKSPACE_ROOT = '/workspace';

/**
 * A terminal `file://` link inside the guest project root → its project path
 * (`/home/project/src/x` → `/src/x`, ADR-0531); anything else is not a file link.
 */
export function pathFromTerminalFileLink(uri: string, root = WORKSPACE_ROOT): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:' || url.hostname !== '') return null;
  let path: string;
  try {
    path = normalizePath(decodeURIComponent(url.pathname));
  } catch {
    return null;
  }
  const workspace = normalizePath(root);
  if (workspace === '/') return path;
  if (path === workspace) return '/';
  return path.startsWith(`${workspace}/`) ? path.slice(workspace.length) : null;
}
