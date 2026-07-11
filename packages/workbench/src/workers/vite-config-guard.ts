import { NotImplementedError } from '@riftydev/io';
import { normalizePath, syncMirror } from '@riftydev/vfs';

export const VITE_CONFIG_FILENAMES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
] as const;

export function findUserViteConfig(root: string, exists: (path: string) => boolean): string | null {
  for (const filename of VITE_CONFIG_FILENAMES) {
    const path = normalizePath(`${root}/${filename}`);
    if (exists(path)) return path;
  }
  return null;
}

export function assertNoUserViteConfig(
  root: string,
  exists: (path: string) => boolean = (path) => syncMirror().existsSync(path),
): void {
  const configPath = findUserViteConfig(root, exists);
  if (configPath === null) return;
  // TODO(backlog: playground/honest-vite-config-file-loading)
  throw new NotImplementedError(
    'vite.config-loading',
    `${configPath} exists, but the legacy owner Vite dev-server path cannot load user config yet; run the real vite CLI path or remove the config before using npm-run dev.`,
  );
}

export function assertNoUserVitePreviewConfig(
  root: string,
  exists: (path: string) => boolean = (path) => syncMirror().existsSync(path),
  explicitConfigPath?: string,
): void {
  const configPath =
    explicitConfigPath === undefined
      ? findUserViteConfig(root, exists)
      : normalizePath(
          explicitConfigPath.startsWith('/') ? explicitConfigPath : `${root}/${explicitConfigPath}`,
        );
  if (configPath === null) return;
  throw new NotImplementedError(
    'vite.preview.config-loading',
    `${configPath} would be ignored by rifty's browser preview bridge; remove the config before running vite preview until preview config/CORS parity lands.`,
  );
}
