import { describe, expect, it } from 'vitest';
import {
  EDDY_BUNDLE_FORMAT,
  type EddyBundleSource,
  isIsoDateString,
  packEddyBundle,
  unpackEddyBundle,
} from './eddy-bundle.ts';

function bytes(...nums: number[]): Uint8Array {
  return new Uint8Array(nums);
}

function sampleContents(): EddyBundleSource {
  return {
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.1.0',
      asOf: {
        resolvedAt: '2026-06-30T00:00:00.000Z',
        registry: 'https://registry.npmjs.org',
        closureHash: 'sha256-deadbeef',
      },
      tarballs: [
        { file: 'tarballs/ms-2.1.3.tgz', name: 'ms', version: '2.1.3', integrity: 'sha512-aaa' },
        {
          file: 'tarballs/@scope__pkg-1.0.0.tgz',
          name: '@scope/pkg',
          version: '1.0.0',
          integrity: 'sha512-bbb',
        },
      ],
    },
    lockfileText: JSON.stringify({ name: 'root', lockfileVersion: 3 }, null, 2),
    tarballs: [
      {
        entry: {
          file: 'tarballs/ms-2.1.3.tgz',
          name: 'ms',
          version: '2.1.3',
          integrity: 'sha512-aaa',
        },
        bytes: bytes(0x1f, 0x8b, 1, 2, 3, 4, 5),
      },
      {
        entry: {
          file: 'tarballs/@scope__pkg-1.0.0.tgz',
          name: '@scope/pkg',
          version: '1.0.0',
          integrity: 'sha512-bbb',
        },
        bytes: bytes(0x1f, 0x8b, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
      },
    ],
  };
}

describe('isIsoDateString — the resolvedAt honesty-stamp gate', () => {
  it('accepts real ISO timestamps', () => {
    expect(isIsoDateString('2026-07-10T16:45:51.504Z')).toBe(true);
    expect(isIsoDateString('2026-07-10T16:45:51Z')).toBe(true);
    expect(isIsoDateString('2024-02-29T00:00:00Z')).toBe(true); // leap day
  });

  it('rejects junk and non-strings', () => {
    expect(isIsoDateString('July 10')).toBe(false);
    expect(isIsoDateString('not-a-date')).toBe(false);
    expect(isIsoDateString(1720627551)).toBe(false);
    expect(isIsoDateString(undefined)).toBe(false);
  });

  it('rejects calendar-impossible dates Date.parse silently rolls over', () => {
    // Review round 3: Date.parse('2026-02-30…') "parses" to March 2 — the
    // honesty line would print a timestamp that never existed.
    expect(isIsoDateString('2026-02-30T12:00:00Z')).toBe(false);
    expect(isIsoDateString('2026-02-29T12:00:00Z')).toBe(false); // not a leap year
    expect(isIsoDateString('2026-04-31T12:00:00Z')).toBe(false);
    expect(isIsoDateString('2026-13-01T12:00:00Z')).toBe(false);
    expect(isIsoDateString('2026-00-10T12:00:00Z')).toBe(false);
    expect(isIsoDateString('2026-07-00T12:00:00Z')).toBe(false);
  });
});

describe('EddyBundleV1 codec', () => {
  it('round-trips manifest, lockfile text, and tarball bytes', () => {
    const contents = sampleContents();
    const packed = packEddyBundle(contents);
    expect(packed).toBeInstanceOf(Uint8Array);

    const out = unpackEddyBundle(packed);
    expect(out.manifest).toEqual(contents.manifest);
    expect(out.lockfileText).toBe(contents.lockfileText);
    expect(out.tarballs).toHaveLength(2);
    for (const original of contents.tarballs) {
      const found = out.tarballs.find((t) => t.entry.file === original.entry.file);
      expect(found, `tarball ${original.entry.file}`).toBeDefined();
      expect(found?.entry).toEqual(original.entry);
      expect(found ? [...found.bytes] : null).toEqual([...original.bytes]);
    }
  });

  it('round-trips a file path longer than the 100-byte ustar name field (GNU long name)', () => {
    const longName =
      'tarballs/@really-long-scope__a-package-with-an-extremely-long-name-that-exceeds-one-hundred-bytes-easily-1.2.3.tgz';
    expect(longName.length).toBeGreaterThan(100);
    const contents: EddyBundleSource = {
      manifest: {
        format: EDDY_BUNDLE_FORMAT,
        npmClientVersion: '0.1.0',
        asOf: { resolvedAt: '2026-06-30T00:00:00.000Z', registry: 'r', closureHash: 'h' },
        tarballs: [
          {
            file: longName,
            name: '@really-long-scope/a-package-with-an-extremely-long-name-that-exceeds-one-hundred-bytes-easily',
            version: '1.2.3',
            integrity: 'sha512-ccc',
          },
        ],
      },
      lockfileText: '{}',
      tarballs: [
        {
          entry: {
            file: longName,
            name: '@really-long-scope/a-package-with-an-extremely-long-name-that-exceeds-one-hundred-bytes-easily',
            version: '1.2.3',
            integrity: 'sha512-ccc',
          },
          bytes: bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
        },
      ],
    };
    const out = unpackEddyBundle(packEddyBundle(contents));
    expect(out.tarballs).toHaveLength(1);
    expect(out.tarballs[0]?.entry.file).toBe(longName);
    expect(out.tarballs[0] ? [...out.tarballs[0].bytes] : null).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it('round-trips an empty tarball set (lockfile-only)', () => {
    const contents: EddyBundleSource = {
      manifest: {
        format: EDDY_BUNDLE_FORMAT,
        npmClientVersion: '0.1.0',
        asOf: { resolvedAt: '2026-06-30T00:00:00.000Z', registry: 'r', closureHash: 'h' },
        tarballs: [],
      },
      lockfileText: '{"empty":true}',
      tarballs: [],
    };
    const out = unpackEddyBundle(packEddyBundle(contents));
    expect(out.manifest.tarballs).toEqual([]);
    expect(out.tarballs).toEqual([]);
    expect(out.lockfileText).toBe('{"empty":true}');
  });

  it('rejects bytes that are not a valid EddyBundleV1 (missing manifest)', () => {
    expect(() => unpackEddyBundle(new Uint8Array(1024))).toThrow(/EddyBundle/i);
  });
});
