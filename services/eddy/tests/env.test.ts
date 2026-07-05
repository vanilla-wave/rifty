import { describe, expect, it } from 'vitest';
import { parseByteCount, parsePort, parseS3Config, parseTtlSeconds } from '../src/env.ts';

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

describe('parsePort (PORT env-config)', () => {
  it('returns undefined when unset → the bin applies its default', () => {
    expect(parsePort(undefined)).toBeUndefined();
    expect(parsePort('')).toBeUndefined();
  });

  it('parses a valid port', () => {
    expect(parsePort('8788')).toBe(8788);
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
  });

  it('throws loudly on junk instead of drifting into an invalid listen', () => {
    // `Number('abc')` = NaN and `Number(' ')` = 0 both used to reach
    // `server.listen(...)` unrefused — against the loud-startup contract.
    for (const bad of ['abc', ' ', '\t', '-1', '0', '65536', '1.5', '8788px']) {
      expect(() => parsePort(bad)).toThrow(/PORT must be an integer in 1\.\.65535/);
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

  it('a whitespace-only value is MISSING, not present — the group stays all-or-none honest', () => {
    // `'   '` passed the old truthiness check, so a blank endpoint booted the
    // S3 store with junk — against this file's loud-startup contract.
    expect(() => parseS3Config({ ...full, EDDY_S3_BUCKET: '   ' })).toThrow(/EDDY_S3_BUCKET/);
    // ALL blank/unset → memory store, not an error.
    expect(parseS3Config({ EDDY_S3_ENDPOINT: ' ', EDDY_S3_BUCKET: '\t' })).toBeUndefined();
  });

  it('trims surrounding whitespace off accepted values', () => {
    expect(parseS3Config({ ...full, EDDY_S3_BUCKET: '  eddy-bundles  ' })?.bucket).toBe(
      'eddy-bundles',
    );
  });

  it('refuses a non-URL endpoint, naming the var (never a secret value)', () => {
    for (const bad of ['not a url', 'storage.yandexcloud.net', 'ftp://x']) {
      expect(() => parseS3Config({ ...full, EDDY_S3_ENDPOINT: bad })).toThrow(
        /EDDY_S3_ENDPOINT must be an http\(s\) URL/,
      );
    }
  });

  it('refuses a cleartext http endpoint — signed PUTs would leak the Authorization header', () => {
    expect(() =>
      parseS3Config({ ...full, EDDY_S3_ENDPOINT: 'http://storage.example.com' }),
    ).toThrow(/must be HTTPS/);
  });

  it('allows plain http ONLY for a loopback test seam (local mock S3)', () => {
    for (const seam of ['http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000']) {
      expect(parseS3Config({ ...full, EDDY_S3_ENDPOINT: seam })?.endpoint).toBe(seam);
    }
  });

  it('refuses inner whitespace in bucket/region', () => {
    expect(() => parseS3Config({ ...full, EDDY_S3_BUCKET: 'my bucket' })).toThrow(/EDDY_S3_BUCKET/);
    expect(() => parseS3Config({ ...full, EDDY_S3_REGION: 'ru central1' })).toThrow(
      /EDDY_S3_REGION/,
    );
  });

  it('refuses a bucket outside the conservative S3 name subset — urlFor interpolates it into the path (round 16)', () => {
    // `/`, `\` or dot segments would silently address nested/normalized
    // bucket paths instead of failing loudly at startup.
    for (const bad of ['my/bucket', 'my\\bucket', '..', 'a..b', 'UPPER', 'x', '-lead', 'trail-']) {
      expect(() => parseS3Config({ ...full, EDDY_S3_BUCKET: bad })).toThrow(
        /EDDY_S3_BUCKET must be an S3 bucket name/,
      );
    }
    expect(parseS3Config({ ...full, EDDY_S3_BUCKET: 'my.dotted-bucket9' })?.bucket).toBe(
      'my.dotted-bucket9',
    );
  });

  it('refuses a region outside a-z 0-9 - (round 16)', () => {
    for (const bad of ['ru_central1', 'ru/central1', 'RU-CENTRAL1', 'ru.central1']) {
      expect(() => parseS3Config({ ...full, EDDY_S3_REGION: bad })).toThrow(
        /EDDY_S3_REGION must be a region id/,
      );
    }
    expect(parseS3Config({ ...full, EDDY_S3_REGION: 'us-east-1' })?.region).toBe('us-east-1');
  });

  it('never includes the secret pair values in error messages', () => {
    try {
      parseS3Config({ ...full, EDDY_S3_ENDPOINT: 'junk' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('secret');
      expect(msg).not.toContain('key');
    }
  });
});
