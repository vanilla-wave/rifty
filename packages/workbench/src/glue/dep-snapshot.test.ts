import { readFile } from 'node:fs/promises';
import { type InstallResult, type Packument, RegistryClient, install } from '@riftydev/npm-client';
import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type DepSnapshotV3,
  buildDepSnapshot,
  fetchDepSnapshot,
  parseDepSnapshot,
  restoreDepSnapshot,
  serializeDepSnapshot,
} from './dep-snapshot.ts';
import {
  type TestEnsureProjectDepsOptions,
  createTestProjectPackageAcquisitionAuthority,
} from './project-deps.test-fixture.ts';
import { ensureProjectDependencies as ensureProjectDependenciesWithAuthority } from './project-deps.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const ROOT = '/workspace';
const PACKAGE_JSON_TEXT = JSON.stringify({
  name: 'app',
  dependencies: { vite: '^5.4.0' },
});
const PACKAGE_LOCK_TEXT = '{"lockfileVersion":3,"packages":{}}';
const LIGHTNING_SOURCE = 'lightningcss-wasm';
const LIGHTNING_VERSION = '1.32.0';
const LIGHTNING_URL = `https://registry.test/${LIGHTNING_SOURCE}-${LIGHTNING_VERSION}.tgz`;
const LIGHTNING_INTEGRITY =
  'sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ==';
const LIGHTNING_TARBALL_URL = new URL(
  '../../../../tools/shadow-registry/src/fixtures/lightningcss-wasm-1.32.0.tgz',
  import.meta.url,
);
const LIGHTNING_DEPENDENCIES = { lightningcss: '^1.32.0' };
const LIGHTNING_PACKAGE_JSON_TEXT = JSON.stringify({
  name: 'fixture',
  version: '1.0.0',
  dependencies: LIGHTNING_DEPENDENCIES,
});

class LightningRegistry extends RegistryClient {
  constructor(private readonly tarball: Uint8Array) {
    super({
      baseUrl: 'https://registry.test',
      fetch: async () => new Response('', { status: 599 }),
    });
  }

  override async getPackument(name: string): Promise<Packument> {
    if (name !== LIGHTNING_SOURCE) throw new Error(`unexpected packument ${name}`);
    const manifest: Packument['versions'][string] & { bundleDependencies: string[] } = {
      name,
      version: LIGHTNING_VERSION,
      dependencies: { 'napi-wasm': '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: ['napi-wasm'],
      main: 'index.mjs',
      module: 'index.mjs',
      type: 'module',
      dist: { tarball: LIGHTNING_URL, integrity: LIGHTNING_INTEGRITY },
    };
    return {
      name,
      'dist-tags': { latest: LIGHTNING_VERSION },
      versions: { [LIGHTNING_VERSION]: manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    if (url !== LIGHTNING_URL) throw new Error(`unexpected tarball ${url}`);
    return this.tarball.slice();
  }
}

let lightningSnapshotPromise: Promise<DepSnapshotV3> | undefined;

async function lightningSnapshot(): Promise<DepSnapshotV3> {
  lightningSnapshotPromise ??= (async () => {
    const baked = createMemoryFs();
    await baked.vfs.mkdir(ROOT, { recursive: true });
    await baked.vfs.writeFile(`${ROOT}/package.json`, LIGHTNING_PACKAGE_JSON_TEXT);
    const fresh = await install('fixture', '1.0.0', LIGHTNING_DEPENDENCIES, {
      vfs: baked.vfs,
      cwd: ROOT,
      registry: new LightningRegistry(new Uint8Array(await readFile(LIGHTNING_TARBALL_URL))),
      onSubstitution: () => undefined,
    });
    return buildDepSnapshot(baked.fsSync, ROOT, {
      templateId: 'vite8',
      deps: LIGHTNING_DEPENDENCIES,
      packages: fresh.packages.length,
    });
  })();
  return structuredClone(await lightningSnapshotPromise);
}

function ensureProjectDependencies(opts: TestEnsureProjectDepsOptions) {
  const {
    installStampAuthority: _installStampAuthority,
    packageAcquisitionAuthority,
    ...base
  } = opts;
  return ensureProjectDependenciesWithAuthority({
    ...base,
    packageAcquisitionAuthority:
      packageAcquisitionAuthority ?? createTestProjectPackageAcquisitionAuthority(opts),
  });
}

function installResult(count: number): InstallResult {
  const packages = Array.from({ length: count }, (_, index) => ({
    name: `package-${index}`,
    version: '1.0.0',
    dependencies: {},
    files: {},
  }));
  return {
    packages,
    lockfile: {
      name: 'app',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: packages.map(({ name, version }) => ({ name, version, transport: 'registry' })),
    },
  };
}

function write(fs: MemoryFsSync, path: string, bytes: Uint8Array): void {
  const slash = path.lastIndexOf('/');
  fs.mkdirSync(path.slice(0, slash), { recursive: true });
  fs.writeFileSync(path, bytes);
}

function bakedFs(): MemoryFsSync {
  const fs = new MemoryFsSync();
  write(fs, `${ROOT}/package.json`, enc.encode(PACKAGE_JSON_TEXT));
  write(fs, `${ROOT}/package-lock.json`, enc.encode(PACKAGE_LOCK_TEXT));
  write(fs, `${ROOT}/node_modules/vite/package.json`, enc.encode('{"name":"vite"}'));
  write(fs, `${ROOT}/node_modules/vite/bin/vite.js`, enc.encode('#!/usr/bin/env node'));
  // nested copy (nest-on-conflict layout) must survive the round-trip
  write(fs, `${ROOT}/node_modules/a/node_modules/ms/index.js`, enc.encode('nested'));
  // binary content round-trips byte-exact through base64
  write(fs, `${ROOT}/node_modules/vite/blob.bin`, new Uint8Array([0, 255, 128, 7]));
  // install-time shadow shims (ADR-0188): the bake runs the same install(), so
  // the shimmed native entry + the alias package are tree files like any other
  // and MUST ride the snapshot (no boot overlay recreates them anymore).
  write(
    fs,
    `${ROOT}/node_modules/rollup/dist/native.js`,
    enc.encode("require('@rollup/wasm-node/dist/native.js')"),
  );
  write(fs, `${ROOT}/node_modules/esbuild/package.json`, enc.encode('{"name":"esbuild"}'));
  return fs;
}

describe('dep snapshot (ADR-0135)', () => {
  it('round-trips the node_modules tree, nested copies, binaries, and the lockfile', async () => {
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const reparsed = parseDepSnapshot(JSON.stringify(snapshot));

    const target = new MemoryFsSync();
    target.mkdirSync(ROOT, { recursive: true });
    await restoreDepSnapshot(target, ROOT, reparsed);

    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/vite/package.json`))).toBe(
      '{"name":"vite"}',
    );
    expect(target.existsSync(`${ROOT}/node_modules/a/node_modules/ms/index.js`)).toBe(true);
    expect([...target.readFileBytesSync(`${ROOT}/node_modules/vite/blob.bin`)]).toEqual([
      0, 255, 128, 7,
    ]);
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/package-lock.json`))).toBe(
      PACKAGE_LOCK_TEXT,
    );
    // install-time shim files restored verbatim (ADR-0188)
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/rollup/dist/native.js`))).toBe(
      "require('@rollup/wasm-node/dist/native.js')",
    );
    expect(target.existsSync(`${ROOT}/node_modules/esbuild/package.json`)).toBe(true);
    expect(reparsed.packages).toBe(8);
    expect(reparsed.deps).toEqual({ vite: '^5.4.0' });
    expect(reparsed.packageJsonText).toBe(PACKAGE_JSON_TEXT);
    expect(reparsed.installArtifactIdentity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('[fault: lossy-aggregate / torn-state] restores lockfile replay bytes without replacing sibling cache entries', async () => {
    const snapshot = await lightningSnapshot();
    const reparsed = parseDepSnapshot(serializeDepSnapshot(snapshot));
    const cacheFile = reparsed.tarballCache.files[0];
    if (!cacheFile) throw new Error('LightningCSS snapshot omitted its replay cache');
    const cachePath = `${reparsed.tarballCache.root}/${cacheFile.path}`;
    const target = new MemoryFsSync();
    const siblingPath = '/.rifty/tarball-cache/zz/sibling-1.0.0.tgz';
    write(target, siblingPath, enc.encode('keep'));

    await restoreDepSnapshot(target, ROOT, reparsed);

    expect(Buffer.from(target.readFileBytesSync(cachePath)).toString('base64')).toBe(
      cacheFile.content,
    );
    expect(dec.decode(target.readFileBytesSync(siblingPath))).toBe('keep');
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/package-lock.json`))).toBe(
      snapshot.lockfile,
    );
  });

  it('[fault: lossy-aggregate] refuses to restore a shadow-replay lockfile without its pinned bytes', async () => {
    const snapshot = await lightningSnapshot();
    const missing = {
      ...snapshot,
      tarballCache: { ...snapshot.tarballCache, files: [] },
    } satisfies DepSnapshotV3;
    const target = new MemoryFsSync();
    write(target, `${ROOT}/node_modules/keep/index.js`, enc.encode('keep'));

    await expect(restoreDepSnapshot(target, ROOT, missing)).rejects.toThrow(
      /cache does not match its lockfile closure/,
    );
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/keep/index.js`))).toBe('keep');
    expect(target.existsSync(`${ROOT}/package-lock.json`)).toBe(false);
  });

  it('[fault: torn-state / quota-perm-fail] does not publish the lockfile when cache merge fails', async () => {
    const snapshot = await lightningSnapshot();
    const cacheFile = snapshot.tarballCache.files[0];
    if (!cacheFile) throw new Error('LightningCSS snapshot omitted its replay cache');
    const cachePath = `${snapshot.tarballCache.root}/${cacheFile.path}`;
    class FailingCacheWriteFs extends MemoryFsSync {
      failCacheWrite = false;

      override writeFileSync(path: string, data: Uint8Array): void {
        if (this.failCacheWrite && path === cachePath)
          throw new Error('injected cache write failure');
        super.writeFileSync(path, data);
      }
    }
    const target = new FailingCacheWriteFs();
    const priorLockfile = '{"lockfileVersion":3,"name":"prior"}';
    const siblingPath = '/.rifty/tarball-cache/zz/sibling-1.0.0.tgz';
    write(target, `${ROOT}/package-lock.json`, enc.encode(priorLockfile));
    write(target, siblingPath, enc.encode('keep-cache'));
    target.failCacheWrite = true;

    await expect(restoreDepSnapshot(target, ROOT, snapshot)).rejects.toThrow(
      'injected cache write failure',
    );

    expect(dec.decode(target.readFileBytesSync(`${ROOT}/package-lock.json`))).toBe(priorLockfile);
    expect(dec.decode(target.readFileBytesSync(siblingPath))).toBe('keep-cache');
    expect(target.existsSync(cachePath)).toBe(false);
  });

  it('does not carry ordinary lockfile tarballs whose replay may use the registry', () => {
    const fs = bakedFs();
    write(
      fs,
      `${ROOT}/package-lock.json`,
      enc.encode(
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/lightningcss-wasm': {
              version: '1.32.0',
              integrity: LIGHTNING_INTEGRITY,
            },
          },
        }),
      ),
    );
    write(fs, '/.rifty/tarball-cache/St/lightningcss-wasm-1.32.0.tgz', new Uint8Array([1]));

    const snapshot = buildDepSnapshot(fs, ROOT, {
      templateId: 'ordinary-lockfile',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });

    expect(snapshot.tarballCache.files).toEqual([]);
  });

  it('runs the first post-restore registry shadow replay from the carried cache with zero registry fetches', async () => {
    const snapshot = await lightningSnapshot();
    expect(snapshot.tarballCache.files).toHaveLength(1);

    const restored = createMemoryFs();
    await restored.vfs.mkdir(ROOT, { recursive: true });
    await restored.vfs.writeFile(`${ROOT}/package.json`, LIGHTNING_PACKAGE_JSON_TEXT);
    await restoreDepSnapshot(restored.fsSync, ROOT, snapshot);
    const registryFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('registry fetch forbidden during matched shadow replay');
    });
    const events: Array<{ name: string; version: string; cacheHit: boolean }> = [];

    const replay = await install('fixture', '1.0.0', LIGHTNING_DEPENDENCIES, {
      vfs: restored.vfs,
      cwd: ROOT,
      registry: new RegistryClient({ baseUrl: 'https://registry.invalid', fetch: registryFetch }),
      onPackage: (event) => events.push(event),
      onSubstitution: () => undefined,
    });

    expect(registryFetch).not.toHaveBeenCalled();
    expect(events).toEqual([{ name: 'lightningcss-wasm', version: '1.32.0', cacheHit: true }]);
    expect(replay.provenance.resolution).toBe('lockfile');
    expect(replay.provenance.packages).toContainEqual({
      name: 'lightningcss-wasm',
      version: '1.32.0',
      transport: 'cache',
    });
  });

  it('never serializes top-level or nested install-stamp claims', () => {
    const fs = bakedFs();
    write(
      fs,
      `${ROOT}/node_modules/.rifty-install-stamp.json`,
      enc.encode('{"version":3,"root":"/workspace"}'),
    );
    write(
      fs,
      `${ROOT}/node_modules/a/node_modules/.rifty-install-stamp.json`,
      enc.encode('{"version":3,"root":"/workspace/node_modules/a"}'),
    );

    const snapshot = buildDepSnapshot(fs, ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });

    expect(snapshot.nodeModules.files.map((file) => file.path)).not.toContain(
      '.rifty-install-stamp.json',
    );
    expect(snapshot.nodeModules.files.map((file) => file.path)).not.toContain(
      'a/node_modules/.rifty-install-stamp.json',
    );
    expect(snapshot.nodeModules.files.map((file) => file.path)).toContain(
      'a/node_modules/ms/index.js',
    );
  });

  it.each([
    '.rifty-install-stamp.json',
    'a/node_modules/.rifty-install-stamp.json',
    '.rifty-install-stamp.json/payload',
    'a/node_modules/.rifty-install-stamp.json/payload',
  ])(
    'rejects marker-bearing snapshot ingress before replacing destination bytes: %s',
    async (path) => {
      const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
        templateId: 'vite',
        deps: { vite: '^5.4.0' },
        packages: 8,
      });
      const markerBearing = {
        ...snapshot,
        nodeModules: {
          ...snapshot.nodeModules,
          files: [
            ...snapshot.nodeModules.files,
            {
              path,
              encoding: 'base64' as const,
              content: btoa('forged-claim'),
            },
          ],
        },
      } satisfies DepSnapshotV3;
      const target = new MemoryFsSync();
      write(target, `${ROOT}/node_modules/keep/index.js`, enc.encode('keep'));

      await expect(restoreDepSnapshot(target, ROOT, markerBearing)).rejects.toThrow(
        /install-stamp claim/,
      );
      expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/keep/index.js`))).toBe(
        'keep',
      );
      expect(target.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(false);
    },
  );

  it('[fault: poisoned-cache] rejects corrupt replay bytes before any destination mutation', async () => {
    const snapshot = await lightningSnapshot();
    const cacheFile = snapshot.tarballCache.files[0];
    if (!cacheFile) throw new Error('LightningCSS snapshot omitted its replay cache');
    const cachePath = `${snapshot.tarballCache.root}/${cacheFile.path}`;
    const corrupt = {
      ...snapshot,
      tarballCache: {
        ...snapshot.tarballCache,
        files: snapshot.tarballCache.files.map((file) => ({
          ...file,
          content: btoa('corrupt'),
        })),
      },
    } satisfies DepSnapshotV3;
    const target = new MemoryFsSync();
    write(target, `${ROOT}/node_modules/keep/index.js`, enc.encode('keep'));
    const siblingPath = '/.rifty/tarball-cache/zz/sibling-1.0.0.tgz';
    write(target, siblingPath, enc.encode('keep-cache'));

    await expect(restoreDepSnapshot(target, ROOT, corrupt)).rejects.toThrow(/integrity mismatch/);

    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/keep/index.js`))).toBe('keep');
    expect(dec.decode(target.readFileBytesSync(siblingPath))).toBe('keep-cache');
    expect(target.existsSync(cachePath)).toBe(false);
  });

  it('serializes bake and migration payloads in one stable top-level order', () => {
    const baked = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const migrationOrder = {
      version: baked.version,
      templateId: baked.templateId,
      packageJsonText: baked.packageJsonText,
      installArtifactIdentity: baked.installArtifactIdentity,
      deps: baked.deps,
      packages: baked.packages,
      lockfile: baked.lockfile,
      tarballCache: baked.tarballCache,
      nodeModules: baked.nodeModules,
    } satisfies DepSnapshotV3;

    expect(serializeDepSnapshot(migrationOrder)).toBe(serializeDepSnapshot(baked));
    expect(Object.keys(JSON.parse(serializeDepSnapshot(baked)) as object)).toEqual([
      'version',
      'templateId',
      'deps',
      'packages',
      'packageJsonText',
      'installArtifactIdentity',
      'lockfile',
      'tarballCache',
      'nodeModules',
    ]);
  });

  it('restores the baked tree into a DIFFERENT root (multi-project dynamic root, ADR-0165)', async () => {
    // Baked at /workspace, restored into a per-project root. Archive paths are
    // root-RELATIVE, so the restore must RE-ROOT, not throw "Archive root mismatch"
    // — the multi-project active root is /scratch or /projects/<id>, never the
    // bake root, so a strict root-equality check would force a slow install on
    // every boot (the instant-boot contract, ADR-0135, would be lost).
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const target = new MemoryFsSync();
    const projectRoot = '/projects/p1';
    await restoreDepSnapshot(target, projectRoot, snapshot);

    expect(
      dec.decode(target.readFileBytesSync(`${projectRoot}/node_modules/vite/package.json`)),
    ).toBe('{"name":"vite"}');
    expect(target.existsSync(`${projectRoot}/node_modules/a/node_modules/ms/index.js`)).toBe(true);
    expect(dec.decode(target.readFileBytesSync(`${projectRoot}/package-lock.json`))).toBe(
      PACKAGE_LOCK_TEXT,
    );
    // and NOT leaked at the bake root
    expect(target.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(false);
  });

  it('restore REPLACES a stale node_modules instead of merging over it', async () => {
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });

    const target = new MemoryFsSync();
    write(target, `${ROOT}/node_modules/stale-pkg/index.js`, enc.encode('stale'));
    await restoreDepSnapshot(target, ROOT, snapshot);

    expect(target.existsSync(`${ROOT}/node_modules/stale-pkg/index.js`)).toBe(false);
    expect(target.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(true);
  });

  it('rejects malformed snapshots loudly', () => {
    expect(() => parseDepSnapshot('{"version":1}')).toThrow('version');
    expect(() => parseDepSnapshot('{"version":3,"templateId":"vite"}')).toThrow('Malformed');
    const mismatched = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    expect(() =>
      parseDepSnapshot(JSON.stringify({ ...mismatched, deps: { vite: '^6.0.0' } })),
    ).toThrow('packageJsonText');
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a %s package count before restore mutates destination bytes', (_case, packages) => {
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const target = new MemoryFsSync();
    write(target, `${ROOT}/node_modules/keep/index.js`, enc.encode('keep'));

    expect(() => {
      const parsed = parseDepSnapshot(JSON.stringify({ ...snapshot, packages }));
      restoreDepSnapshot(target, ROOT, parsed);
    }).toThrow(/packages/);
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/keep/index.js`))).toBe('keep');
    expect(target.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(false);
  });

  it('does not accept a snapshot missing the current install-artifact identity when package.json is unchanged', async () => {
    const { vfs, fsSync } = createMemoryFs();
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON_TEXT));
    const { installArtifactIdentity: _missing, ...rawSnapshot } = JSON.parse(
      JSON.stringify(
        buildDepSnapshot(bakedFs(), ROOT, {
          templateId: 'vite',
          deps: { vite: '^5.4.0' },
          packages: 8,
        }),
      ),
    ) as Record<string, unknown>;
    let installed = false;
    const options = {
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => rawSnapshot as unknown as DepSnapshotV3,
      install: async () => {
        installed = true;
        return installResult(9);
      },
      log: () => undefined,
    } satisfies Parameters<typeof ensureProjectDependencies>[0];

    const result = await ensureProjectDependencies(options);

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(installed).toBe(true);
  });

  it('does not restore the same dependency map when package.json overrides drift', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(
      `${ROOT}/package.json`,
      enc.encode(
        JSON.stringify({
          name: 'app',
          dependencies: { vite: '^5.4.0' },
          overrides: { picocolors: '1.1.1' },
        }),
      ),
    );

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => snapshot,
      install: async () => installResult(9),
      log: () => undefined,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
  });

  it('does not restore package-identical bytes from a different install-artifact identity', async () => {
    const { vfs, fsSync } = createMemoryFs();
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON_TEXT));
    const snapshot = {
      ...buildDepSnapshot(bakedFs(), ROOT, {
        templateId: 'vite',
        deps: { vite: '^5.4.0' },
        packages: 8,
      }),
      installArtifactIdentity: `sha256:${'0'.repeat(64)}`,
    } satisfies DepSnapshotV3;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => snapshot,
      install: async () => installResult(9),
      log: () => undefined,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
  });

  it('fetchDepSnapshot handles raw gzip bytes AND server-decoded JSON (magic sniff)', async () => {
    const { gzipSync } = await import('node:zlib');
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const json = JSON.stringify(snapshot);
    const originalFetch = globalThis.fetch;
    try {
      // Raw gzip bytes (static host serves .gz verbatim).
      globalThis.fetch = async () => new Response(new Uint8Array(gzipSync(json)));
      expect((await fetchDepSnapshot('/x.json.gz'))?.packages).toBe(8);

      // Already-decoded body (vite dev sets Content-Encoding: gzip on .gz).
      globalThis.fetch = async () => new Response(json);
      expect((await fetchDepSnapshot('/x.json.gz'))?.packages).toBe(8);

      // Failure preserves a typed/exact reason; acquisition owns fallback.
      globalThis.fetch = async () => new Response('nope', { status: 404 });
      await expect(fetchDepSnapshot('/x.json.gz')).rejects.toMatchObject({
        code: 'DEP_SNAPSHOT_FETCH_FAILED',
        stage: 'fetch',
        url: '/x.json.gz',
      });
      await expect(fetchDepSnapshot('/x.json.gz')).rejects.toThrow('HTTP 404');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchDepSnapshot bounds a stalled asset and preserves the timeout reason', async () => {
    const originalFetch = globalThis.fetch;
    vi.useFakeTimers();
    try {
      globalThis.fetch = () => new Promise<Response>(() => {});
      const fetched = fetchDepSnapshot('/stalled.json.gz');
      const typedFailure = expect(fetched).rejects.toMatchObject({
        code: 'DEP_SNAPSHOT_FETCH_FAILED',
        stage: 'fetch',
        url: '/stalled.json.gz',
      });
      const exactReason = expect(fetched).rejects.toThrow('no response headers for 10000ms');
      await vi.advanceTimersByTimeAsync(10_001);
      await typedFailure;
      await exactReason;
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });
});
