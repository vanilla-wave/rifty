/**
 * Vendored-tarball "fake registry" loader (ADR-0021).
 *
 * Reads `./registry/manifest.json` at module load, then serves packuments and
 * tarballs for the vendored entries through a `Fetcher` compatible with
 * `@rifty/npm-client`'s `RegistryClient`. URL contract:
 *
 *  - `packument:<name>`  → JSON `Packument` synthesised from the per-package
 *                          version manifest in `./registry/<name>.json`.
 *  - `tarball:<name>-<version>` → raw `.tgz` bytes from `./registry/`.
 *
 * Pair with `new RegistryClient({ baseUrl: 'packument:', fetch: makeLocalFetcher() })`
 * and the installer will route everything to the vendored bytes — no network,
 * no hand-built tar blobs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fetcher, Packument, VersionManifest } from '@rifty/npm-client';

interface ManifestEntry {
  name: string;
  version: string;
  manifest: string;
  tarball: string;
  integrity: string;
}

interface RegistryManifest {
  description: string;
  source: string;
  integrityAlgorithm: string;
  entries: ManifestEntry[];
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'registry');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, relativePath), 'utf8')) as T;
}

const REGISTRY: RegistryManifest = readJson<RegistryManifest>('manifest.json');

/** Synthesised packuments, keyed by package name. */
const PACKUMENTS = new Map<string, Packument>();
/** Tarball bytes, keyed by the fixture URL (`tarball:<name>-<version>`). */
const TARBALLS = new Map<string, Uint8Array>();

for (const entry of REGISTRY.entries) {
  const version = readJson<VersionManifest>(entry.manifest);
  const existing = PACKUMENTS.get(entry.name);
  const packument: Packument = existing ?? {
    name: entry.name,
    'dist-tags': {},
    versions: {},
  };
  packument.versions[entry.version] = version;
  // Newest entry wins for `latest`. Good enough since the fixture set is tiny.
  packument['dist-tags'] = { ...packument['dist-tags'], latest: entry.version };
  PACKUMENTS.set(entry.name, packument);

  const tarballBytes = readFileSync(join(FIXTURE_DIR, entry.tarball));
  TARBALLS.set(version.dist.tarball, new Uint8Array(tarballBytes));
}

/** Counters useful for asserting cache/lockfile reuse in tests. */
export interface FetcherCalls {
  packument: number;
  tarball: number;
  unknown: number;
}

/** The base URL to pair with the returned fetcher. */
export const LOCAL_REGISTRY_BASE_URL = 'packument:';

/** List of vendored entries (for table-driven tests). */
export const VENDORED_ENTRIES: readonly ManifestEntry[] = REGISTRY.entries;

export interface LocalFetcher {
  fetch: Fetcher;
  calls: FetcherCalls;
}

/**
 * Build a fetcher that resolves `packument:` and `tarball:` URLs against the
 * vendored fixtures. The returned `calls` object is mutated as requests flow.
 */
export function makeLocalFetcher(): LocalFetcher {
  const calls: FetcherCalls = { packument: 0, tarball: 0, unknown: 0 };
  const fetch: Fetcher = async (url: string): Promise<Response> => {
    if (url.startsWith('tarball:')) {
      calls.tarball++;
      const bytes = TARBALLS.get(url);
      if (!bytes) return new Response('', { status: 404 });
      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    if (url.startsWith('packument:')) {
      calls.packument++;
      // `RegistryClient` produces `packument:/<name>`; strip the leading `/`.
      const name = url.slice('packument:'.length).replace(/^\/+/, '');
      const packument = PACKUMENTS.get(name);
      if (!packument) return new Response('', { status: 404 });
      return new Response(JSON.stringify(packument), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.unknown++;
    return new Response('', { status: 404 });
  };
  return { fetch, calls };
}
