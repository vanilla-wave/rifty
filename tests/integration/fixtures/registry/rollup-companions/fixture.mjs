import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
export const registryUrl = 'https://companion-registry.test';

export async function inputFixture(name) {
  const [packageJsonText, packageLockText] = await Promise.all([
    readFile(new URL(`${name}/package.json`, root), 'utf8'),
    readFile(new URL(`${name}/package-lock.json`, root), 'utf8'),
  ]);
  return { packageJsonText, packageLockText };
}

/** Only HTTP is replaced. Metadata and archive bytes are original npm responses. */
export async function registryFixture() {
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  const packages = await Promise.all(
    provenance.packages.map(async (entry) => {
      const [metadataText, tarball] = await Promise.all([
        readFile(new URL(`packages/${entry.file}.json`, root), 'utf8'),
        readFile(new URL(`packages/${entry.file}.tgz`, root)),
      ]);
      const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
      if (integrity !== entry.integrity || tarball.byteLength !== entry.bytes) {
        throw new Error(`Original npm fixture integrity drift: ${entry.name}@${entry.version}`);
      }
      return { metadata: JSON.parse(metadataText), tarball };
    }),
  );
  const requests = [];
  const fetcher = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    requests.push({ url: url.href, method: init?.method ?? 'GET' });
    if (![registryUrl, 'https://registry.npmjs.org'].includes(url.origin)) {
      throw new Error(`Unexpected fixture origin ${url.origin}`);
    }
    const pathname = decodeURIComponent(url.pathname);
    const archive = packages.find(
      ({ metadata }) => new URL(metadata.dist.tarball).pathname === pathname,
    );
    if (archive) return new Response(new Uint8Array(archive.tarball).buffer);
    const versions = packages.filter(({ metadata }) => `/${metadata.name}` === pathname);
    if (versions.length === 0) throw new Error(`Unexpected fixture HTTP ${url.href}`);
    return Response.json({
      name: versions[0].metadata.name,
      'dist-tags': { latest: versions[0].metadata.version },
      versions: Object.fromEntries(versions.map(({ metadata }) => [metadata.version, metadata])),
    });
  };
  return {
    requests,
    fetch: fetcher,
    tarball(name, version) {
      const pkg = packages.find(
        ({ metadata }) => metadata.name === name && metadata.version === version,
      );
      if (!pkg) throw new Error(`Missing real tarball ${name}@${version}`);
      return new Uint8Array(pkg.tarball);
    },
  };
}
