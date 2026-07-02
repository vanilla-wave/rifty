/**
 * Learned eddy pins (ADR-0194 §8): after a successful eddy install the
 * playground persists `canonicalEddyRequestKey → closureHash`, so the NEXT
 * install of the same dep set — any set, not just pinned templates — becomes a
 * cacheable `GET /bundle/<hash>` (browser HTTP cache / CDN edge) instead of an
 * origin POST.
 *
 * Storage: `/.rifty/eddy-learned-pins.json` on the owner VFS (dot-dir
 * precedent: `VfsTarballCache`). TTL = the server's mutable-tier default —
 * a pin must not outlive the server-side link it mirrors; expiry degrades to
 * POST which re-learns. Corrupt/wrong-shape file reads as absent, never an
 * error. A stale pin is harmless either way: the installer's verification
 * gates (coverage, integrity) already degrade it to POST.
 *
 * Sync reader exists for `primeInstallPrefetch`, which is sync BY DESIGN (an
 * async gate starves behind the owner boot loop — measured double-POST,
 * ADR-0186).
 */
import { canonicalEddyRequestKey, eddyRequestFromPackageJson } from '@riftydev/npm-client';
import type { Vfs } from '@riftydev/vfs';

export const LEARNED_PINS_PATH = '/.rifty/eddy-learned-pins.json';
/** = eddy's mutable-tier default (`EDDY_TTL_SECONDS`). */
export const LEARNED_PIN_TTL_MS = 1800 * 1000;
export const LEARNED_PINS_CAP = 64;

interface LearnedPinEntry {
  readonly closureHash: string;
  /** Epoch ms of the learning write — the TTL anchor. */
  readonly savedAt: number;
}

interface LearnedPinsFile {
  readonly version: 1;
  readonly entries: Record<string, LearnedPinEntry>;
}

/** The sync fs slice the SYNC pin reader reads through. */
export interface LearnedPinsSyncFs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
}

function parseFile(text: string): LearnedPinsFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as { version?: unknown; entries?: unknown };
  if (raw.version !== 1) return null;
  if (!raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return null;
  const entries: Record<string, LearnedPinEntry> = {};
  for (const [key, value] of Object.entries(raw.entries as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const e = value as { closureHash?: unknown; savedAt?: unknown };
    if (typeof e.closureHash !== 'string' || typeof e.savedAt !== 'number') continue;
    entries[key] = { closureHash: e.closureHash, savedAt: e.savedAt };
  }
  return { version: 1, entries };
}

function pinFrom(
  file: LearnedPinsFile | null,
  requestKey: string,
  nowMs: number,
): string | undefined {
  const entry = file?.entries[requestKey];
  if (!entry) return undefined;
  if (nowMs - entry.savedAt >= LEARNED_PIN_TTL_MS) return undefined;
  return entry.closureHash;
}

export async function readLearnedPin(
  vfs: Vfs,
  requestKey: string,
  now: () => number = Date.now,
): Promise<string | undefined> {
  if (!(await vfs.exists(LEARNED_PINS_PATH))) return undefined;
  let text: string;
  try {
    text = await vfs.readFileText(LEARNED_PINS_PATH);
  } catch {
    return undefined;
  }
  return pinFrom(parseFile(text), requestKey, now());
}

const pinsDecoder = new TextDecoder('utf-8');

/** Sync twin of {@link readLearnedPin} for the owner-boot prefetch gate. */
export function readLearnedPinSync(
  fs: LearnedPinsSyncFs,
  requestKey: string,
  now: () => number = Date.now,
): string | undefined {
  if (!fs.existsSync(LEARNED_PINS_PATH)) return undefined;
  let text: string;
  try {
    text = pinsDecoder.decode(fs.readFileBytesSync(LEARNED_PINS_PATH));
  } catch {
    return undefined;
  }
  return pinFrom(parseFile(text), requestKey, now());
}

/**
 * The learned pin for a package.json TEXT — the prefetch-side lookup: same
 * canonical request key `install()` will compute, so a hit turns the prefetch
 * into a cacheable GET. Malformed package.json → absent, never a throw (the
 * install itself surfaces the loud error).
 */
export function learnedPinForPackageJsonSync(
  fs: LearnedPinsSyncFs,
  packageJsonText: string,
  now: () => number = Date.now,
): string | undefined {
  const request = eddyRequestFromPackageJson(packageJsonText);
  if (!request) return undefined;
  return readLearnedPinSync(fs, canonicalEddyRequestKey(request), now);
}

/**
 * Persist a learned pin (prune expired, evict oldest over
 * {@link LEARNED_PINS_CAP}). A corrupt existing file is replaced, not an
 * error.
 */
export async function writeLearnedPin(
  vfs: Vfs,
  requestKey: string,
  closureHash: string,
  now: () => number = Date.now,
): Promise<void> {
  const nowMs = now();
  let file: LearnedPinsFile | null = null;
  if (await vfs.exists(LEARNED_PINS_PATH)) {
    try {
      file = parseFile(await vfs.readFileText(LEARNED_PINS_PATH));
    } catch {
      file = null;
    }
  }
  const entries: Record<string, LearnedPinEntry> = {};
  for (const [key, entry] of Object.entries(file?.entries ?? {})) {
    if (nowMs - entry.savedAt < LEARNED_PIN_TTL_MS) entries[key] = entry;
  }
  entries[requestKey] = { closureHash, savedAt: nowMs };
  const keys = Object.keys(entries);
  if (keys.length > LEARNED_PINS_CAP) {
    const oldestFirst = keys.sort(
      (a, b) => (entries[a] as LearnedPinEntry).savedAt - (entries[b] as LearnedPinEntry).savedAt,
    );
    for (const key of oldestFirst.slice(0, keys.length - LEARNED_PINS_CAP)) {
      delete entries[key];
    }
  }
  const next: LearnedPinsFile = { version: 1, entries };
  await vfs.mkdir('/.rifty', { recursive: true });
  await vfs.writeFile(LEARNED_PINS_PATH, `${JSON.stringify(next, null, 2)}\n`);
}
