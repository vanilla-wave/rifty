/**
 * Unit tests for the shared {@link fetchAndUnpackToCache} pipeline.
 *
 * These cases prove the safer (verifying) side wins on both call paths:
 *   - cache returns null on tampered bytes → refetch occurs (preserves the
 *     ADR-0023 corruption-guard conformance contract);
 *   - on cache miss, network bytes are integrity-checked against the
 *     expected pin → mismatch throws `EINTEGRITY` (closes the live-path's
 *     previous silent acceptance).
 */
import { MemoryVfs } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';
import { fetchAndUnpackToCache } from './fetch-and-unpack.ts';
import { type TarballCache, VfsTarballCache, computeIntegrity } from './tarball-cache.ts';

const enc = new TextEncoder();

function makeBytes(s: string): Uint8Array {
  return enc.encode(s);
}

describe('fetchAndUnpackToCache — cache-hit verification', () => {
  it('returns cached bytes as a hit when integrity matches', async () => {
    const vfs = new MemoryVfs();
    const cache = new VfsTarballCache(vfs);
    const original = makeBytes('original tarball bytes');
    const integrity = await computeIntegrity(original);
    await cache.put('foo', '1.0.0', integrity, original);

    let fetched = false;
    const result = await fetchAndUnpackToCache(
      { name: 'foo', version: '1.0.0', resolved: 'fake://foo/1.0.0', integrity },
      {
        cache,
        getTarball: async () => {
          fetched = true;
          return makeBytes('SHOULD NOT BE CALLED');
        },
      },
    );

    expect(fetched).toBe(false);
    expect(result.cacheHit).toBe(true);
    expect(result.integrity).toBe(integrity);
    expect(result.bytes).toEqual(original);
  });

  it('falls through to refetch when the cached bytes have been tampered with', async () => {
    // Cache primitive returns null on integrity mismatch (corruption guard
    // per ADR-0023 lockfile-reuse conformance). The helper must then go to
    // the network and verify those bytes too. This preserves the
    // "tampered cache → refetch" contract that landed with A-030.
    const vfs = new MemoryVfs();
    const cache = new VfsTarballCache(vfs);
    const original = makeBytes('tarball A');
    const integrity = await computeIntegrity(original);
    // Pre-populate the cache with `original`'s integrity-derived path but
    // garbage contents — exactly what a corrupted-on-disk entry looks like.
    await cache.put('foo', '1.0.0', integrity, original);
    // Force corruption by overwriting via raw vfs.
    const cachePath = `/.rifty/tarball-cache/${integrity.split('-')[1]?.slice(0, 2)}/foo-1.0.0.tgz`;
    await vfs.writeFile(cachePath, makeBytes('CORRUPTED'));

    let fetchCalls = 0;
    const result = await fetchAndUnpackToCache(
      { name: 'foo', version: '1.0.0', resolved: 'fake://foo/1.0.0', integrity },
      {
        cache,
        getTarball: async () => {
          fetchCalls++;
          return original;
        },
      },
    );

    expect(fetchCalls).toBe(1);
    expect(result.cacheHit).toBe(false);
    expect(result.integrity).toBe(integrity);
    expect(result.bytes).toEqual(original);
  });
});

describe('fetchAndUnpackToCache — network integrity verification', () => {
  it('throws EINTEGRITY when fetched bytes do not match the expected pin', async () => {
    const vfs = new MemoryVfs();
    const cache = new VfsTarballCache(vfs);
    const realBytes = makeBytes('what we asked for');
    const expectedIntegrity = await computeIntegrity(realBytes);
    const wrongBytes = makeBytes('a different tarball entirely');

    let caught: unknown;
    try {
      await fetchAndUnpackToCache(
        {
          name: 'evil',
          version: '1.0.0',
          resolved: 'fake://evil/1.0.0',
          integrity: expectedIntegrity,
        },
        {
          cache,
          getTarball: async () => wrongBytes,
        },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & {
      code?: string;
      packageName?: string;
      version?: string;
      expected?: string;
      actual?: string;
    };
    expect(err.code).toBe('EINTEGRITY');
    expect(err.packageName).toBe('evil');
    expect(err.version).toBe('1.0.0');
    expect(err.expected).toBe(expectedIntegrity);
    expect(err.actual).toBeDefined();
    expect(err.actual).not.toBe(expectedIntegrity);
  });

  it('computes and returns integrity when no expected hash is supplied', async () => {
    const vfs = new MemoryVfs();
    const cache = new VfsTarballCache(vfs);
    const bytes = makeBytes('an authoritative blob');
    const expected = await computeIntegrity(bytes);

    const result = await fetchAndUnpackToCache(
      { name: 'unsigned', version: '0.1.0', resolved: 'fake://x/0.1.0' },
      {
        cache,
        getTarball: async () => bytes,
      },
    );
    expect(result.cacheHit).toBe(false);
    expect(result.integrity).toBe(expected);
    expect(result.bytes).toEqual(bytes);
  });

  it('verifies against sha512 when the spec uses sha512 (npm packument default)', async () => {
    // Regression for 2026-05-27 live express install: the registry returns
    // `sha512-…` on every modern packument; before the algorithm-aware
    // verifier landed we compared a freshly-computed sha256 to it and threw
    // EINTEGRITY for every real package. Round-trip with an explicit sha512
    // pin proves the fetch path picks the right algorithm.
    const vfs = new MemoryVfs();
    const cache = new VfsTarballCache(vfs);
    const bytes = makeBytes('a tarball verified via sha512');
    const sha512Pin = await computeIntegrity(bytes, 'sha512');
    expect(sha512Pin.startsWith('sha512-')).toBe(true);

    const result = await fetchAndUnpackToCache(
      { name: 'modern', version: '5.2.1', resolved: 'fake://modern/5.2.1', integrity: sha512Pin },
      { cache, getTarball: async () => bytes },
    );

    expect(result.cacheHit).toBe(false);
    expect(result.integrity).toBe(sha512Pin);
    expect(result.bytes).toEqual(bytes);
  });

  it('throws when the spec integrity uses an algorithm we do not support', async () => {
    const vfs = new MemoryVfs();
    const cache = new VfsTarballCache(vfs);
    const bytes = makeBytes('any bytes');

    let caught: unknown;
    try {
      await fetchAndUnpackToCache(
        {
          name: 'weird',
          version: '1.0.0',
          resolved: 'fake://weird/1.0.0',
          integrity: 'md5-deadbeef',
        },
        { cache, getTarball: async () => bytes },
      );
    } catch (err) {
      caught = err;
    }
    const err = caught as Error & { code?: string };
    expect(err.code).toBe('EINTEGRITY');
    expect(err.message).toContain('Unsupported integrity algorithm');
  });

  it('writes the verified bytes to the cache exactly once', async () => {
    const vfs = new MemoryVfs();
    const realPut = new VfsTarballCache(vfs).put.bind(new VfsTarballCache(vfs));
    let putCalls = 0;
    const cache: TarballCache = {
      async get() {
        return null;
      },
      async put(name, version, integrity, bytes) {
        putCalls++;
        return realPut(name, version, integrity, bytes);
      },
    };
    const bytes = makeBytes('only once');
    const integrity = await computeIntegrity(bytes);

    await fetchAndUnpackToCache(
      { name: 'once', version: '1.0.0', resolved: 'fake://once/1.0.0', integrity },
      { cache, getTarball: async () => bytes },
    );

    expect(putCalls).toBe(1);
  });
});
