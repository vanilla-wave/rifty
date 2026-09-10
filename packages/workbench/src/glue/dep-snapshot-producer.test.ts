import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as workbench from '../index.ts';

interface ProducerOptions {
  readonly templateId: string;
  readonly packageJsonText: string;
  readonly packageLockText: string;
  readonly registryUrl: string;
}
interface Produced {
  readonly archive: Uint8Array;
  readonly snapshotId: string;
  readonly installArtifactIdentity: string;
}
function producer(): (options: ProducerOptions) => Promise<Produced> {
  const produce = (
    workbench as unknown as {
      produceDependencySnapshot?: (options: ProducerOptions) => Promise<Produced>;
    }
  ).produceDependencySnapshot;
  expect(produce, 'public dependency snapshot producer').toBeTypeOf('function');
  if (!produce) throw new Error('public producer absent');
  return produce;
}
const dependencies = { ms: '^2.0.0' };
const manifest = { name: 'snapshot-consumer', version: '1.0.0', dependencies };
const registryUrl = 'https://configured-registry.test';
const fixtureRoot = new URL('../../../../tests/integration/fixtures/registry/', import.meta.url);
const directories: string[] = [];
async function inputs() {
  const meta = JSON.parse(await readFile(new URL('ms-2.0.0.json', fixtureRoot), 'utf8')) as {
    dist: { upstreamTarball: string; upstreamIntegrity: string };
  };
  const lock = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': manifest,
      'node_modules/ms': {
        version: '2.0.0',
        resolved: meta.dist.upstreamTarball,
        integrity: meta.dist.upstreamIntegrity,
      },
    } as Record<string, Record<string, unknown>>,
  };
  return {
    lock,
    options: {
      templateId: 'ms-project',
      packageJsonText: JSON.stringify(manifest),
      packageLockText: JSON.stringify(lock),
      registryUrl,
    },
  };
}
async function registry(corrupt = false): Promise<string[]> {
  const requests: string[] = [];
  const versions = ['2.0.0', '2.1.3'];
  const metadata = await Promise.all(
    versions.map(async (version) => {
      const filename = version === '2.0.0' ? 'ms-2.0.0.json' : 'ms.json';
      return JSON.parse(await readFile(new URL(filename, fixtureRoot), 'utf8')) as {
        dist: { upstreamTarball: string; upstreamIntegrity: string };
      };
    }),
  );
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url === `${registryUrl}/ms`)
      return Response.json({
        name: 'ms',
        'dist-tags': { latest: '2.1.3' },
        versions: Object.fromEntries(
          versions.map((version, index) => [
            version,
            {
              name: 'ms',
              version,
              dependencies: {},
              dist: {
                tarball: metadata[index]!.dist.upstreamTarball,
                integrity: metadata[index]!.dist.upstreamIntegrity,
              },
            },
          ]),
        ),
      });
    for (const version of versions) {
      if (url === `${registryUrl}/ms/-/ms-${version}.tgz`) {
        const bytes = await readFile(new URL(`ms-${version}.tgz`, fixtureRoot));
        if (corrupt) bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
        return new Response(new Uint8Array(bytes).buffer);
      }
    }
    throw new Error(`Unexpected producer network ${url}`);
  });
  return requests;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe('public caller-pinned dependency snapshot producer', () => {
  it('bakes real locked bytes from the configured registry and emits inspectable reproducible identities', async () => {
    const produce = producer();
    const { options } = await inputs();
    const requests = await registry();
    const first = await produce(options);
    const second = await produce(options);
    expect(first.archive).toEqual(second.archive);
    expect(first.snapshotId).toBe(second.snapshotId);
    const tar = gunzipSync(first.archive);
    expect(first.snapshotId).toBe(`sha256:${createHash('sha256').update(tar).digest('hex')}`);
    expect(first.installArtifactIdentity).toMatch(/^sha256:[0-9a-f]{64}$/);
    const root = await mkdtemp(join(tmpdir(), 'rifty-producer-proof-'));
    directories.push(root);
    await writeFile(join(root, 'snapshot.tar.gz'), first.archive);
    execFileSync('tar', ['-xzf', join(root, 'snapshot.tar.gz'), '-C', root]);
    const installed = JSON.parse(
      await readFile(join(root, 'payload/node_modules/ms/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe('2.0.0');
    const originalFile = execFileSync('tar', [
      '-xzOf',
      new URL('ms-2.0.0.tgz', fixtureRoot).pathname,
      'package/index.js',
    ]);
    expect(await readFile(join(root, 'payload/node_modules/ms/index.js'))).toEqual(originalFile);
    const control = JSON.parse(await readFile(join(root, 'rifty/manifest.json'), 'utf8')) as {
      installArtifactIdentity: string;
    };
    expect(control.installArtifactIdentity).toBe(first.installArtifactIdentity);
    expect(requests.every((url) => url.startsWith(registryUrl))).toBe(true);
    expect(requests.some((url) => url.includes('2.1.3'))).toBe(false);
  });
  it('refuses an unpinned ordinary output even when root request maps match', async () => {
    const produce = producer();
    const { options, lock } = await inputs();
    Reflect.deleteProperty(lock.packages, 'node_modules/ms');
    await registry();
    await expect(produce({ ...options, packageLockText: JSON.stringify(lock) })).rejects.toThrow(
      /pin|lock/i,
    );
  });
  it('rejects a newly resolved nested ordinary pin while the old hoisted pin remains', async () => {
    const produce = producer();
    const { options, lock } = await inputs();
    const deps = { ms: '2.0.0', debug: '4.4.1' };
    const metadata = JSON.parse(
      await readFile(new URL('debug-4.4.1.json', fixtureRoot), 'utf8'),
    ) as {
      dist: { upstreamTarball: string; upstreamIntegrity: string };
      dependencies: Record<string, string>;
    };
    lock.packages[''] = { ...manifest, dependencies: deps };
    lock.packages['node_modules/debug'] = {
      version: '4.4.1',
      resolved: metadata.dist.upstreamTarball,
      integrity: metadata.dist.upstreamIntegrity,
      dependencies: metadata.dependencies,
    };
    await registry();
    const msFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `${registryUrl}/debug/-/debug-4.4.1.tgz`) {
        return new Response(
          new Uint8Array(await readFile(new URL('debug-4.4.1.tgz', fixtureRoot))).buffer,
        );
      }
      return msFetch(input, init);
    });
    await expect(
      produce({
        ...options,
        packageJsonText: JSON.stringify({ ...manifest, dependencies: deps }),
        packageLockText: JSON.stringify(lock),
      }),
    ).rejects.toThrow(/pin|lock/i);
  });
  it('admits only attested native-source replacement and its real bundled bytes', async () => {
    const produce = producer();
    const { options, lock } = await inputs();
    const realLock = JSON.parse(
      await readFile(
        new URL(
          '../../../../tests/e2e/fixtures/npm-lock-replay/vite8/package-lock.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      packages: Record<string, Record<string, unknown>>;
    };
    const deps = { lightningcss: '^1.32.0' };
    lock.packages = {
      '': { ...manifest, dependencies: deps },
      'node_modules/lightningcss': realLock.packages['node_modules/lightningcss']!,
    };
    const sourceRoot = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);
    const source = JSON.parse(
      await readFile(new URL('lightningcss-wasm-1.32.0-registry.json', sourceRoot), 'utf8'),
    ) as {
      dist: { integrity: string };
      name: string;
      version: string;
    };
    const tarball = `${registryUrl}/lightningcss-wasm/-/lightningcss-wasm-1.32.0.tgz`;
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url === `${registryUrl}/lightningcss-wasm`)
        return Response.json({
          name: source.name,
          'dist-tags': { latest: source.version },
          versions: { [source.version]: { ...source, dist: { ...source.dist, tarball } } },
        });
      if (url === tarball)
        return new Response(
          new Uint8Array(await readFile(new URL('lightningcss-wasm-1.32.0.tgz', sourceRoot)))
            .buffer,
        );
      throw new Error(`Unexpected shadow producer fetch ${url}`);
    });
    const result = await produce({
      ...options,
      packageJsonText: JSON.stringify({ ...manifest, dependencies: deps }),
      packageLockText: JSON.stringify(lock),
    });
    const root = await mkdtemp(join(tmpdir(), 'rifty-producer-shadow-'));
    directories.push(root);
    await writeFile(join(root, 'snapshot.tar.gz'), result.archive);
    execFileSync('tar', ['-xzf', join(root, 'snapshot.tar.gz'), '-C', root]);
    const restoredLock = JSON.parse(
      await readFile(join(root, 'payload/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { version: string; inBundle?: boolean }> };
    expect(restoredLock.packages['node_modules/lightningcss-wasm']?.version).toBe('1.32.0');
    expect(
      restoredLock.packages['node_modules/lightningcss-wasm/node_modules/napi-wasm']?.inBundle,
    ).toBe(true);
    expect(requests).toEqual([`${registryUrl}/lightningcss-wasm`, tarball]);
    const expected = execFileSync('tar', [
      '-xzOf',
      new URL('lightningcss-wasm-1.32.0.tgz', sourceRoot).pathname,
      'package/node_modules/napi-wasm/package.json',
    ]);
    expect(
      await readFile(
        join(root, 'payload/node_modules/lightningcss-wasm/node_modules/napi-wasm/package.json'),
      ),
    ).toEqual(expected);
    // Real tar/wasm production is CPU/I/O work; the CI default 5s is not an acceptance bound.
  }, 30_000);
  it('rejects a manifest/lock request mismatch', async () => {
    const produce = producer();
    const { options } = await inputs();
    await registry();
    await expect(
      produce({
        ...options,
        packageJsonText: JSON.stringify({ ...manifest, dependencies: { ms: '^9.0.0' } }),
      }),
    ).rejects.toThrow(/lock/i);
  });
  it.each([1, 2, 4])(
    'rejects unsupported lockfile v%i without producing an archive',
    async (lockfileVersion) => {
      const produce = producer();
      const { options, lock } = await inputs();
      await registry();
      await expect(
        produce({ ...options, packageLockText: JSON.stringify({ ...lock, lockfileVersion }) }),
      ).rejects.toThrow(/lockfile/i);
    },
  );
  it('[fault: poisoned-artifact] rejects tarball integrity failure before emitting bytes', async () => {
    const produce = producer();
    const { options } = await inputs();
    await registry(true);
    await expect(produce(options)).rejects.toThrow(/integrity/i);
  });
  it('rejects a retained acquisition pin drift before emitting an archive', async () => {
    const produce = producer();
    const { options, lock } = await inputs();
    const realLock = JSON.parse(
      await readFile(
        new URL(
          '../../../../tests/e2e/fixtures/npm-lock-replay/vite8/package-lock.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      packages: Record<string, Record<string, unknown>>;
    };
    const deps = { lightningcss: '^1.32.0' };
    lock.packages = {
      '': { ...manifest, dependencies: deps },
      'node_modules/lightningcss': realLock.packages['node_modules/lightningcss']!,
    };
    const sourceRoot = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);
    const source = JSON.parse(
      await readFile(new URL('lightningcss-wasm-1.32.0-registry.json', sourceRoot), 'utf8'),
    ) as {
      dist: { integrity: string };
      name: string;
      version: string;
    };
    const tarball = `${registryUrl}/lightningcss-wasm/-/lightningcss-wasm-1.32.0.tgz`;
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url === `${registryUrl}/lightningcss-wasm`)
        return Response.json({
          name: source.name,
          'dist-tags': { latest: source.version },
          versions: { [source.version]: { ...source, dist: { ...source.dist, tarball } } },
        });
      if (url === tarball)
        return new Response(
          new Uint8Array(await readFile(new URL('lightningcss-wasm-1.32.0.tgz', sourceRoot)))
            .buffer,
        );
      throw new Error(`Unexpected shadow producer fetch ${url}`);
    });
    lock.packages['node_modules/lightningcss-wasm'] = {
      version: '0.0.0',
      resolved: tarball,
      integrity: source.dist.integrity,
    };
    const outcome = await produce({
      ...options,
      packageJsonText: JSON.stringify({ ...manifest, dependencies: deps }),
      packageLockText: JSON.stringify(lock),
    }).then(
      () => 'emitted',
      (error: unknown) => String(error),
    );
    expect(outcome).toMatch(/caller lockfile pin for node_modules\/lightningcss-wasm/);
  });
});
