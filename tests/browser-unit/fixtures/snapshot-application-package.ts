import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serializePackageJson } from '@riftydev/npm-client';
import { produceDependencySnapshot } from '../../../packages/workbench/src/glue/dep-snapshot-producer.ts';

/** Real producer and upstream ms tarball; only HTTP delivery is controlled. */
export async function bakeApplicationPackage() {
  const root = new URL('../../integration/fixtures/registry/', import.meta.url);
  const metadata = JSON.parse(await readFile(new URL('ms-2.0.0.json', root), 'utf8')) as {
    readonly dist: { readonly upstreamTarball: string; readonly upstreamIntegrity: string };
  };
  const bytes = new Uint8Array(await readFile(new URL('ms-2.0.0.tgz', root)));
  const manifest = {
    name: 'opfs-snapshot-application',
    version: '1.0.0',
    dependencies: { ms: '2.0.0' },
  };
  const manifestText = serializePackageJson(manifest);
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://registry.test/ms/-/ms-2.0.0.tgz') return new Response(bytes.slice());
    throw new Error(`Unexpected producer request: ${url}`);
  };
  try {
    const produced = await produceDependencySnapshot({
      templateId: 'opfs-ms',
      packageJsonText: manifestText,
      packageLockText: JSON.stringify({
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': manifest,
          'node_modules/ms': {
            version: '2.0.0',
            resolved: metadata.dist.upstreamTarball,
            integrity: metadata.dist.upstreamIntegrity,
          },
        },
      }),
      registryUrl: 'https://registry.test',
    });
    return { archive: [...produced.archive], snapshotId: produced.snapshotId, manifestText };
  } finally {
    globalThis.fetch = priorFetch;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await bakeApplicationPackage()));
}
