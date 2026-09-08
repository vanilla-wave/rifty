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
import * as glue from './glue/dep-snapshot.ts';
import { installArtifactIdentity } from './glue/install-artifact-identity.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dec = new TextDecoder();
const enc = new TextEncoder();
const publicEntry = ['@riftydev', 'workbench/dep-snapshot'].join('/');
const TAR_TRAILER = new Uint8Array(1024);

function writeTarField(header: Uint8Array, value: string, start: number, length: number): void {
  const bytes = enc.encode(value);
  header.set(bytes.subarray(0, Math.min(bytes.length, length)), start);
}

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  writeTarField(header, name, 0, 100);
  writeTarField(header, '0000644', 100, 7);
  writeTarField(header, '0000000', 108, 7);
  writeTarField(header, '0000000', 116, 7);
  writeTarField(header, size.toString(8).padStart(11, '0'), 124, 11);
  header[135] = 0x20;
  writeTarField(header, '00000000000', 136, 11);
  header[147] = 0x20;
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeTarField(header, 'ustar', 257, 6);
  writeTarField(header, '00', 263, 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeTarField(header, sum.toString(8).padStart(6, '0'), 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function padBlock(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  padded.set(bytes);
  return padded;
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const body = new Uint8Array(bytes);
  const compressed = new Uint8Array(
    await new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
  compressed[9] = 0xff;
  return compressed;
}

async function packageTarball(
  name: string,
  version: string,
  extra: Partial<Omit<VersionManifest, 'name' | 'version' | 'dist'>> = {},
  files: Record<string, string> = {},
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const entries = { 'package.json': JSON.stringify({ name, version, ...extra }), ...files };
  for (const [path, body] of Object.entries(entries)) {
    const bytes = enc.encode(body);
    chunks.push(tarHeader(`package/${path}`, bytes.length), padBlock(bytes));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const tar = new Uint8Array(total + TAR_TRAILER.length);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.length;
  }
  return gzipBytes(tar);
}

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

async function entry(
  name: string,
  version: string,
  extra: Partial<Omit<VersionManifest, 'name' | 'version' | 'dist'>> = {},
  files: Record<string, string> = {},
): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version,
      ...extra,
      dist: { tarball: `fake://${encodeURIComponent(name)}/${version}` },
    },
    tarball: await packageTarball(name, version, extra, files),
  };
}

interface ProduceInput {
  readonly templateId: string;
  readonly packageJsonText: string;
  readonly packageLockText: string;
  readonly registry: RegistryClient;
  readonly signal?: AbortSignal;
}

interface ProduceResult {
  readonly snapshotId: string;
  readonly installArtifactIdentity: string;
  readonly tarBytes: Uint8Array;
}

interface PublicProducerApi {
  readonly produceDepSnapshot?: (input: ProduceInput) => Promise<ProduceResult>;
  readonly restoreDepSnapshot?: typeof glue.restoreDepSnapshot;
  readonly fetchDepSnapshot?: typeof glue.fetchDepSnapshot;
  readonly createDepSnapshotMemoryFs?: () => {
    fs: import('./glue/workspace-archive.ts').WorkspaceArchiveFs;
  };
}

function producer(): (input: ProduceInput) => Promise<ProduceResult> {
  const produce = (glue as unknown as PublicProducerApi).produceDepSnapshot;
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
    const api = (await import(publicEntry)) as PublicProducerApi;
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
    const publicApi = (await import(publicEntry)) as PublicProducerApi;
    const memory = publicApi.createDepSnapshotMemoryFs?.();
    expect(memory, 'public memory fs helper is available').toBeDefined();
    if (!memory || !publicApi.fetchDepSnapshot || !publicApi.restoreDepSnapshot) {
      throw new Error('public restore helpers missing');
    }
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
    const memory = ((await import(publicEntry)) as PublicProducerApi).createDepSnapshotMemoryFs?.();
    expect(memory, 'public memory fs helper is available').toBeDefined();
    if (!memory) throw new Error('createDepSnapshotMemoryFs missing');
    const { fs } = memory;
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
      const { fsSync } = createMemoryFs();
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(body.slice(), { headers: { 'Content-Type': 'application/octet-stream' } }),
      );
      try {
        const snapshot = await glue.fetchDepSnapshot('https://host.test/snapshot');
        await glue.restoreDepSnapshot(fsSync, '/project', snapshot);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fsSync.existsSync('/project/node_modules/pin/package.json')).toBe(true);
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
    await expect(
      producer()({
        templateId: 'caller',
        packageJsonText: JSON.stringify({
          name: 'caller',
          version: '1.0.0',
          dependencies: { local: 'file:../local' },
        }),
        packageLockText: JSON.stringify({
          name: 'caller',
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'caller', version: '1.0.0', dependencies: { local: 'file:../local' } },
          },
        }),
        registry: new CountingFakeRegistry(new Map()),
      }),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'npm-client.dependency-spec.file',
    } satisfies Pick<NotImplementedError, 'name' | 'feature'>);
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
