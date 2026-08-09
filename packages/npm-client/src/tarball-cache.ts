/**
 * Tarball cache (ADR-0023).
 *
 * Lives in the VFS at `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz`,
 * where `<sha-prefix>` is the first two hex chars of the integrity hash —
 * sub-dirs keep any single directory listing small.
 *
 * Keyed on `name@version`. Integrity is re-verified on lookup before bytes
 * are returned.
 */
import type { Vfs } from '@riftydev/vfs';

export const TARBALL_CACHE_ROOT = '/.rifty/tarball-cache';

/**
 * Accepted SRI algorithms. Default sha512 (npm packuments since npm@5).
 * sha256 stays supported: vendored integration fixtures (ADR-0021) use it,
 * and some private-registry mirrors serve sha256-only metadata.
 */
export type IntegrityAlgorithm = 'sha256' | 'sha384' | 'sha512';

const WEBCRYPTO_NAMES: Record<IntegrityAlgorithm, string> = {
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
};

/**
 * Parse the algorithm prefix from an SRI string (`sha512-<base64>`).
 * Returns `null` on missing/unsupported prefix — caller surfaces an
 * integrity-format error rather than defaulting and producing a misleading
 * mismatch.
 */
export function parseIntegrityAlgorithm(integrity: string): IntegrityAlgorithm | null {
  const dash = integrity.indexOf('-');
  if (dash <= 0) return null;
  const prefix = integrity.slice(0, dash);
  if (prefix === 'sha256' || prefix === 'sha384' || prefix === 'sha512') return prefix;
  return null;
}

/**
 * Hash `bytes` and return the SRI string for `algorithm` (default sha512).
 * When verifying against a known `spec.integrity`, pass the algorithm parsed
 * from that spec so the comparison is apples-to-apples.
 */
export async function computeIntegrity(
  bytes: Uint8Array,
  algorithm: IntegrityAlgorithm = 'sha512',
): Promise<string> {
  const digest = await crypto.subtle.digest(
    WEBCRYPTO_NAMES[algorithm],
    bytes as unknown as BufferSource,
  );
  const bin = String.fromCharCode(...new Uint8Array(digest));
  const b64 = btoa(bin);
  return `${algorithm}-${b64}`;
}

/** Exact VFS key used by cache writers and portable snapshot replay state. */
export function tarballCachePath(name: string, version: string, integrity: string): string {
  const prefix = integrity.includes('-') ? (integrity.split('-')[1]?.slice(0, 2) ?? '00') : '00';
  // Escape slashes in scoped names so each entry stays a single file rather
  // than spawning extra path segments under the prefix.
  const safeName = name.replace(/\//g, '__');
  return `${TARBALL_CACHE_ROOT}/${prefix}/${safeName}-${version}.tgz`;
}

export interface TarballCache {
  /** Returns cached bytes if present and integrity-matches, else null. */
  get(name: string, version: string, integrity: string): Promise<Uint8Array | null>;
  /** Stores bytes under the (name, version, integrity) key. Returns the path. */
  put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string>;
}

export class VfsTarballCache implements TarballCache {
  constructor(private readonly vfs: Vfs) {}

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    const path = tarballCachePath(name, version, integrity);
    if (!(await this.vfs.exists(path))) return null;
    const bytes = await this.vfs.readFile(path);
    const algorithm = parseIntegrityAlgorithm(integrity);
    if (algorithm === null) {
      // Unknown algorithm: cannot re-verify, so miss — caller refetches and
      // the fetch path surfaces the format error loudly.
      return null;
    }
    const actual = await computeIntegrity(bytes, algorithm);
    if (actual !== integrity) {
      // Corrupted entry — caller will refetch.
      return null;
    }
    return bytes;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    const path = tarballCachePath(name, version, integrity);
    const dir = path.slice(0, path.lastIndexOf('/'));
    await this.vfs.mkdir(dir, { recursive: true });
    await this.vfs.writeFile(path, bytes);
    return path;
  }
}
