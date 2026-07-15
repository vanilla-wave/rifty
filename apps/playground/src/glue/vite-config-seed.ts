import { type FsSync, type PersistFailureReport, dirname, normalizePath } from '@riftydev/vfs';
import { VITE_CONFIG_FILENAMES } from '../vite-project-policy.ts';

export { VITE_CONFIG_FILENAMES } from '../vite-project-policy.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function isViteConfigSlotPath(path: string, root: string): boolean {
  const np = normalizePath(path);
  return VITE_CONFIG_FILENAMES.some((name) => np === normalizePath(`${root}/${name}`));
}

export function withoutViteConfigSeedFiles(
  root: string,
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => !isViteConfigSlotPath(path, root)),
  );
}

export const VITE_CONFIG_SEED_MARKER = '.rifty/vite-config.seeded';

export function viteConfigSeedClaimPath(root: string): string {
  return normalizePath(`${root}/${VITE_CONFIG_SEED_MARKER}`);
}

export interface ViteConfigSeedStore {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** Durable-or-throw; memory adapters resolve immediately. */
  flush(): Promise<void>;
}

type SyncViteConfigSeedFs = Pick<
  FsSync,
  'existsSync' | 'readFileBytesSync' | 'mkdirSync' | 'writeFileSync'
>;

function persistFailureMessage(report: PersistFailureReport): string {
  const sample = report.failures
    .slice(0, 3)
    .map((failure) => `${failure.op} ${failure.path}: ${failure.message}`)
    .join('; ');
  return `OPFS write-through drained with ${report.total} unhealed persist failure(s)${sample ? `: ${sample}` : ''}`;
}

/** Sync-owner adapter; its flush is the durability gate, not ordering-only. */
export function syncViteConfigSeedStore(
  fs: SyncViteConfigSeedFs,
  flush: () => Promise<PersistFailureReport | undefined>,
): ViteConfigSeedStore {
  return {
    async read(path) {
      return fs.existsSync(path) ? fs.readFileBytesSync(path) : null;
    },
    async write(path, data) {
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(path, data);
    },
    async flush() {
      const report = await flush();
      if (report !== undefined && report.total > 0) {
        const error = new Error(persistFailureMessage(report));
        error.name = 'PersistFailureError';
        throw error;
      }
    },
  };
}

interface ViteConfigSeedClaim {
  readonly schema: 1;
  readonly file: string;
  readonly starter: string;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function claimBytes(claim: ViteConfigSeedClaim): Uint8Array {
  return enc.encode(`${JSON.stringify(claim)}\n`);
}

function parseClaim(path: string, bytes: Uint8Array): ViteConfigSeedClaim {
  let value: unknown;
  try {
    value = JSON.parse(dec.decode(bytes));
  } catch (error) {
    throw new Error(`corrupt Vite config seed claim: ${path}`, { cause: error });
  }
  const claim = value as Partial<ViteConfigSeedClaim> | null;
  if (
    claim === null ||
    typeof claim !== 'object' ||
    claim.schema !== 1 ||
    typeof claim.starter !== 'string' ||
    claim.starter.length === 0 ||
    typeof claim.file !== 'string' ||
    !VITE_CONFIG_FILENAMES.includes(claim.file as (typeof VITE_CONFIG_FILENAMES)[number])
  ) {
    throw new Error(`corrupt Vite config seed claim: ${path}`);
  }
  return claim as ViteConfigSeedClaim;
}

async function findExistingConfigs(
  root: string,
  store: ViteConfigSeedStore,
): Promise<ReadonlyArray<{ readonly path: string; readonly bytes: Uint8Array }>> {
  const configs: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];
  for (const filename of VITE_CONFIG_FILENAMES) {
    const path = normalizePath(`${root}/${filename}`);
    const bytes = await store.read(path);
    if (bytes !== null) configs.push({ path, bytes });
  }
  return configs;
}

/**
 * Own the template's one visible Vite config slot. Returns true only when this
 * call created config bytes; healing an exact torn seed returns false.
 */
export async function claimViteConfigSeed(
  root: string,
  store: ViteConfigSeedStore,
  starter: { readonly id: string; readonly seedFiles: Readonly<Record<string, string>> },
): Promise<boolean> {
  const normalizedRoot = normalizePath(root);
  const markerPath = viteConfigSeedClaimPath(normalizedRoot);
  const markerBytes = await store.read(markerPath);
  if (markerBytes !== null) {
    const claim = parseClaim(markerPath, markerBytes);
    // Re-write exact internal bytes before the checked drain: this heals a
    // marker present in the mirror whose prior OPFS persist attempt failed.
    await store.write(markerPath, claimBytes(claim));
    await store.flush();
    return false;
  }

  const slotEntries = Object.entries(starter.seedFiles)
    .map(([path, content]) => [normalizePath(path), content] as const)
    .filter(([path]) => isViteConfigSlotPath(path, normalizedRoot));
  if (slotEntries.length > 1) {
    throw new Error(
      `starter ${starter.id} defines multiple Vite config slots under ${normalizedRoot}`,
    );
  }
  const slotEntry = slotEntries[0];
  if (slotEntry === undefined) return false;

  const [slotPath, seedContent] = slotEntry;
  const seedBytes = enc.encode(seedContent);
  const existing = await findExistingConfigs(normalizedRoot, store);

  if (existing.length > 0) {
    if (
      existing.length !== 1 ||
      existing[0]?.path !== slotPath ||
      !bytesEqual(existing[0].bytes, seedBytes)
    ) {
      return false;
    }
    // Config-first recovery: re-write exact bytes to heal a failed persist,
    // prove them durable, then commit the claim.
    await store.write(slotPath, seedBytes);
    await store.flush();
    await store.write(
      markerPath,
      claimBytes({
        schema: 1,
        file: slotPath.slice(normalizedRoot.length + 1),
        starter: starter.id,
      }),
    );
    await store.flush();
    return false;
  }

  await store.write(slotPath, seedBytes);
  await store.flush();
  await store.write(
    markerPath,
    claimBytes({ schema: 1, file: slotPath.slice(normalizedRoot.length + 1), starter: starter.id }),
  );
  await store.flush();
  return true;
}
