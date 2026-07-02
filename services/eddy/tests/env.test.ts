import { describe, expect, it } from 'vitest';
import { parseByteCount, parseS3Config, parseTtlSeconds } from '../src/env.ts';

describe('parseTtlSeconds (EDDY_TTL_SECONDS env-config)', () => {
  it('returns undefined when unset → falls back to the default TTL', () => {
    expect(parseTtlSeconds(undefined)).toBeUndefined();
    expect(parseTtlSeconds('')).toBeUndefined();
  });

  it('parses a non-negative number of seconds', () => {
    expect(parseTtlSeconds('1800')).toBe(1800);
  });

  it('keeps 0 (always recompute) — a valid, meaningful setting', () => {
    expect(parseTtlSeconds('0')).toBe(0);
  });

  it('throws loudly on a non-numeric value instead of silently disabling the cache', () => {
    // `Number('abc')`/`Number('30s')` → NaN → `ttlMs = NaN` → both cache gates
    // (`NaN > clock`, `NaN > 0`) are false → the mutable tier is dead and every
    // request recomputes. Against the loud-failure ethos — refuse at startup.
    expect(() => parseTtlSeconds('abc')).toThrow(/EDDY_TTL_SECONDS/);
    expect(() => parseTtlSeconds('30s')).toThrow(/EDDY_TTL_SECONDS/);
  });

  it('throws on a negative value', () => {
    expect(() => parseTtlSeconds('-5')).toThrow(/EDDY_TTL_SECONDS/);
  });

  it('throws on a whitespace-only value (Number(" ") === 0 would silently disable the cache)', () => {
    // `Number(' ')`/`Number('\t')` coerce to 0, not NaN — so without an explicit
    // guard a whitespace typo passes the finite/≥0 gate and sets TTL 0 (always
    // recompute), silently killing the mutable tier. Refuse it like other junk.
    expect(() => parseTtlSeconds(' ')).toThrow(/EDDY_TTL_SECONDS/);
    expect(() => parseTtlSeconds('\t')).toThrow(/EDDY_TTL_SECONDS/);
  });

  it('names the env var it parses (packument TTL reuses the parser)', () => {
    expect(() => parseTtlSeconds('abc', 'EDDY_PACKUMENT_TTL_SECONDS')).toThrow(
      /EDDY_PACKUMENT_TTL_SECONDS/,
    );
  });
});

describe('parseByteCount (cache byte-cap env-config)', () => {
  it('returns undefined when unset, parses a positive integer', () => {
    expect(parseByteCount(undefined, 'EDDY_TARBALL_CACHE_MAX_BYTES')).toBeUndefined();
    expect(parseByteCount('', 'EDDY_TARBALL_CACHE_MAX_BYTES')).toBeUndefined();
    expect(parseByteCount('1048576', 'EDDY_TARBALL_CACHE_MAX_BYTES')).toBe(1_048_576);
  });

  it('throws loudly on junk, negatives, zero and non-integers', () => {
    for (const bad of ['abc', '-1', '0', '1.5', '1mb']) {
      expect(() => parseByteCount(bad, 'EDDY_BUNDLE_MEMORY_MAX_BYTES')).toThrow(
        /EDDY_BUNDLE_MEMORY_MAX_BYTES/,
      );
    }
  });
});

describe('parseS3Config (EDDY_S3_* — all-or-none)', () => {
  const full = {
    EDDY_S3_ENDPOINT: 'https://storage.yandexcloud.net',
    EDDY_S3_BUCKET: 'eddy-bundles',
    EDDY_S3_REGION: 'ru-central1',
    EDDY_S3_ACCESS_KEY_ID: 'key',
    EDDY_S3_SECRET_ACCESS_KEY: 'secret',
  };

  it('returns undefined when none of the vars are set (memory store default)', () => {
    expect(parseS3Config({})).toBeUndefined();
  });

  it('parses a complete config', () => {
    expect(parseS3Config(full)).toEqual({
      endpoint: 'https://storage.yandexcloud.net',
      bucket: 'eddy-bundles',
      region: 'ru-central1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
  });

  it('throws loudly on a PARTIAL config instead of shipping a half-configured store', () => {
    const { EDDY_S3_SECRET_ACCESS_KEY: _omitted, ...partial } = full;
    expect(() => parseS3Config(partial)).toThrow(/EDDY_S3_SECRET_ACCESS_KEY/);
  });
});
