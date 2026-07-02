import { canonicalEddyRequestKey, eddyRequestFromPackageJson } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  LEARNED_PINS_CAP,
  LEARNED_PINS_PATH,
  learnedPinForPackageJsonSync,
  readLearnedPin,
  readLearnedPinSync,
  writeLearnedPin,
} from './eddy-learned-pins.ts';

const KEY = 'key-a';
const HASH = 'sha256-abc/def+g=';

describe('eddy learned pins (ADR-0194 §8)', () => {
  it('round-trips requestKey → closureHash, async and sync readers agree', async () => {
    const { vfs, fsSync } = createMemoryFs();
    expect(await readLearnedPin(vfs, KEY)).toBeUndefined();
    await writeLearnedPin(vfs, KEY, HASH);
    expect(await readLearnedPin(vfs, KEY)).toBe(HASH);
    expect(readLearnedPinSync(fsSync, KEY)).toBe(HASH);
    expect(await readLearnedPin(vfs, 'other-key')).toBeUndefined();
  });

  it('expires entries after the TTL (= server mutable default — a pin must not outlive the link it mirrors)', async () => {
    const { vfs, fsSync } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, HASH, () => nowMs);
    nowMs += 1799_000;
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toBe(HASH);
    nowMs += 2_000; // past 1800s
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toBeUndefined();
    expect(readLearnedPinSync(fsSync, KEY, () => nowMs)).toBeUndefined();
  });

  it('caps stored entries, evicting the oldest', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    for (let i = 0; i < LEARNED_PINS_CAP + 1; i++) {
      nowMs += 1_000;
      await writeLearnedPin(vfs, `key-${i}`, `sha256-${i}`, () => nowMs);
    }
    expect(await readLearnedPin(vfs, 'key-0', () => nowMs)).toBeUndefined(); // oldest evicted
    expect(await readLearnedPin(vfs, 'key-1', () => nowMs)).toBe('sha256-1');
    expect(await readLearnedPin(vfs, `key-${LEARNED_PINS_CAP}`, () => nowMs)).toBe(
      `sha256-${LEARNED_PINS_CAP}`,
    );
  });

  it('re-learning the same key replaces the hash and refreshes the TTL', async () => {
    const { vfs } = createMemoryFs();
    let nowMs = 1_000_000;
    await writeLearnedPin(vfs, KEY, 'sha256-old', () => nowMs);
    nowMs += 1_000_000;
    await writeLearnedPin(vfs, KEY, 'sha256-new', () => nowMs);
    nowMs += 1_500_000; // old stamp would be expired, new one is not
    expect(await readLearnedPin(vfs, KEY, () => nowMs)).toBe('sha256-new');
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
    expect(await readLearnedPin(vfs, KEY)).toBe(HASH);
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
