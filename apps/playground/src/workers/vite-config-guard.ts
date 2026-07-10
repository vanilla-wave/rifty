import { NotImplementedError } from '@riftydev/io';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';

const enc = new TextEncoder();

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

/** Root-relative seeded-config provenance marker (retired-wrapper `.rifty/` dir precedent). */
export const VITE_CONFIG_SEED_MARKER = '.rifty/vite-config.seeded';

export function templateViteConfigSeedMarkerPath(root: string): string {
  return normalizePath(`${root}/${VITE_CONFIG_SEED_MARKER}`);
}

/** Sync-mirror subset the seed claim touches (structural — both realms' mirrors satisfy it). */
export interface ViteConfigSeedFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { readonly recursive?: boolean }): unknown;
  writeFileSync(path: string, data: Uint8Array): unknown;
}

/**
 * ONE seed-decision for the template's `/vite.config.js` (every seed site
 * delegates here — dev-server-boot/real-vite-bootstrap heal seeds, and the
 * page's reload re-seed skips the slot outright). Returns true = caller must
 * seed the slot file now; the marker is already recorded.
 *
 * Provenance = the `.rifty/vite-config.seeded` marker, NOT root freshness. The
 * marker distinguishes "user deleted the seeded config" from "never seeded":
 * a persisted pre-marker workspace (root exists, no config, no marker) still
 * gets the template policy the retired wrapper used to force every boot —
 * the freshRoot heuristic starved those roots forever (torn-state: old state +
 * new code, no migration). Deleting `.rifty/` (or the marker) resets to reseed.
 * - template carries no config-slot seed → nothing to claim;
 * - some vite.config.* variant exists → never seed — Vite resolves `.js`
 *   FIRST, so seeding it next to a user's `.ts` would silently take over
 *   config loading;
 * - marker exists → the user deleted the seeded config: the documented opt-out
 *   into stock Vite behavior (vite-template-dep-optimizer-policy) — never
 *   resurrect;
 * - else seed AND record the marker (one-line JSON: seeded file + template id).
 */
export function claimTemplateViteConfigSeed(
  root: string,
  fs: ViteConfigSeedFs,
  template: { readonly id: string; readonly seedFiles: Readonly<Record<string, string>> },
): boolean {
  const slotPath = Object.keys(template.seedFiles)
    .map((p) => normalizePath(p))
    .find((p) => isViteConfigSlotPath(p, root));
  if (slotPath === undefined) return false;
  if (findUserViteConfig(root, (p) => fs.existsSync(p)) !== null) return false;
  const marker = templateViteConfigSeedMarkerPath(root);
  if (fs.existsSync(marker)) return false;
  fs.mkdirSync(dirname(marker), { recursive: true });
  fs.writeFileSync(
    marker,
    enc.encode(
      `${JSON.stringify({ file: slotPath.slice(normalizePath(root).length + 1), template: template.id })}\n`,
    ),
  );
  return true;
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
