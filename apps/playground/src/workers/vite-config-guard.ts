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

// The CURATED owner build/preview path (build-boot.ts) runs vite with
// `configFile:false` — it genuinely cannot load user config, so a present config
// is a loud gap, not a silent ignore. The REAL vite CLI path (prepareViteCli)
// loads user config for real and has NO such guard: unsupported preview options
// surface at their own execution boundary (backlog
// vite-curated-boot-residual-forces tracks aligning/removing this curated path).
export function assertNoUserViteConfig(
  root: string,
  exists: (path: string) => boolean = (path) => syncMirror().existsSync(path),
): void {
  const configPath = findUserViteConfig(root, exists);
  if (configPath === null) return;
  // TODO(backlog: playground/vite-curated-boot-residual-forces)
  throw new NotImplementedError(
    'vite.config-loading',
    `${configPath} exists, but the legacy owner Vite dev-server path cannot load user config yet; run the real vite CLI path or remove the config before using npm-run dev.`,
  );
}
