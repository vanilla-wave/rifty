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

/** SHA-256-based subresource-integrity string: `sha256-<base64>`. */
export async function computeIntegrity(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const bin = String.fromCharCode(...new Uint8Array(digest));
  const b64 = btoa(bin);
  return `sha256-${b64}`;
}

function cachePathFor(name: string, version: string, integrity: string): string {
  const prefix = integrity.includes('-') ? integrity.split('-')[1]?.slice(0, 2) ?? '00' : '00';
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
    const actual = await computeIntegrity(bytes);
    if (actual !== integrity) {
      // Corrupted entry — caller will refetch.
      return null;
    }
    return bytes;
  }

  async put(
    name: string,
    version: string,
    integrity: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const path = cachePathFor(name, version, integrity);
    const dir = path.slice(0, path.lastIndexOf('/'));
    await this.vfs.mkdir(dir, { recursive: true });
    await this.vfs.writeFile(path, bytes);
    return path;
  }
}
