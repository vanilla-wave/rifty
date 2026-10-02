import { readFileSync } from 'node:fs';
import {
  type Packument,
  RegistryClient,
  type VersionManifest,
  compare,
} from '@riftydev/npm-client';

const root = new URL('../../../../tests/integration/fixtures/registry/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
  entries: { name: string; version: string; manifest: string; tarball: string }[];
};

/** Only network is replaced; metadata and archives are genuine vendored packages. */
export function vendoredRegistry(): RegistryClient {
  const packs = new Map<string, Packument>();
  const archives = new Map<string, string>();
  for (const entry of manifest.entries) {
    const version = JSON.parse(
      readFileSync(new URL(entry.manifest, root), 'utf8'),
    ) as VersionManifest;
    const pack = packs.get(entry.name) ?? { name: entry.name, 'dist-tags': {}, versions: {} };
    pack.versions[entry.version] = version;
    const latest = pack['dist-tags']?.latest;
    if (!latest || compare(entry.version, latest) > 0)
      pack['dist-tags'] = { latest: entry.version };
    packs.set(entry.name, pack);
    archives.set(version.dist.tarball, entry.tarball);
  }
  return new RegistryClient({
    baseUrl: 'packument:',
    fetch: async (url) => {
      const archive = archives.get(url);
      if (archive) return new Response(new Uint8Array(readFileSync(new URL(archive, root))));
      const pack = packs.get(url.replace(/^packument:\/+/, ''));
      return pack ? Response.json(pack) : new Response('missing vendored package', { status: 404 });
    },
  });
}
