/**
 * Tarball cache (ADR-0023).
 *
 * Lives in the VFS at `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz`,
 * where `<sha-prefix>` is the first two hex characters of the entry's
 * integrity hash. The split into sub-directories keeps any single directory
 * listing small while remaining trivially navigable.
 *
 * Each entry is keyed on `name@version`; the `resolved` URL and `integrity`
 * from the lockfile (or computed at first fetch) accompany the bytes. On
 * lookup we re-verify the integrity before handing bytes back.
 */
import type { Vfs } from '@rifty/vfs';

export const TARBALL_CACHE_ROOT = '/.rifty/tarball-cache';

/**
 * Subresource-integrity algorithms we accept. SRI permits sha256, sha384,
 * and sha512; npm packuments default to sha512 since npm@5, so that is the
 * default we use when generating a fresh integrity. sha256 stays supported
 * because the vendored integration fixtures (ADR-0021) were generated with
 * it, and some private-registry mirrors still serve sha256-only metadata.
 */
export type IntegrityAlgorithm = 'sha256' | 'sha384' | 'sha512';

const WEBCRYPTO_NAMES: Record<IntegrityAlgorithm, string> = {
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
};

/**
 * Parse the algorithm prefix from an SRI string (`sha512-<base64>`).
 * Returns `null` when the prefix is missing or names an algorithm we do not
 * support — the caller should surface that as an integrity-format error
 * rather than falling through to a default and producing a misleading
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
 * Hash `bytes` and return the SRI string for the chosen algorithm. Default
 * is `sha512` (matches modern npm); callers verifying against a known
 * `spec.integrity` should pass the algorithm parsed from that spec so the
 * comparison is apples-to-apples.
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

function cachePathFor(name: string, version: string, integrity: string): string {
  const prefix = integrity.includes('-') ? (integrity.split('-')[1]?.slice(0, 2) ?? '00') : '00';
  // Slashes in scoped names would otherwise create extra path segments under
  // the prefix; escape them so each entry is a single file.
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
    const path = cachePathFor(name, version, integrity);
    if (!(await this.vfs.exists(path))) return null;
    const bytes = await this.vfs.readFile(path);
    const algorithm = parseIntegrityAlgorithm(integrity);
    if (algorithm === null) {
      // Unknown algorithm in the integrity string — cannot re-verify, treat
      // as a miss so the caller refetches and the fetch path surfaces the
      // format error loudly.
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
    const path = cachePathFor(name, version, integrity);
    const dir = path.slice(0, path.lastIndexOf('/'));
    await this.vfs.mkdir(dir, { recursive: true });
    await this.vfs.writeFile(path, bytes);
    return path;
  }
}
