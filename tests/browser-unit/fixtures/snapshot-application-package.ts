import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { serializePackageJson } from '@riftydev/npm-client';
import { produceDependencySnapshot } from '../../../packages/workbench/src/glue/dep-snapshot-producer.ts';
import { decodeDepSnapshotTar } from '../../../packages/workbench/src/glue/dep-snapshot-tar.ts';
import {
  parseDepSnapshot,
  serializeDepSnapshotTar,
} from '../../../packages/workbench/src/glue/dep-snapshot.ts';

/** Real producer and upstream ms tarball; only HTTP delivery is controlled. */
export async function bakeApplicationPackage(version = '1.0.0', msVersion = '2.0.0') {
  const root = new URL('../../integration/fixtures/registry/', import.meta.url);
  const metadata = JSON.parse(
    await readFile(new URL(msVersion === '2.0.0' ? 'ms-2.0.0.json' : 'ms.json', root), 'utf8'),
  ) as {
    readonly name: string;
    readonly version: string;
    readonly main: string;
    readonly dist: { readonly upstreamTarball: string; readonly upstreamIntegrity: string };
  };
  const bytes = new Uint8Array(await readFile(new URL(`ms-${msVersion}.tgz`, root)));
  const manifest = {
    name: 'opfs-snapshot-application',
    version,
    dependencies: { ms: msVersion },
  };
  const manifestText = serializePackageJson(manifest);
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://registry.test/ms/-/ms-${msVersion}.tgz`)
      return new Response(bytes.slice());
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
            version: msVersion,
            resolved: metadata.dist.upstreamTarball,
            integrity: metadata.dist.upstreamIntegrity,
          },
        },
      }),
      registryUrl: 'https://registry.test',
    });
    const parsed = parseDepSnapshot(
      JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(produced.archive)))),
    );
    const incompatibleBytes = serializeDepSnapshotTar({
      ...parsed,
      installArtifactIdentity: `sha256:${'0'.repeat(64)}`,
    });
    const reservedBytes = new TextEncoder().encode(
      JSON.stringify({
        ...parsed,
        nodeModules: {
          ...parsed.nodeModules,
          files: [
            ...parsed.nodeModules.files,
            {
              path: 'nested/node_modules/.rifty-install-stamp.json',
              encoding: 'base64',
              content: btoa('forged'),
            },
          ],
        },
      }),
    );
    const malformedBytes = new TextEncoder().encode('not a snapshot envelope');
    const invalid = (bytes: Uint8Array) => ({
      archive: [...gzipSync(bytes)],
      snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    return {
      reserved: invalid(reservedBytes),
      incompatible: invalid(incompatibleBytes),
      malformed: invalid(malformedBytes),
      archive: [...produced.archive],
      snapshotId: produced.snapshotId,
      manifestText,
      packageManifest: {
        ...metadata,
        dist: {
          tarball: metadata.dist.upstreamTarball,
          integrity: metadata.dist.upstreamIntegrity,
        },
      },
      packageTarball: [...bytes],
    };
  } finally {
    globalThis.fetch = priorFetch;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await bakeApplicationPackage(process.argv[2], process.argv[3])));
}
