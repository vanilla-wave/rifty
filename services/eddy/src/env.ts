/**
 * Env-config parsing for the eddy bin (D-004 style at the server boundary).
 * Every parser refuses junk loudly at startup — a coerced `NaN` silently
 * disables the cache it configures (the loud-failure ethos).
 */

import type { S3BundleStoreOptions } from './s3-bundle-store.ts';

/**
 * Parse a TTL env var (`EDDY_TTL_SECONDS`, `EDDY_PACKUMENT_TTL_SECONDS`).
 * Unset → `undefined` (the cache uses its default). Otherwise it MUST be a
 * finite number ≥ 0 (`0` = always recompute / cache off).
 */
export function parseTtlSeconds(
  raw: string | undefined,
  name = 'EDDY_TTL_SECONDS',
): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  // `Number(' ')`/`Number('\t')` coerce to 0 (not NaN), so a whitespace-only
  // value would slip past the finite/≥0 gate and silently set TTL 0 (always
  // recompute) — a dead cache. Treat it as junk, not "0".
  if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${name} must be a non-negative number of seconds (0 = always recompute); got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/**
 * Parse a byte-cap env var (`EDDY_TARBALL_CACHE_MAX_BYTES`,
 * `EDDY_BUNDLE_MEMORY_MAX_BYTES`). Unset → `undefined` (default cap). A cap
 * must be a positive integer — `0` would silently disable the cache it
 * bounds, so it is refused like any junk.
 */
export function parseByteCount(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer byte count; got ${JSON.stringify(raw)}`);
  }
  return value;
}

const S3_ENV_KEYS = {
  endpoint: 'EDDY_S3_ENDPOINT',
  bucket: 'EDDY_S3_BUCKET',
  region: 'EDDY_S3_REGION',
  accessKeyId: 'EDDY_S3_ACCESS_KEY_ID',
  secretAccessKey: 'EDDY_S3_SECRET_ACCESS_KEY',
} as const;

export type S3EnvConfig = Pick<
  S3BundleStoreOptions,
  'endpoint' | 'bucket' | 'region' | 'accessKeyId' | 'secretAccessKey'
>;

/**
 * Parse the `EDDY_S3_*` group (ADR-0194 §4). None set → `undefined` (memory
 * store). ALL set → the store config. A partial group throws, naming the
 * missing vars — a half-configured store must never boot. Values are TRIMMED
 * and junk is refused loudly (this file's contract): a whitespace-only var
 * counts as missing, an endpoint that is not an http(s) URL throws. Error
 * messages name the VAR, never a secret value.
 */
export function parseS3Config(env: Record<string, string | undefined>): S3EnvConfig | undefined {
  const entries = Object.entries(S3_ENV_KEYS) as Array<
    [keyof S3EnvConfig, (typeof S3_ENV_KEYS)[keyof typeof S3_ENV_KEYS]]
  >;
  const values = new Map<keyof S3EnvConfig, string>();
  for (const [field, envKey] of entries) {
    const trimmed = env[envKey]?.trim();
    if (trimmed) values.set(field, trimmed);
  }
  if (values.size === 0) return undefined;
  const missing = entries.filter(([field]) => !values.has(field)).map(([, envKey]) => envKey);
  if (missing.length > 0) {
    throw new Error(
      `EDDY_S3_* is partially configured — missing/blank ${missing.join(', ')} (set all of ${entries
        .map(([, k]) => k)
        .join(', ')} or none)`,
    );
  }
  const endpoint = values.get('endpoint') as string;
  let parsed: URL | null = null;
  try {
    parsed = new URL(endpoint);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new Error(
      `${S3_ENV_KEYS.endpoint} must be an http(s) URL (e.g. https://storage.yandexcloud.net); got ${JSON.stringify(endpoint)}`,
    );
  }
  for (const field of ['bucket', 'region'] as const) {
    const value = values.get(field) as string;
    if (/\s/.test(value)) {
      throw new Error(
        `${S3_ENV_KEYS[field]} must not contain whitespace; got ${JSON.stringify(value)}`,
      );
    }
  }
  const out = {} as Record<keyof S3EnvConfig, string>;
  for (const [field] of entries) out[field] = values.get(field) as string;
  return out;
}
