import { NotImplementedError } from '@riftydev/io';
import { syncMirror } from '@riftydev/vfs';
import { findUserViteConfig } from '../glue/vite-config-seed.ts';

// Curated owner build/dev cannot load config; the real CLI owns config loading.
export function assertNoUserViteConfig(
  root: string,
  exists: (path: string) => boolean = (path) => syncMirror().existsSync(path),
): void {
  const configPath = findUserViteConfig(root, exists);
  if (configPath === null) return;
  throw new NotImplementedError(
    'vite.config-loading',
    `${configPath} exists, but the legacy owner Vite dev-server path cannot load user config yet; run the real vite CLI path or remove the config before using npm-run dev.`,
  );
}
