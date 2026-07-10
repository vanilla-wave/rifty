/**
 * Learned eddy pins (ADR-0194 §8): after a successful eddy install the
 * playground persists `canonicalEddyRequestKey → closureHash`, so the NEXT
 * install of the same dep set — any set, not just pinned templates — becomes a
 * cacheable `GET /bundle/<hash>` (browser HTTP cache / CDN edge) instead of an
 * origin POST.
 *
 * Storage: profile-wide `/.rifty/eddy-learned-pins.json` on the owner VFS
 * (dot-dir precedent: `VfsTarballCache`; `ScopedVfs` deliberately leaves
 * `/.rifty` unscoped). Freshness is serve-stale-while-revalidate (backlog
 * eddy-stale-pin-revalidate): ≤ {@link LEARNED_PIN_TTL_MS} the pin is FRESH
 * (pinned GET, nothing else); past it but ≤ {@link STALE_PIN_MAX_AGE_MS} it is
 * STALE — still served (the content-addressed GET stays valid indefinitely,
 * proven byte-stable live) while the caller prints an `as-of` honesty line
 * and {@link revalidateLearnedPin} refreshes in background; beyond 24h the
 * pin is dropped (foreground POST exactly as pre-SWR). A pin outliving the
 * server link degrades to a verified 404 → POST which re-learns.
 * Corrupt/wrong-shape file reads as absent, never an error. A stale pin is
 * harmless either way: the installer's verification gates (coverage,
 * integrity) already degrade it to POST.
 *
 * Sync reader exists for `primeInstallPrefetch`, which is sync BY DESIGN (an
 * async gate starves behind the owner boot loop — measured double-POST,
 * ADR-0195).
 */
import {
  type EddyRequestBody,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
  resolveEddyClosure,
} from '@riftydev/npm-client';
import type { Vfs } from '@riftydev/vfs';

export const LEARNED_PINS_PATH = '/.rifty/eddy-learned-pins.json';
/** = eddy's mutable-tier DEFAULT (`EDDY_TTL_SECONDS` unset); deliberately not
 * synced to a custom deploy value — past it the pin turns STALE, not dead. */
export const LEARNED_PIN_TTL_MS = 1800 * 1000;
/** Hard stale bound — user-approved 2026-07-10 (epic install-tail-latency):
 * bounds the npm-unpublish/security-pull exposure the stale window extends
 * (operator safety net: the bundle revocation runbook). Beyond it the pin is
 * dropped and install re-resolves in the foreground. */
export const STALE_PIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const LEARNED_PINS_CAP = 64;

/** A served pin: `stale` = past the fresh TTL but inside the 24h bound —
 * the caller owes an `as-of` line + a background revalidate. */
export interface LearnedPin {
  readonly closureHash: string;
  readonly stale: boolean;
}

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
    if (
      typeof e.closureHash !== 'string' ||
      typeof e.savedAt !== 'number' ||
      !Number.isFinite(e.savedAt)
    ) {
      continue;
    }
    entries[key] = { closureHash: e.closureHash, savedAt: e.savedAt };
  }
  return { version: 1, entries };
}

function pinFrom(
  file: LearnedPinsFile | null,
  requestKey: string,
  nowMs: number,
): LearnedPin | undefined {
  const entry = file?.entries[requestKey];
  if (!entry) return undefined;
  if (entry.savedAt > nowMs) return undefined;
  const age = nowMs - entry.savedAt;
  if (age >= STALE_PIN_MAX_AGE_MS) return undefined;
  return { closureHash: entry.closureHash, stale: age >= LEARNED_PIN_TTL_MS };
}

export async function readLearnedPin(
  vfs: Vfs,
  requestKey: string,
  now: () => number = Date.now,
): Promise<LearnedPin | undefined> {
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

/** Sync twin of {@link readLearnedPin} for the owner-boot prefetch gate.
 * Serves fresh AND stale pins (a stale boot prefetch rides the pinned GET
 * too); the hash alone suffices — the install command re-reads the pin async
 * and owns the stale honesty line + revalidate. */
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
  return pinFrom(parseFile(text), requestKey, now())?.closureHash;
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

/** Serializes {@link writeLearnedPin}'s read-modify-write: the fire-and-forget
 * install write-back and a background revalidate can overlap, and an
 * unserialized RMW loses whichever key read the file first. One chain per
 * realm — the store is one file. */
let pinWriteChain: Promise<void> = Promise.resolve();

/**
 * Persist a learned pin (prune expired, evict oldest over
 * {@link LEARNED_PINS_CAP}). A corrupt existing file is replaced, not an
 * error. Writes are serialized (see {@link pinWriteChain}). With
 * `onlyIfCurrentHash` the write is COMPARE-AND-SET: it lands only while the
 * key's entry still holds that hash (read inside the chain slot — atomic vs
 * other writers), else it is skipped and `false` returns. A background
 * revalidate uses this so a slow POST can never roll back a NEWER pin written
 * while it was in flight.
 */
export function writeLearnedPin(
  vfs: Vfs,
  requestKey: string,
  closureHash: string,
  now: () => number = Date.now,
  onlyIfCurrentHash?: string,
): Promise<boolean> {
  const run = pinWriteChain.then(() =>
    writeLearnedPinExclusive(vfs, requestKey, closureHash, now, onlyIfCurrentHash),
  );
  pinWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeLearnedPinExclusive(
  vfs: Vfs,
  requestKey: string,
  closureHash: string,
  now: () => number,
  onlyIfCurrentHash?: string,
): Promise<boolean> {
  const nowMs = now();
  let file: LearnedPinsFile | null = null;
  if (await vfs.exists(LEARNED_PINS_PATH)) {
    try {
      file = parseFile(await vfs.readFileText(LEARNED_PINS_PATH));
    } catch {
      file = null;
    }
  }
  if (
    onlyIfCurrentHash !== undefined &&
    file?.entries[requestKey]?.closureHash !== onlyIfCurrentHash
  ) {
    return false; // superseded while we were resolving — never roll it back
  }
  const entries: Record<string, LearnedPinEntry> = {};
  for (const [key, entry] of Object.entries(file?.entries ?? {})) {
    // Prune at the HARD bound only: a stale sibling is still servable (SWR) —
    // an unrelated write must not shrink another request's stale window.
    if (entry.savedAt <= nowMs && nowMs - entry.savedAt < STALE_PIN_MAX_AGE_MS) {
      entries[key] = entry;
    }
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
  return true;
}

export interface RevalidateLearnedPinOptions {
  readonly vfs: Vfs;
  readonly resolverUrl: string;
  readonly request: EddyRequestBody;
  /** The stale hash that was just served — the compare baseline. */
  readonly staleClosureHash: string;
  /** Test seam; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/**
 * Background revalidate for a STALE pin that was just served (SWR): a plain
 * POST resolve read only up to the manifest member (`resolveEddyClosure` —
 * bounded, early-cancel, no bundle download), then a hash compare. Identical
 * closure → the pin's `savedAt` refreshes (fresh again — the server itself
 * re-vouched for it); different → the pin is REPLACED so the next install
 * rides the new hash's GET (the OLD bundle may sit in the browser HTTP cache —
 * harmless: the pin points elsewhere, so it is simply never requested again;
 * no purge needed). The write is compare-and-set against the served stale
 * hash: a NEWER pin landing while this POST was in flight (a `--prefer-online`
 * or POST re-learn) wins — `'superseded'`, no write. Throws on any resolver
 * failure — the pin file is written only after a successful compare, so an
 * abandoned/failed revalidate leaves it byte-intact (retried on the next
 * stale install).
 */
export async function revalidateLearnedPin(
  opts: RevalidateLearnedPinOptions,
): Promise<'refreshed' | 'replaced' | 'superseded'> {
  const summary = await resolveEddyClosure({
    resolverUrl: opts.resolverUrl,
    request: opts.request,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  if (summary.closureHash !== opts.staleClosureHash && !summary.storeDurable) {
    // Mirrors the installer's learnable gate (ADR-0194): a NEW hash is
    // pin-worthy only with the durable-store proof — a pin to an object the
    // store may not hold would 404 every install until it expires. The SAME
    // hash needs no proof: the GET that just served this install already
    // demonstrated the object exists.
    throw new Error(
      'resolver returned a new closure without the durable-store proof — keeping the existing pin',
    );
  }
  const requestKey = canonicalEddyRequestKey(opts.request);
  const wrote = await writeLearnedPin(
    opts.vfs,
    requestKey,
    summary.closureHash,
    opts.now ?? Date.now,
    opts.staleClosureHash,
  );
  if (!wrote) return 'superseded';
  return summary.closureHash === opts.staleClosureHash ? 'refreshed' : 'replaced';
}
