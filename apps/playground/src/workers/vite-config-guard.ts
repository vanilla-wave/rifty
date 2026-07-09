import { NotImplementedError } from '@riftydev/io';
import { normalizePath, syncMirror } from '@riftydev/vfs';

// Verbatim Vite `DEFAULT_CONFIG_FILES` order (vite/src/node/constants.ts):
// js -> mjs -> ts -> cjs -> mts -> cts. Order matters twice: findUserViteConfig
// reports the file Vite will actually load, and the seed gate below decides
// whether our template `.js` would SHADOW a user's `.ts` (it would — js wins).
// The previous ts-first order was Vite-divergent.
export const VITE_CONFIG_FILENAMES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
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

/** `path` occupies the root's vite.config.* slot (any Vite-resolvable variant). */
export function isViteConfigSlotPath(path: string, root: string): boolean {
  const np = normalizePath(path);
  return VITE_CONFIG_FILENAMES.some((name) => np === normalizePath(`${root}/${name}`));
}

/**
 * ONE seed-decision for the template's `/vite.config.js` (every seed site
 * delegates here — dev-server-boot/real-vite-bootstrap heal seeds, and the
 * page's reload re-seed skips the slot outright):
 * - only into a FRESH root — a reload/heal re-seed must not resurrect a
 *   deleted config (deleting it is the documented opt-out into stock Vite
 *   behavior, backlog vite-template-dep-optimizer-policy);
 * - only when NO vite.config.* variant exists — Vite resolves `.js` FIRST, so
 *   seeding it next to a user's `.ts` would silently take over config loading.
 */
export function shouldSeedTemplateViteConfig(
  root: string,
  exists: (path: string) => boolean,
  opts: { readonly freshRoot: boolean },
): boolean {
  if (!opts.freshRoot) return false;
  return findUserViteConfig(root, exists) === null;
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
