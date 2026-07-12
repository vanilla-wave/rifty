import { dirname, normalizePath } from '@riftydev/vfs';

const enc = new TextEncoder();

// Verbatim Vite DEFAULT_CONFIG_FILES order (vite/src/node/constants.ts).
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

export function isViteConfigSlotPath(path: string, root: string): boolean {
  const np = normalizePath(path);
  return VITE_CONFIG_FILENAMES.some((name) => np === normalizePath(`${root}/${name}`));
}

export const VITE_CONFIG_SEED_MARKER = '.rifty/vite-config.seeded';

export function templateViteConfigSeedMarkerPath(root: string): string {
  return normalizePath(`${root}/${VITE_CONFIG_SEED_MARKER}`);
}

export interface ViteConfigSeedFs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  mkdirSync(path: string, options?: { readonly recursive?: boolean }): unknown;
  writeFileSync(path: string, data: Uint8Array): unknown;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Config first, marker second; exact seed without marker heals on retry. */
export function claimTemplateViteConfigSeed(
  root: string,
  fs: ViteConfigSeedFs,
  template: { readonly id: string; readonly seedFiles: Readonly<Record<string, string>> },
): boolean {
  const slotEntry = Object.entries(template.seedFiles)
    .map(([path, content]) => [normalizePath(path), content] as const)
    .find(([path]) => isViteConfigSlotPath(path, root));
  if (slotEntry === undefined) return false;
  const [slotPath, seedContent] = slotEntry;
  const seedBytes = enc.encode(seedContent);
  const marker = templateViteConfigSeedMarkerPath(root);
  const writeMarker = (): void => {
    fs.mkdirSync(dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      enc.encode(
        `${JSON.stringify({ file: slotPath.slice(normalizePath(root).length + 1), template: template.id })}\n`,
      ),
    );
  };
  const existing = findUserViteConfig(root, (path) => fs.existsSync(path));
  if (existing !== null) {
    if (
      existing === slotPath &&
      !fs.existsSync(marker) &&
      bytesEqual(fs.readFileBytesSync(slotPath), seedBytes)
    ) {
      writeMarker();
    }
    return false;
  }
  if (fs.existsSync(marker)) return false;
  fs.mkdirSync(dirname(slotPath), { recursive: true });
  fs.writeFileSync(slotPath, seedBytes);
  writeMarker();
  return true;
}
