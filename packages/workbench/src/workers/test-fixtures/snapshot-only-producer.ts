import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { serializePackageJson } from '@riftydev/npm-client';
import { expect, vi } from 'vitest';
import { produceDependencySnapshot } from '../../glue/dep-snapshot-producer.ts';
import { decodeDepSnapshotTar } from '../../glue/dep-snapshot-tar.ts';
import { parseDepSnapshot } from '../../glue/dep-snapshot.ts';
import type { SavedSnapshotFixture } from './snapshot-saved-state.ts';

/** Published producer algorithm and native lock; only upstream HTTP delivery is controlled. */
export async function bakeSnapshotOnlyShadowFixture(): Promise<SavedSnapshotFixture> {
  const registryUrl = 'https://snapshot-registry.test';
  const fixtureRoot = new URL(
    '../../../../../tools/shadow-registry/src/fixtures/',
    import.meta.url,
  );
  const metadata = JSON.parse(
    await readFile(new URL('lightningcss-wasm-1.32.0-registry.json', fixtureRoot), 'utf8'),
  ) as {
    readonly name: string;
    readonly version: string;
    readonly dist: { readonly integrity: string };
  };
  const lock = JSON.parse(
    await readFile(
      new URL(
        '../../../../../tests/e2e/fixtures/npm-lock-replay/vite8/package-lock.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    readonly packages: Readonly<Record<string, unknown>>;
  };
  const nativePin = lock.packages['node_modules/lightningcss'];
  expect(nativePin).toBeDefined();
  const tarball = new Uint8Array(
    await readFile(new URL('lightningcss-wasm-1.32.0.tgz', fixtureRoot)),
  );
  const tarballUrl = `${registryUrl}/lightningcss-wasm/-/lightningcss-wasm-1.32.0.tgz`;
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url === `${registryUrl}/lightningcss-wasm`)
      return Response.json({
        name: metadata.name,
        'dist-tags': { latest: metadata.version },
        versions: {
          [metadata.version]: { ...metadata, dist: { ...metadata.dist, tarball: tarballUrl } },
        },
      });
    if (url === tarballUrl) return new Response(tarball.slice());
    throw new Error(`Unexpected producer network: ${url}`);
  });
  const manifest = {
    name: 'snapshot-only-shadow',
    version: '1.0.0',
    dependencies: { lightningcss: '^1.32.0' },
  };
  const produced = await produceDependencySnapshot({
    templateId: 'saved-ms',
    registryUrl,
    packageJsonText: serializePackageJson(manifest),
    packageLockText: JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': manifest, 'node_modules/lightningcss': nativePin },
    }),
  });
  expect(requests).toEqual([`${registryUrl}/lightningcss-wasm`, tarballUrl]);
  const payload = parseDepSnapshot(
    JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(produced.archive)))),
  );
  expect(payload.tarballCache.files).toHaveLength(1);
  expect(
    Buffer.compare(
      Uint8Array.from(atob(payload.tarballCache.files[0]?.content ?? ''), (byte) =>
        byte.charCodeAt(0),
      ),
      tarball,
    ),
  ).toBe(0);
  return {
    ...produced,
    payload,
    descriptor: {
      snapshotId: produced.snapshotId,
      templateId: payload.templateId,
      assetUrl: 'https://host.test/shadow-required.tar.gz',
    },
  };
}
