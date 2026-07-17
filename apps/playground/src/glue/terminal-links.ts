import { normalizePath } from '@riftydev/vfs';

const WORKSPACE_ROOT = '/workspace';

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
  const prefix = workspace === '/' ? '/' : `${workspace}/`;
  if (path === workspace || path.startsWith(prefix)) return path;
  return null;
}
