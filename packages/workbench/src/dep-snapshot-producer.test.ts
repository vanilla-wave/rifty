import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { NotImplementedError } from '@riftydev/io';
import { install } from '@riftydev/npm-client';
import type { Packument, VersionManifest } from '@riftydev/npm-client';
import { RegistryClient } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  buildHeader,
  concat,
  gzip,
  makePackageTarball,
  padToBlock,
  TAR_TRAILER,
} from '../../npm-client/src/_test-fixtures/tar-builder.ts';
import * as glue from './glue/dep-snapshot.ts';
import { installArtifactIdentity } from './glue/install-artifact-identity.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dec = new TextDecoder();
const publicEntry = ['@riftydev', 'workbench/dep-snapshot'].join('/');

interface FakeRegistryEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

class CountingFakeRegistry extends RegistryClient {
  readonly calls = { packument: [] as string[], tarball: [] as string[] };

  constructor(readonly db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.calls.packument.push(name);
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [version, entry] of versions) versionsMap[version] = entry.manifest;
    const latest = [...versions.keys()].sort().at(-1) ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }

  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    this.calls.tarball.push(tarballUrl);
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const entry = this.db.get(decodeURIComponent(match[1] ?? ''))?.get(match[2] ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function packageTarballWithFiles(
  name: string,
  version: string,
  extra: Partial<Omit<VersionManifest, 'name' | 'version' | 'dist'>>,
  files: Record<string, string>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const packageJson = JSON.stringify({ name, version, ...extra });
  for (const [path, body] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = new TextEncoder().encode(body);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return await gzip(concat(...chunks, TAR_TRAILER));
}

async function entry(
  name: string,
  version: string,
  extra: Partial<Omit<VersionManifest, 'name' | 'version' | 'dist'>> = {},
  files?: Record<string, string>,
): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version,
      ...extra,
      dist: { tarball: `fake://${encodeURIComponent(name)}/${version}` },
    },
    tarball: files
      ? await packageTarballWithFiles(name, version, extra, files)
      : await makePackageTarball(name, version),
  };
}

function producer(): NonNullable<(typeof glue)['produceDepSnapshot']> {
  const produce = (
    glue as unknown as {
      produceDepSnapshot?: (input: {
        readonly templateId: string;
        readonly packageJsonText: string;
        readonly packageLockText: string;
        readonly registry: RegistryClient;
        readonly signal?: AbortSignal;
      }) => Promise<{
        readonly snapshotId: string;
        readonly installArtifactIdentity: string;
        readonly tarBytes: Uint8Array;
      }>;
    }
  ).produceDepSnapshot;
  expect(produce, 'published producer is available').toBeTypeOf('function');
  if (!produce) throw new Error('produceDepSnapshot missing');
  return produce;
}

async function seedLock(
  db: Map<string, Map<string, FakeRegistryEntry>>,
  packageJson: string,
): Promise<string> {
  const { vfs } = createMemoryFs();
  await vfs.mkdir('/proj', { recursive: true });
  await vfs.writeFile('/proj/package.json', packageJson);
  await install({ vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) });
  return vfs.readFileText('/proj/package-lock.json');
}

describe('published dependency snapshot producer', () => {
  it('exposes produce/restore on the sealed workbench entry', async () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly exports: Readonly<Record<string, string>>;
      readonly publishConfig: { readonly exports: Readonly<Record<string, { readonly import: string }>> };
    };
    expect(manifest.exports['./dep-snapshot']).toBe('./src/dep-snapshot.ts');
    expect(manifest.publishConfig.exports['./dep-snapshot']?.import).toBe('./dist/dep-snapshot.js');
    const api = (await import(publicEntry)) as typeof glue & {
      createDepSnapshotMemoryFs?: () => { fs: import('./glue/workspace-archive.ts').WorkspaceArchiveFs };
    };
    expect(api.produceDepSnapshot).toBeTypeOf('function');
    expect(api.restoreDepSnapshot).toBeTypeOf('function');
    expect(api.createDepSnapshotMemoryFs).toBeTypeOf('function');
  });

  it('bakes caller manifest+lock and restores matching bytes through the public entry', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'pin',
      new Map([['1.0.0', await entry('pin', '1.0.0', {}, { 'readme.txt': 'exact pin bytes' })]]),
    );
    const packageJsonText = JSON.stringify({
      name: 'caller',
      version: '1.0.0',
      dependencies: { pin: '1.0.0' },
    });
    const packageLockText = await seedLock(db, packageJsonText);
    const produce = producer();
    const baked = await produce({
      templateId: 'caller-vite',
      packageJsonText,
      packageLockText,
      registry: new CountingFakeRegistry(db),
    });
    expect(baked.installArtifactIdentity).toBe(installArtifactIdentity);
    expect(baked.snapshotId).toMatch(/^sha256:[0-9a-f]{64}$/);
    const publicApi = (await import(publicEntry)) as typeof glue & {
      createDepSnapshotMemoryFs: () => { fs: import('./glue/workspace-archive.ts').WorkspaceArchiveFs };
    };
    const memory = publicApi.createDepSnapshotMemoryFs();
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(baked.tarBytes.slice(), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    );
    try {
      const snapshot = await publicApi.fetchDepSnapshot('https://host.test/snapshot.tar');
      await publicApi.restoreDepSnapshot(memory.fs, '/project', snapshot);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(dec.decode(memory.fs.readFileBytesSync('/project/node_modules/pin/readme.txt'))).toBe(
      'exact pin bytes',
    );
    expect(dec.decode(memory.fs.readFileBytesSync('/project/package-lock.json'))).toBe(
      packageLockText,
    );
  });

  it('keeps lock-pinned versions when the registry advertises a newer release', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'pin',
      new Map([
        ['1.0.0', await entry('pin', '1.0.0', {}, { 'marker.txt': 'v1' })],
        ['2.0.0', await entry('pin', '2.0.0', {}, { 'marker.txt': 'v2' })],
      ]),
    );
    const packageJsonText = JSON.stringify({
      name: 'caller',
      version: '1.0.0',
      dependencies: { pin: '^1.0.0' },
    });
    const pinOnly = new Map<string, Map<string, FakeRegistryEntry>>();
    pinOnly.set('pin', new Map([['1.0.0', db.get('pin')?.get('1.0.0') as FakeRegistryEntry]]));
    const packageLockText = await seedLock(pinOnly, packageJsonText);
    const registry = new CountingFakeRegistry(db);
    const baked = await producer()({
      templateId: 'caller',
      packageJsonText,
      packageLockText,
      registry,
    });
    expect(registry.calls.packument).toEqual([]);
    expect(registry.calls.tarball).toEqual(['fake://pin/1.0.0']);
    const { fs } = (
      (await import(publicEntry)) as {
        createDepSnapshotMemoryFs: () => { fs: import('./glue/workspace-archive.ts').WorkspaceArchiveFs };
      }
    ).createDepSnapshotMemoryFs();
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(baked.tarBytes.slice(), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    );
    try {
      const snapshot = await glue.fetchDepSnapshot('https://host.test/snapshot.tar');
      await glue.restoreDepSnapshot(fs, '/project', snapshot);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(dec.decode(fs.readFileBytesSync('/project/node_modules/pin/marker.txt'))).toBe('v1');
    expect(JSON.parse(dec.decode(fs.readFileBytesSync('/project/node_modules/pin/package.json')))).toMatchObject(
      { version: '1.0.0' },
    );
  });

  it('restores produced gzip and HTTP-decoded tar through public fetch', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('pin', new Map([['1.0.0', await entry('pin', '1.0.0')]]));
    const packageJsonText = JSON.stringify({
      name: 'caller',
      version: '1.0.0',
      dependencies: { pin: '1.0.0' },
    });
    const packageLockText = await seedLock(db, packageJsonText);
    const baked = await producer()({
      templateId: 'caller',
      packageJsonText,
      packageLockText,
      registry: new CountingFakeRegistry(db),
    });
    const gzip = gzipSync(Buffer.from(baked.tarBytes), { level: 9 });
    for (const body of [gzip, baked.tarBytes]) {
      const { fs } = createMemoryFs();
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(body.slice(), { headers: { 'Content-Type': 'application/octet-stream' } }),
      );
      try {
        const snapshot = await glue.fetchDepSnapshot('https://host.test/snapshot');
        await glue.restoreDepSnapshot(fs.fsSync, '/project', snapshot);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fs.fsSync.existsSync('/project/node_modules/pin/package.json')).toBe(true);
    }
  });

  it('surfaces installer lifecycle and corrupt-lock failures before emitting a snapshot', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'with-script',
      new Map([
        ['1.0.0', await entry('with-script', '1.0.0', { scripts: { postinstall: 'node build.js' } })],
      ]),
    );
    const packageJsonText = JSON.stringify({
      name: 'caller',
      version: '1.0.0',
      dependencies: { 'with-script': '1.0.0' },
    });
    await expect(
      producer()({
        templateId: 'caller',
        packageJsonText,
        packageLockText: JSON.stringify({
          name: 'caller',
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'caller', version: '1.0.0', dependencies: { 'with-script': '1.0.0' } },
          },
        }),
        registry: new CountingFakeRegistry(db),
      }),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'npm-client.lifecycle.postinstall',
    } satisfies Pick<NotImplementedError, 'name' | 'feature'>);
    await expect(
      producer()({
        templateId: 'caller',
        packageJsonText,
        packageLockText: '{not-json',
        registry: new CountingFakeRegistry(new Map()),
      }),
    ).rejects.toThrow(/lockfile corrupt/);
  });

  it('aborts produce with the caller signal before returning snapshot bytes', async () => {
    const packageJsonText = JSON.stringify({
      name: 'caller',
      version: '1.0.0',
      dependencies: { pin: '1.0.0' },
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const registry = new RegistryClient({
      baseUrl: '/registry',
      maxRetries: 0,
      fetch: async () => {
        markStarted();
        return await new Promise<Response>(() => {});
      },
    });
    const controller = new AbortController();
    const reason = new Error('host cancelled bake');
    const producing = producer()({
      templateId: 'caller',
      packageJsonText,
      packageLockText: JSON.stringify({
        name: 'caller',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 'caller', version: '1.0.0', dependencies: { pin: '1.0.0' } },
        },
      }),
      registry,
      signal: controller.signal,
    });
    await started;
    controller.abort(reason);
    await expect(producing).rejects.toBe(reason);
  });
});
