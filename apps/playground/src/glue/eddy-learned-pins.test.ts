import {
  type EddyBundleManifestV1,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
  packEddyBundle,
} from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  LEARNED_PINS_CAP,
  LEARNED_PINS_PATH,
  LEARNED_PIN_TTL_MS,
  STALE_PIN_MAX_AGE_MS,
  learnedPinForPackageJsonSync,
  readLearnedPin,
  readLearnedPinSync,
  revalidateLearnedPin,
  writeLearnedPin,
} from './eddy-learned-pins.ts';

const KEY = 'key-a';
const HASH = 'sha256-abc/def+g=';

describe('eddy learned pins (ADR-0194 §8)', () => {
  it('round-trips requestKey → closureHash, async and sync readers agree', async () => {
    const { vfs, fsSync } = createMemoryFs();
    expect(await readLearnedPin(vfs, KEY)).toBeUndefined();
    await writeLearnedPin(vfs, KEY, HASH);
    expect(await readLearnedPin(vfs, KEY)).toEqual({ closureHash: HASH, stale: false });
    expect(readLearnedPinSync(fsSync, KEY)).toBe(HASH);
    expect(await readLearnedPin(vfs, 'other-key')).toBeUndefined();
  });

  it('the fresh TTL (= server mutable default) is the fresh→stale boundary, not a drop', async () => {
    const { vfs, fsSync } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, HASH, () => nowMs);
    nowMs += 1799_000;
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toEqual({
      closureHash: HASH,
      stale: false,
    });
    nowMs += 2_000; // past 1800s — SWR: served stale, not dropped
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toEqual({ closureHash: HASH, stale: true });
    expect(readLearnedPinSync(fsSync, KEY, () => nowMs)).toBe(HASH);
  });

  it('caps stored entries, evicting the oldest', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    for (let i = 0; i < LEARNED_PINS_CAP + 1; i++) {
      nowMs += 1_000;
      await writeLearnedPin(vfs, `key-${i}`, `sha256-${i}`, () => nowMs);
    }
    expect(await readLearnedPin(vfs, 'key-0', () => nowMs)).toBeUndefined(); // oldest evicted
    expect((await readLearnedPin(vfs, 'key-1', () => nowMs))?.closureHash).toBe('sha256-1');
    expect((await readLearnedPin(vfs, `key-${LEARNED_PINS_CAP}`, () => nowMs))?.closureHash).toBe(
      `sha256-${LEARNED_PINS_CAP}`,
    );
  });

  it('re-learning the same key replaces the hash and refreshes the TTL', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, 'sha256-old', () => nowMs);
    nowMs += 1_000_000;
    await writeLearnedPin(vfs, KEY, 'sha256-new', () => nowMs);
    nowMs += 1_500_000; // old stamp would be stale by now, the new one is fresh
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toEqual({
      closureHash: 'sha256-new',
      stale: false,
    });
  });

  it('a corrupt or wrong-shape file reads as absent (never an error) and a write recovers it', async () => {
    const { vfs, fsSync } = createMemoryFs();
    await vfs.mkdir('/.rifty', { recursive: true });
    for (const garbage of ['{not json', '[]', '{"version":99}', '{"version":1,"entries":[]}']) {
      await vfs.writeFile(LEARNED_PINS_PATH, garbage);
      expect(await readLearnedPin(vfs, KEY)).toBeUndefined();
      expect(readLearnedPinSync(fsSync, KEY)).toBeUndefined();
    }
    await writeLearnedPin(vfs, KEY, HASH);
    expect((await readLearnedPin(vfs, KEY))?.closureHash).toBe(HASH);
  });

  it('ignores non-string / wrong-shape entries inside an otherwise valid file', async () => {
    const { vfs } = createMemoryFs();
    await vfs.mkdir('/.rifty', { recursive: true });
    await vfs.writeFile(
      LEARNED_PINS_PATH,
      JSON.stringify({
        version: 1,
        entries: { [KEY]: { closureHash: 42, savedAt: 1 }, ok: { closureHash: 'sha256-x' } },
      }),
    );
    expect(await readLearnedPin(vfs, KEY)).toBeUndefined();
    expect(await readLearnedPin(vfs, 'ok')).toBeUndefined(); // savedAt missing → unverifiable TTL
  });

  it('ignores non-finite and future savedAt values', async () => {
    const { vfs, fsSync } = createMemoryFs();
    await vfs.mkdir('/.rifty', { recursive: true });
    await vfs.writeFile(
      LEARNED_PINS_PATH,
      '{"version":1,"entries":{"future":{"closureHash":"sha256-future","savedAt":2000},"inf":{"closureHash":"sha256-inf","savedAt":1e999}}}',
    );

    expect(await readLearnedPin(vfs, 'future', () => 1000)).toBeUndefined();
    expect(readLearnedPinSync(fsSync, 'future', () => 1000)).toBeUndefined();
    expect(await readLearnedPin(vfs, 'inf', () => 1000)).toBeUndefined();

    await writeLearnedPin(vfs, KEY, HASH, () => 1000);
    expect(await readLearnedPin(vfs, 'future', () => 1000)).toBeUndefined();
    expect((await readLearnedPin(vfs, KEY, () => 1000))?.closureHash).toBe(HASH);
  });

  it('learnedPinForPackageJsonSync serves a STALE pin too — boot prefetch rides the pinned GET across the stale window', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const packageJson = JSON.stringify({ name: 'app', dependencies: { express: '^5.1.0' } });
    const request = eddyRequestFromPackageJson(packageJson);
    expect(request).not.toBeNull();
    if (!request) return;
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, canonicalEddyRequestKey(request), HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS + 60_000; // 31 min old — stale, still served
    expect(learnedPinForPackageJsonSync(fsSync, packageJson, () => nowMs)).toBe(HASH);
    nowMs += STALE_PIN_MAX_AGE_MS; // beyond 24h — hard expired
    expect(learnedPinForPackageJsonSync(fsSync, packageJson, () => nowMs)).toBeUndefined();
  });

  it('learnedPinForPackageJsonSync keys on the canonical eddy request of the package.json text', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const packageJson = JSON.stringify({
      name: 'app',
      dependencies: { express: '^5.1.0' },
      devDependencies: { eslint: '^9' },
    });
    const request = eddyRequestFromPackageJson(packageJson);
    expect(request).not.toBeNull();
    if (!request) return;
    await writeLearnedPin(vfs, canonicalEddyRequestKey(request), HASH);
    expect(learnedPinForPackageJsonSync(fsSync, packageJson)).toBe(HASH);
    // A dep change misses — never a stale pin for a different set.
    const mutated = JSON.stringify({ name: 'app', dependencies: { express: '^5.1.0' } });
    expect(learnedPinForPackageJsonSync(fsSync, mutated)).toBeUndefined();
    // Malformed package.json → absent, never a throw (prefetch path).
    expect(learnedPinForPackageJsonSync(fsSync, '{oops')).toBeUndefined();
  });
});

describe('concurrent pin writes', () => {
  it('two overlapping writeLearnedPin calls both survive — the store serializes its read-modify-write', async () => {
    // Review round 2: the write-back and a background revalidate can overlap;
    // an unserialized RMW loses whichever key read the file first.
    const { vfs } = createMemoryFs();
    let gateFirstRead!: () => void;
    const firstReadGate = new Promise<void>((r) => {
      gateFirstRead = r;
    });
    let reads = 0;
    const slowVfs = new Proxy(vfs, {
      get(target, prop, receiver) {
        if (prop === 'readFileText') {
          return async (path: string) => {
            reads++;
            if (reads === 1) await firstReadGate; // first RMW parks on its read
            return target.readFileText(path);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as typeof vfs;
    await writeLearnedPin(vfs, 'seed', 'sha256-seed'); // file exists → RMW reads it

    const w1 = writeLearnedPin(slowVfs, 'key-1', 'sha256-1');
    const w2 = writeLearnedPin(slowVfs, 'key-2', 'sha256-2');
    await new Promise((r) => setTimeout(r, 10));
    gateFirstRead();
    await Promise.all([w1, w2]);

    expect((await readLearnedPin(vfs, 'key-1'))?.closureHash).toBe('sha256-1');
    expect((await readLearnedPin(vfs, 'key-2'))?.closureHash).toBe('sha256-2');
    expect((await readLearnedPin(vfs, 'seed'))?.closureHash).toBe('sha256-seed');
  });
});

describe('stale window — serve-stale-while-revalidate inside a hard 24h bound', () => {
  it('fresh (≤ TTL) reads back stale:false; past the TTL but ≤ 24h reads back stale:true (still served)', async () => {
    const { vfs, fsSync } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS - 1_000;
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toEqual({
      closureHash: HASH,
      stale: false,
    });
    nowMs += 61_000; // 31 min old — the old hard drop, now the stale window
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toEqual({ closureHash: HASH, stale: true });
    expect(readLearnedPinSync(fsSync, KEY, () => nowMs)).toBe(HASH);
  });

  it('past 24h the pin is dropped — hard expire, foreground POST exactly as before the stale window', async () => {
    const { vfs, fsSync } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, HASH, () => nowMs);
    nowMs += STALE_PIN_MAX_AGE_MS - 1_000;
    expect((await readLearnedPin(vfs, KEY, () => nowMs))?.closureHash).toBe(HASH);
    nowMs += 2_000; // beyond the hard bound
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toBeUndefined();
    expect(readLearnedPinSync(fsSync, KEY, () => nowMs)).toBeUndefined();
  });

  it('an unrelated write PRESERVES stale siblings (prune only beyond 24h) — a write must not shrink the stale window', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS + 60_000; // KEY is now stale
    await writeLearnedPin(vfs, 'key-b', 'sha256-b', () => nowMs);
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toEqual({ closureHash: HASH, stale: true });
    nowMs += STALE_PIN_MAX_AGE_MS; // KEY beyond 24h
    await writeLearnedPin(vfs, 'key-c', 'sha256-c', () => nowMs);
    const text = await vfs.readFileText(LEARNED_PINS_PATH);
    expect(text).not.toContain(HASH); // hard-expired entries do get pruned
  });
});

describe('revalidateLearnedPin — background manifest-only POST refresh', () => {
  const REQUEST = { dependencies: { debug: '^4.4.1' }, optionalDependencies: {} };
  const requestKey = canonicalEddyRequestKey(REQUEST);

  function manifestFor(closureHash: string): EddyBundleManifestV1 {
    return {
      format: 'EddyBundleV1',
      npmClientVersion: '0.0.0-test',
      asOf: {
        resolvedAt: '2026-07-10T12:00:00.000Z',
        registry: 'https://registry.example',
        closureHash,
      },
      tarballs: [
        {
          file: 'tarballs/debug-4.4.1.tgz',
          name: 'debug',
          version: '4.4.1',
          integrity: 'sha512-x',
        },
      ],
    };
  }

  function bundleResponse(closureHash: string, opts: { durable?: boolean } = {}): Response {
    const bytes = packEddyBundle({
      manifest: manifestFor(closureHash),
      lockfileText: JSON.stringify({ lockfileVersion: 3, packages: {} }),
      tarballs: [
        { entry: manifestFor(closureHash).tarballs[0] as never, bytes: new Uint8Array(2048) },
      ],
    });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      // Default durable: the replace path requires the store proof; individual
      // tests drop it to exercise the non-durable decline.
      headers: opts.durable === false ? {} : { 'x-eddy-store-durable': '1' },
    });
  }

  it('identical closure → savedAt refreshed: the pin reads back FRESH again', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS + 60_000; // stale

    const outcome = await revalidateLearnedPin({
      vfs,
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      staleClosureHash: HASH,
      fetchImpl: async () => bundleResponse(HASH),
      now: () => nowMs,
    });

    expect(outcome).toBe('refreshed');
    expect(await readLearnedPin(vfs, requestKey, () => nowMs)).toEqual({
      closureHash: HASH,
      stale: false,
    });
  });

  it('different closure → the pin is REPLACED with the new hash', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS + 60_000;

    const outcome = await revalidateLearnedPin({
      vfs,
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      staleClosureHash: HASH,
      fetchImpl: async () => bundleResponse('sha256-NEW='),
      now: () => nowMs,
    });

    expect(outcome).toBe('replaced');
    expect(await readLearnedPin(vfs, requestKey, () => nowMs)).toEqual({
      closureHash: 'sha256-NEW=',
      stale: false,
    });
  });

  it('a SLOW revalidate cannot roll back a NEWER pin — the write is compare-and-set against the served stale hash', async () => {
    // Review round 3: the revalidate wrote unconditionally, so a user's
    // explicit `--prefer-online` (or any POST re-learn) landing DURING the
    // slow background POST was overwritten by the older resolution — the pin
    // regressed and self-renewed for another fresh window.
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS + 60_000; // stale — a revalidate starts

    let releaseResolver!: () => void;
    const resolverGate = new Promise<void>((r) => {
      releaseResolver = r;
    });
    const revalidate = revalidateLearnedPin({
      vfs,
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      staleClosureHash: HASH,
      fetchImpl: async () => {
        await resolverGate; // the background POST is slow
        return bundleResponse(HASH);
      },
      now: () => nowMs,
    });

    // While it's in flight, a newer install re-learns the pin (e.g. a
    // --prefer-online POST resolved a NEWER closure).
    await writeLearnedPin(vfs, requestKey, 'sha256-NEWER=', () => nowMs);

    releaseResolver();
    const outcome = await revalidate;

    expect(outcome).toBe('superseded'); // observed, honest — and NO write
    expect(await readLearnedPin(vfs, requestKey, () => nowMs)).toEqual({
      closureHash: 'sha256-NEWER=',
      stale: false,
    });
  });

  it('a DIFFERENT closure WITHOUT the durable-store proof keeps the old pin and throws — never a pin to an object that may not exist', async () => {
    // Mirrors the installer's learnable gate (ADR-0194): a POST-computed hash
    // is pin-worthy only when the server proved the immutable store held it.
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    const before = await vfs.readFileText(LEARNED_PINS_PATH);
    nowMs += LEARNED_PIN_TTL_MS + 60_000;

    await expect(
      revalidateLearnedPin({
        vfs,
        resolverUrl: 'http://eddy.test',
        request: REQUEST,
        staleClosureHash: HASH,
        fetchImpl: async () => bundleResponse('sha256-NEW=', { durable: false }),
        now: () => nowMs,
      }),
    ).rejects.toThrow(/durable/i);
    expect(await vfs.readFileText(LEARNED_PINS_PATH)).toBe(before);
  });

  it('an IDENTICAL closure refreshes even without the durable header — the just-served GET already proved the object exists', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    nowMs += LEARNED_PIN_TTL_MS + 60_000;

    const outcome = await revalidateLearnedPin({
      vfs,
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      staleClosureHash: HASH,
      fetchImpl: async () => bundleResponse(HASH, { durable: false }),
      now: () => nowMs,
    });

    expect(outcome).toBe('refreshed');
    expect(await readLearnedPin(vfs, requestKey, () => nowMs)).toEqual({
      closureHash: HASH,
      stale: false,
    });
  });

  it('resolver failure (typed decline / network) → THROWS and the pin file is untouched', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    const before = await vfs.readFileText(LEARNED_PINS_PATH);
    nowMs += LEARNED_PIN_TTL_MS + 60_000;

    await expect(
      revalidateLearnedPin({
        vfs,
        resolverUrl: 'http://eddy.test',
        request: REQUEST,
        staleClosureHash: HASH,
        fetchImpl: async () =>
          new Response(JSON.stringify({ feature: 'workspace' }), {
            status: 422,
            headers: { 'content-type': 'application/json' },
          }),
        now: () => nowMs,
      }),
    ).rejects.toThrow(/resolver declined/);
    expect(await vfs.readFileText(LEARNED_PINS_PATH)).toBe(before);

    await expect(
      revalidateLearnedPin({
        vfs,
        resolverUrl: 'http://eddy.test',
        request: REQUEST,
        staleClosureHash: HASH,
        fetchImpl: async () => {
          throw new Error('network down');
        },
        now: () => nowMs,
      }),
    ).rejects.toThrow(/network down/);
    expect(await vfs.readFileText(LEARNED_PINS_PATH)).toBe(before);
  });

  it('a revalidate abandoned mid-flight (tab closed) leaves the pin file intact — the write happens only after the compare', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, requestKey, HASH, () => nowMs);
    const before = await vfs.readFileText(LEARNED_PINS_PATH);
    nowMs += LEARNED_PIN_TTL_MS + 60_000;

    // The fetch never settles — the revalidate promise is simply abandoned.
    void revalidateLearnedPin({
      vfs,
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      staleClosureHash: HASH,
      fetchImpl: () => new Promise<Response>(() => {}),
      now: () => nowMs,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));

    expect(await vfs.readFileText(LEARNED_PINS_PATH)).toBe(before); // no partial JSON, no torn write
  });
});
