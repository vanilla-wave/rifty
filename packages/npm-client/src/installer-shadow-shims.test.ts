/**
 * Install-time shadow shims (ADR-0188, backlog npm-client/install-time-shadow-shims):
 * internals shims written into the ACTUAL installed dirs (nested included),
 * companion lockstep pins, range gate, and the substitution provenance lines —
 * fresh install AND lockfile replay.
 */
import { internalsShims } from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { closureHashOf } from './closure-hash.ts';
import { EDDY_BUNDLE_FORMAT, packEddyBundle } from './eddy-bundle.ts';
import { install } from './installer.ts';
import { shadowSubstitutionPlanForInstallResult } from './internal/shadow/install-result.ts';
import type { Lockfile } from './linker.ts';
import { resolveOverride } from './overrides.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { matchesRange } from './semver.ts';
import { applyInternalsShims } from './shadow-shims.ts';
import { computeIntegrity } from './tarball-cache.ts';

type FixtureManifest = VersionManifest & {
  readonly bundleDependencies?: readonly string[];
};

interface FakeRegistryEntry {
  manifest: FixtureManifest;
  tarball: Uint8Array;
}

interface EntryManifestOptions {
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly bundleDependencies?: readonly string[];
}

class FakeRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  packumentReads = 0;
  tarballReads = 0;

  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }
  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads++;
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }
  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    this.tarballReads++;
    const match = /^fake:\/\/([^|]+)\|(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const entry = this.db.get(decodeURIComponent(match[1] ?? ''))?.get(match[2] ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function makeEntry(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
  files: Record<string, string | Uint8Array> = {},
  bin?: VersionManifest['bin'],
  optionalDependencies: Record<string, string> = {},
  manifestOptions: EntryManifestOptions = {},
): Promise<FakeRegistryEntry> {
  const chunks: Uint8Array[] = [];
  const manifestFields = {
    name,
    version,
    dependencies,
    bin,
    optionalDependencies,
    ...(manifestOptions.peerDependencies === undefined
      ? {}
      : { peerDependencies: { ...manifestOptions.peerDependencies } }),
    ...(manifestOptions.bundleDependencies === undefined
      ? {}
      : { bundleDependencies: [...manifestOptions.bundleDependencies] }),
  };
  const packageJson = JSON.stringify(manifestFields);
  for (const [entry, body] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    chunks.push(buildHeader(`package/${entry}`, bytes.length), padToBlock(bytes));
  }
  return {
    manifest: {
      ...manifestFields,
      dist: { tarball: `fake://${encodeURIComponent(name)}|${version}` },
    },
    tarball: await gzip(concat(...chunks, TAR_TRAILER)),
  };
}

function db(
  ...entries: [string, FakeRegistryEntry][]
): Map<string, Map<string, FakeRegistryEntry>> {
  const map = new Map<string, Map<string, FakeRegistryEntry>>();
  for (const [name, entry] of entries) {
    const versions = map.get(name) ?? new Map<string, FakeRegistryEntry>();
    versions.set(entry.manifest.version, entry);
    map.set(name, versions);
  }
  return map;
}

async function readText(vfs: MemoryVfs, path: string): Promise<string> {
  return await vfs.readFileText(path);
}

const REAL_ROLLUP_NATIVE = 'throw new Error("REAL-NATIVE-SENTINEL");';
const requireFromRegistry = createRequire(
  new URL('../../../tools/shadow-registry/package.json', import.meta.url),
);
const exactEsbuildWasm = new Uint8Array(
  await readFile(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);
const exactEsbuildWasmSha256 = createHash('sha256').update(exactEsbuildWasm).digest('hex');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('install-time shadow shims — rollup internals patch + companion', () => {
  const BIN_TARGET = 'dist/bin/rollup';
  const ROLLUP_BIN = { rollup: BIN_TARGET };
  const launcher = (owner: string) => `#!/usr/bin/env node\nimport('../${owner}/${BIN_TARGET}');\n`;

  async function cliEntry(
    name: string,
    version: string,
    dependencies: Record<string, string> = {},
    command = 'rollup',
    optionalDependencies: Record<string, string> = {},
  ) {
    return makeEntry(
      name,
      version,
      dependencies,
      {
        [BIN_TARGET]: '#!/usr/bin/env node\n',
        ...(name === 'rollup' ? { 'dist/native.js': REAL_ROLLUP_NATIVE } : {}),
      },
      { [command]: BIN_TARGET },
      optionalDependencies,
    );
  }

  function putEntry(
    entries: Map<string, Map<string, FakeRegistryEntry>>,
    name: string,
    entry: FakeRegistryEntry,
  ): void {
    entries.set(name, new Map([[entry.manifest.version, entry]]));
  }

  async function installFixture(
    entries: Map<string, Map<string, FakeRegistryEntry>>,
    dependencies: Record<string, string>,
    vfs = new MemoryVfs(),
  ) {
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(entries);
    const result = await install('root', '1.0.0', dependencies, {
      vfs,
      cwd: '/proj',
      registry,
    });
    return { registry, result, vfs };
  }

  async function rollupDb(version = '4.62.2') {
    return db(
      ['rollup', await makeEntry('rollup', version, {}, { 'dist/native.js': REAL_ROLLUP_NATIVE })],
      ['@rollup/wasm-node', await makeEntry('@rollup/wasm-node', version)],
    );
  }

  async function claimDb(wasmCommand = 'rollup', wasmDependencies: Record<string, string> = {}) {
    return db(
      ['rollup', await cliEntry('rollup', '4.62.2')],
      [
        '@rollup/wasm-node',
        await cliEntry('@rollup/wasm-node', '4.62.2', wasmDependencies, wasmCommand),
      ],
    );
  }

  it('patches rollup/dist/native.js in place and installs the same-version companion', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const lines: string[] = [];
    const result = await install(
      'root',
      '1.0.0',
      { rollup: '4.62.2' },
      {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(await rollupDb()),
        onSubstitution: (line) => lines.push(line),
      },
    );

    const native = await readText(vfs, '/proj/node_modules/rollup/dist/native.js');
    expect(native).toContain("require('@rollup/wasm-node/dist/native.js')");
    expect(native).not.toContain('REAL-NATIVE-SENTINEL');
    // Companion joined the walk: installed AND pinned in the lockfile.
    expect(result.lockfile.packages['node_modules/@rollup/wasm-node']?.version).toBe('4.62.2');
    expect(await vfs.exists('/proj/node_modules/@rollup/wasm-node/package.json')).toBe(true);
    expect(lines).toContain('npm: rollup@4.62.2 internals patched from shadow registry');
  });

  it('[fault: provenance-lie / sibling-drift] keeps auto-only metadata truthful across replay and restores ordinary lock demand', async () => {
    const entries = await claimDb('rollup', { helper: '1.0.0' });
    putEntry(entries, 'helper', await cliEntry('helper', '1.0.0', {}, 'helper'));
    const vfs = new MemoryVfs();
    const writes = vi.spyOn(vfs, 'writeFile');
    const { result: fresh } = await installFixture(entries, { rollup: '4.62.2' }, vfs);
    const rollupWrites = () =>
      writes.mock.calls.filter(([path]) => path === '/proj/node_modules/.bin/rollup');
    expect.soft(rollupWrites()).toHaveLength(1);
    expect.soft(await readText(vfs, '/proj/node_modules/.bin/rollup')).toBe(launcher('rollup'));
    expect(await readText(vfs, '/proj/node_modules/.bin/helper')).toBe(launcher('helper'));
    const packageNames = ['rollup', '@rollup/wasm-node'] as const;
    for (const name of packageNames) {
      expect(fresh.packages.find((pkg) => pkg.name === name)?.bin).toEqual(ROLLUP_BIN);
      expect(fresh.lockfile.packages[`node_modules/${name}`]?.bin).toEqual(ROLLUP_BIN);
      expect(
        JSON.parse(await readText(vfs, `/proj/node_modules/${name}/package.json`)),
      ).toMatchObject({ bin: ROLLUP_BIN });
    }
    const metadataPaths = [
      '/proj/package-lock.json',
      ...packageNames.map((name) => `/proj/node_modules/${name}/package.json`),
    ];
    const freshMetadata = await Promise.all(metadataPaths.map((path) => readText(vfs, path)));
    writes.mockClear();
    const { registry: replayRegistry, result: replay } = await installFixture(
      entries,
      { rollup: '4.62.2' },
      vfs,
    );
    expect([replayRegistry.packumentReads, replayRegistry.tarballReads]).toEqual([0, 0]);
    expect.soft(rollupWrites()).toHaveLength(1);
    expect.soft(await readText(vfs, '/proj/node_modules/.bin/rollup')).toBe(launcher('rollup'));
    expect(replay.lockfile).toEqual(fresh.lockfile);
    expect(await Promise.all(metadataPaths.map((path) => readText(vfs, path)))).toEqual(
      freshMetadata,
    );
    for (const name of packageNames) {
      expect(replay.packages.find((pkg) => pkg.name === name)?.bin).toEqual(ROLLUP_BIN);
    }

    const { registry: ordinaryRegistry, result: ordinary } = await installFixture(
      entries,
      { '@rollup/wasm-node': '4.62.2' },
      vfs,
    );
    expect([ordinaryRegistry.packumentReads, ordinaryRegistry.tarballReads]).toEqual([0, 0]);
    expect(await readText(vfs, '/proj/node_modules/.bin/rollup')).toBe(
      launcher('@rollup/wasm-node'),
    );
    expect(ordinary.packages[0]?.bin).toEqual(ROLLUP_BIN);
    expect(ordinary.lockfile.packages['node_modules/@rollup/wasm-node']?.bin).toEqual(ROLLUP_BIN);
  });

  it.each([
    ['auto then required', { auto: '1.0.0', ordinary: '1.0.0' }, false],
    ['required then auto', { ordinary: '1.0.0', auto: '1.0.0' }, false],
    ['auto then optional', { auto: '1.0.0', ordinary: '1.0.0' }, true],
  ] as const)(
    '[fault: observable-order] retains a later/earlier ordinary edge: %s',
    async (_name, roots, optional) => {
      const entries = await claimDb('wasm-rollup');
      putEntry(entries, 'auto', await makeEntry('auto', '1.0.0', { rollup: '4.62.2' }));
      putEntry(
        entries,
        'ordinary',
        await makeEntry(
          'ordinary',
          '1.0.0',
          optional ? {} : { '@rollup/wasm-node': '4.62.2' },
          {},
          undefined,
          optional ? { '@rollup/wasm-node': '4.62.2' } : {},
        ),
      );
      const { result, vfs } = await installFixture(entries, roots);
      expect(await readText(vfs, '/proj/node_modules/.bin/rollup')).toBe(launcher('rollup'));
      expect(await readText(vfs, '/proj/node_modules/.bin/wasm-rollup')).toBe(
        launcher('@rollup/wasm-node'),
      );
      expect(result.packages.filter(({ name }) => name === '@rollup/wasm-node')).toHaveLength(1);
    },
  );

  it('[fault: lossy-aggregate] keys claim demand by identity and recorded install path', async () => {
    const entries = db(
      ['rollup', await cliEntry('rollup', '4.63.0')],
      ['rollup', await cliEntry('rollup', '4.62.2', { '@rollup/wasm-node': '4.62.2' })],
      ['@rollup/wasm-node', await cliEntry('@rollup/wasm-node', '4.63.0', {}, 'wasm-rollup')],
      ['@rollup/wasm-node', await cliEntry('@rollup/wasm-node', '4.62.2', {}, 'wasm-rollup')],
      ['host', await makeEntry('host', '1.0.0', { rollup: '4.62.2' })],
    );
    const { result: seed, vfs } = await installFixture(entries, {
      rollup: '4.63.0',
      host: '1.0.0',
    });
    const lock = structuredClone(seed.lockfile);
    const rootRollup = lock.packages['node_modules/rollup'];
    const rootWasm = lock.packages['node_modules/@rollup/wasm-node'];
    const host = lock.packages['node_modules/host'];
    const nestedRollup = 'node_modules/host/node_modules/rollup';
    const nestedWasm = `${nestedRollup}/node_modules/@rollup/wasm-node`;
    if (!rootRollup || !rootWasm || !host) throw new Error('test setup: incomplete seed lock');
    host.dependencies = { rollup: '4.63.0' };
    lock.packages[nestedRollup] = {
      ...rootRollup,
      dependencies: { '@rollup/wasm-node': '4.63.0' },
    };
    lock.packages[nestedWasm] = { ...rootWasm };
    await vfs.writeFile('/proj/package-lock.json', JSON.stringify(lock));

    const writes = vi.spyOn(vfs, 'writeFile');
    const { result } = await installFixture(entries, { rollup: '4.63.0', host: '1.0.0' }, vfs);
    expect
      .soft(writes.mock.calls.filter(([path]) => path === '/proj/node_modules/.bin/wasm-rollup'))
      .toHaveLength(0);
    expect.soft(await vfs.exists('/proj/node_modules/.bin/wasm-rollup')).toBe(false);
    expect(await readText(vfs, `/proj/${nestedRollup}/node_modules/.bin/wasm-rollup`)).toBe(
      launcher('@rollup/wasm-node'),
    );
    expect(
      result.packages
        .filter(({ name, version }) => name === '@rollup/wasm-node' && version === '4.63.0')
        .map(({ installPath }) => installPath),
    ).toEqual(['node_modules/@rollup/wasm-node', nestedWasm]);
  });

  it('patches a NESTED rollup copy at its actual install path with a lockstep companion', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(
      db(
        [
          'rollup',
          await makeEntry('rollup', '4.63.0', {}, { 'dist/native.js': REAL_ROLLUP_NATIVE }),
        ],
        [
          'rollup',
          await makeEntry('rollup', '4.62.2', {}, { 'dist/native.js': REAL_ROLLUP_NATIVE }),
        ],
        ['@rollup/wasm-node', await makeEntry('@rollup/wasm-node', '4.63.0')],
        ['@rollup/wasm-node', await makeEntry('@rollup/wasm-node', '4.62.2')],
        ['uses-old-rollup', await makeEntry('uses-old-rollup', '1.0.0', { rollup: '4.62.2' })],
      ),
    );
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { rollup: '4.63.0', 'uses-old-rollup': '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => lines.push(line),
      },
    );

    const nestedNative = await readText(
      vfs,
      '/proj/node_modules/uses-old-rollup/node_modules/rollup/dist/native.js',
    );
    expect(nestedNative).toContain("require('@rollup/wasm-node/dist/native.js')");
    // Each copy got its own same-version companion, resolvable by walk-up.
    expect(await vfs.exists('/proj/node_modules/@rollup/wasm-node/package.json')).toBe(true);
    expect(
      await vfs.exists(
        '/proj/node_modules/uses-old-rollup/node_modules/rollup/node_modules/@rollup/wasm-node/package.json',
      ),
    ).toBe(true);
    expect(lines).toContain('npm: rollup@4.63.0 internals patched from shadow registry');
    expect(lines).toContain('npm: rollup@4.62.2 internals patched from shadow registry');
  });

  it('throws NotImplementedError for a rollup version outside the proven shim range', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(
      db([
        'rollup',
        await makeEntry('rollup', '5.0.0', {}, { 'dist/native.js': REAL_ROLLUP_NATIVE }),
      ]),
    );
    await expect(
      install('root', '1.0.0', { rollup: '5.0.0' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      message: expect.stringContaining('shadow-registry.rollup@5.0.0'),
    });
  });

  it('keeps a locked unsupported root optional non-fatal with Eddy configured', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const stable = await makeEntry('stable', '1.0.0');
    const unsupported = await makeEntry(
      'rollup',
      '5.0.0',
      {},
      { 'dist/native.js': REAL_ROLLUP_NATIVE },
    );
    const registry = new FakeRegistry(db(['stable', stable], ['rollup', unsupported]));
    await install('root', '1.0.0', { stable: '1.0.0' }, { vfs, cwd: '/proj', registry });
    const lockfile = JSON.parse(await readText(vfs, '/proj/package-lock.json')) as {
      packages: Record<
        string,
        {
          version: string;
          dependencies?: Record<string, string>;
          resolved?: string;
          integrity?: string;
        }
      >;
    };
    const root = lockfile.packages[''];
    if (!root) throw new Error('test setup: root lockfile entry missing');
    root.dependencies = { ...root.dependencies, rollup: '5.0.0' };
    lockfile.packages['node_modules/rollup'] = {
      version: '5.0.0',
      dependencies: {},
      resolved: unsupported.manifest.dist.tarball,
      integrity: await computeIntegrity(unsupported.tarball),
    };
    await vfs.writeFile('/proj/package-lock.json', JSON.stringify(lockfile));
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        dependencies: { stable: '1.0.0' },
        optionalDependencies: { rollup: '5.0.0' },
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('expected Eddy fallback'));

    const result = await install({
      vfs,
      cwd: '/proj',
      registry,
      resolverUrl: 'https://eddy.invalid/resolve',
    });

    expect(result.packages.map(({ name }) => name)).toEqual(['stable']);
    expect(await vfs.exists('/proj/node_modules/rollup/package.json')).toBe(false);
    expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining('optional dependency rollup@5.0.0 of root could not be installed'),
    );
  });

  it('[fault: provenance-lie] declines an Eddy bundle missing a surviving optional root tarball', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        optionalDependencies: { 'optional-root': '1.0.0' },
      }),
    );
    const optionalRoot = await makeEntry('optional-root', '1.0.0', { rollup: '5.0.0' });
    const unsupported = await makeEntry(
      'rollup',
      '5.0.0',
      {},
      { 'dist/native.js': REAL_ROLLUP_NATIVE },
    );
    const lockfile: Lockfile = {
      name: 'root',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { version: '1.0.0', dependencies: { 'optional-root': '1.0.0' } },
        'node_modules/optional-root': {
          version: '1.0.0',
          dependencies: { rollup: '5.0.0' },
          resolved: optionalRoot.manifest.dist.tarball,
          integrity: await computeIntegrity(optionalRoot.tarball),
        },
        'node_modules/rollup': {
          version: '5.0.0',
          dependencies: {},
          resolved: unsupported.manifest.dist.tarball,
          integrity: await computeIntegrity(unsupported.tarball),
        },
      },
    };
    const closureHash = await closureHashOf(lockfile);
    const bundle = packEddyBundle({
      manifest: {
        format: EDDY_BUNDLE_FORMAT,
        npmClientVersion: '0.1.0-test',
        asOf: {
          resolvedAt: '2026-07-19T00:00:00.000Z',
          registry: 'https://registry.test',
          closureHash,
        },
        tarballs: [],
      },
      lockfileText: JSON.stringify(lockfile),
      tarballs: [],
    });
    const registry = new FakeRegistry(db(['optional-root', optionalRoot], ['rollup', unsupported]));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bundle as unknown as BodyInit));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await install({
      vfs,
      cwd: '/proj',
      registry,
      resolverUrl: 'https://eddy.invalid/resolve',
    });

    expect(result.source ?? 'standard').toBe('standard');
    expect(result.provenance.eddyFallback?.reason).toBe(
      'post: bundle omits the tarball for optional-root@1.0.0',
    );
    expect(result.provenance.packages).toContainEqual({
      name: 'optional-root',
      version: '1.0.0',
      transport: 'registry',
    });
    expect(result.packages.map(({ name }) => name)).toEqual(['optional-root']);
    expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining(
        'optional dependency optional-root@1.0.0 of root could not be installed',
      ),
    );
  });

  it('[fault: provenance-lie] does not lose an earlier optional metadata frontier when a later child is unsupported', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        optionalDependencies: { 'optional-root': '1.0.0' },
        overrides: { 'optional-root>foo': 'bar@2.0.0' },
      }),
    );
    const optionalRoot = await makeEntry('optional-root', '1.0.0', {
      foo: '1.0.0',
      rollup: '5.0.0',
    });
    const bar = await makeEntry('bar', '2.0.0');
    const unsupported = await makeEntry(
      'rollup',
      '5.0.0',
      {},
      { 'dist/native.js': REAL_ROLLUP_NATIVE },
    );
    const optionalIntegrity = await computeIntegrity(optionalRoot.tarball);
    const lockfile: Lockfile = {
      name: 'root',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { version: '1.0.0', dependencies: { 'optional-root': '1.0.0' } },
        'node_modules/optional-root': {
          version: '1.0.0',
          // Order is the fault: `foo` proves metadata ownership before the
          // later unsupported child stops the optional traversal.
          dependencies: { foo: '1.0.0', rollup: '5.0.0' },
          resolved: optionalRoot.manifest.dist.tarball,
          integrity: optionalIntegrity,
        },
        'node_modules/rollup': {
          version: '5.0.0',
          dependencies: {},
          resolved: unsupported.manifest.dist.tarball,
          integrity: await computeIntegrity(unsupported.tarball),
        },
      },
    };
    const tarballEntry = {
      file: 'tarballs/optional-root-1.0.0.tgz',
      name: 'optional-root',
      version: '1.0.0',
      integrity: optionalIntegrity,
    };
    const bundle = packEddyBundle({
      manifest: {
        format: EDDY_BUNDLE_FORMAT,
        npmClientVersion: '0.1.0-test',
        asOf: {
          resolvedAt: '2026-07-19T00:00:00.000Z',
          registry: 'https://registry.test',
          closureHash: await closureHashOf(lockfile),
        },
        tarballs: [tarballEntry],
      },
      lockfileText: JSON.stringify(lockfile),
      tarballs: [{ entry: tarballEntry, bytes: optionalRoot.tarball }],
    });
    const registry = new FakeRegistry(
      db(['optional-root', optionalRoot], ['bar', bar], ['rollup', unsupported]),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bundle as unknown as BodyInit));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await install({
      vfs,
      cwd: '/proj',
      registry,
      resolverUrl: 'https://eddy.invalid/resolve',
    });

    expect(result.source ?? 'standard').toBe('standard');
    expect(result.provenance.eddyFallback?.reason).toMatch(
      /bundle lockfile does not cover the request|override forces a re-resolve/,
    );
    expect(result.packages.map(({ name }) => name).sort()).toEqual(['bar', 'optional-root']);
    expect(result.provenance.packages).toContainEqual({
      name: 'bar',
      version: '2.0.0',
      transport: 'registry',
    });
  });

  it('loud EBROKENLOCK when a pre-shim lockfile lacks the companion entry (replay)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await rollupDb());
    await install('root', '1.0.0', { rollup: '4.62.2' }, { vfs, cwd: '/proj', registry });
    // Simulate a lockfile written before install-time shims existed.
    const lockfile = JSON.parse(await readText(vfs, '/proj/package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    lockfile.packages = Object.fromEntries(
      Object.entries(lockfile.packages).filter(([key]) => key !== 'node_modules/@rollup/wasm-node'),
    );
    await vfs.writeFile('/proj/package-lock.json', JSON.stringify(lockfile));

    await expect(
      install('root', '1.0.0', { rollup: '4.62.2' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toMatchObject({ code: 'EBROKENLOCK' });
  });

  it('applyInternalsShims refuses a companion at a drifted version', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules/rollup/dist', { recursive: true });
    await expect(
      applyInternalsShims(
        vfs,
        '/proj',
        [
          { name: 'rollup', version: '4.62.2', installPath: 'node_modules/rollup' },
          {
            name: '@rollup/wasm-node',
            version: '4.62.1',
            installPath: 'node_modules/@rollup/wasm-node',
          },
        ],
        () => {},
      ),
    ).rejects.toThrow(/companion/i);
  });
});

describe('shadow substitutions — registry twins + retained legacy redirects', () => {
  async function esbuildDb() {
    return db(
      [
        'esbuild-wasm',
        await makeEntry(
          'esbuild-wasm',
          '0.28.0',
          {},
          { 'esbuild.wasm': exactEsbuildWasm },
          undefined,
          {},
          { peerDependencies: {}, bundleDependencies: [] },
        ),
      ],
      ['user-esbuild-target', await makeEntry('user-esbuild-target', '0.28.0')],
      ['viteish', await makeEntry('viteish', '1.0.0', { esbuild: '^0.28.0' })],
      ['viteish-old', await makeEntry('viteish-old', '1.0.0', { esbuild: '0.21.5' })],
    );
  }

  const MATERIALIZE_LINE =
    'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)';

  it('materializes esbuild over its exact registry twin on fresh + offline replay', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const fresh: string[] = [];
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => fresh.push(line),
      },
    );

    const aliasMain = await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs');
    expect(aliasMain).toContain('__rifty?.esbuild');
    expect(await readText(vfs, '/proj/node_modules/esbuild/package.json')).toContain('"esbuild"');
    const wasm = await vfs.readFile('/proj/node_modules/esbuild-wasm/esbuild.wasm');
    expect(wasm.byteLength).toBe(13_918_738);
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(exactEsbuildWasmSha256);
    expect(registry.packumentReads).toBe(1);
    expect(registry.tarballReads).toBe(1);
    expect(fresh).toContain(MATERIALIZE_LINE);

    // Replay (lockfile fast path): same lines, byte-identical shim files.
    const replay: string[] = [];
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => replay.push(line),
      },
    );
    expect(replay).toContain(MATERIALIZE_LINE);
    expect(await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs')).toBe(aliasMain);
    expect(await vfs.readFile('/proj/node_modules/esbuild-wasm/esbuild.wasm')).toEqual(wasm);
    expect(registry.packumentReads).toBe(1);
    expect(registry.tarballReads).toBe(1);
  });

  it('materializes a transitive registry-twin recipe on fresh AND replay', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const fresh: string[] = [];
    const first = await install(
      'root',
      '1.0.0',
      { viteish: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => fresh.push(line),
      },
    );
    expect(fresh).toContain(MATERIALIZE_LINE);
    const firstMain = await vfs.readFile('/proj/node_modules/esbuild/lib/main.cjs');
    const firstBin = await vfs.readFile('/proj/node_modules/esbuild/bin/esbuild');
    const firstWasm = await vfs.readFile('/proj/node_modules/esbuild-wasm/esbuild.wasm');
    expect(firstWasm.byteLength).toBe(13_918_738);
    expect(createHash('sha256').update(firstWasm).digest('hex')).toBe(exactEsbuildWasmSha256);
    expect(first.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      bin: { esbuild: 'bin/esbuild' },
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });
    expect(first.lockfile.packages['node_modules/esbuild-wasm']).toMatchObject({
      version: '0.28.0',
      resolved: 'fake://esbuild-wasm|0.28.0',
      integrity: expect.stringMatching(/^sha512-/u),
    });
    expect(first.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);
    expect(shadowSubstitutionPlanForInstallResult(first)).toMatchObject({
      bindings: [
        {
          adapterId: 'rifty.runtime-adapter.esbuild.v1',
          packagePath: 'node_modules/esbuild-wasm',
        },
      ],
    });
    expect(registry.packumentReads).toBe(2);
    expect(registry.tarballReads).toBe(2);

    const replay: string[] = [];
    const second = await install(
      'root',
      '1.0.0',
      { viteish: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => replay.push(line),
      },
    );
    expect(replay).toContain(MATERIALIZE_LINE);
    expect(second.lockfile).toEqual(first.lockfile);
    expect(shadowSubstitutionPlanForInstallResult(second)).toEqual(
      shadowSubstitutionPlanForInstallResult(first),
    );
    expect(await vfs.readFile('/proj/node_modules/esbuild/lib/main.cjs')).toEqual(firstMain);
    expect(await vfs.readFile('/proj/node_modules/esbuild/bin/esbuild')).toEqual(firstBin);
    expect(await vfs.readFile('/proj/node_modules/esbuild-wasm/esbuild.wasm')).toEqual(firstWasm);
    expect(registry.packumentReads).toBe(2);
    expect(registry.tarballReads).toBe(2);
  });

  it('attests and replays the registry-backed lightningcss recipe', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const recipeId = 'rifty.shadow-substitution.lightningcss.v2';
    const materializeLine = `npm: lightningcss@^1.32.0 materialized from shadow registry (${recipeId})`;
    const registry = new FakeRegistry(
      db(
        [
          'lightningcss-wasm',
          await makeEntry(
            'lightningcss-wasm',
            '1.32.0',
            { 'napi-wasm': '^1.0.1' },
            {
              'index.js': 'module.exports = { transform() {} };',
              'node_modules/napi-wasm/package.json': JSON.stringify({
                name: 'napi-wasm',
                version: '1.1.3',
              }),
              'node_modules/napi-wasm/index.js': 'module.exports = "bundled napi-wasm";\n',
            },
            undefined,
            {},
            { peerDependencies: {}, bundleDependencies: ['napi-wasm'] },
          ),
        ],
        ['napi-wasm', await makeEntry('napi-wasm', '1.1.3')],
      ),
    );

    const freshTrace: string[] = [];
    const first = await install(
      'root',
      '1.0.0',
      { lightningcss: '^1.32.0' },
      { vfs, cwd: '/proj', registry, onSubstitution: (line) => freshTrace.push(line) },
    );
    expect(first.lockfile.packages['node_modules/lightningcss']).toMatchObject({
      version: '1.32.0',
      riftyShadowRecipe: recipeId,
    });
    expect(first.lockfile.packages['node_modules/lightningcss-wasm']).toMatchObject({
      version: '1.32.0',
    });
    expect(
      first.lockfile.rifty?.shadowSubstitutions.applied.map(
        (substitution) => substitution.substitutionId,
      ),
    ).toEqual([recipeId]);
    expect(freshTrace).toContain(materializeLine);
    expect(freshTrace.filter((line) => line.includes('internals patched'))).toEqual([]);
    expect(await readText(vfs, '/proj/node_modules/lightningcss/index.mjs')).toContain(
      "from 'lightningcss-wasm'",
    );
    expect(first.lockfile.rifty?.shadowSubstitutions.applied).toEqual(
      expect.arrayContaining([expect.objectContaining({ substitutionId: recipeId })]),
    );

    const packument = vi.spyOn(registry, 'getPackument');
    const replayTrace: string[] = [];
    const replay = await install(
      'root',
      '1.0.0',
      { lightningcss: '^1.32.0' },
      { vfs, cwd: '/proj', registry, onSubstitution: (line) => replayTrace.push(line) },
    );
    expect(packument).not.toHaveBeenCalled();
    expect(replayTrace).toEqual(freshTrace);
    expect(replay.lockfile.rifty?.shadowSubstitutions).toEqual(
      first.lockfile.rifty?.shadowSubstitutions,
    );
    expect(await readText(vfs, '/proj/node_modules/lightningcss/index.cjs')).toContain(
      "require('lightningcss-wasm')",
    );
  });

  const UNSUPPORTED_REQUEST = '0.21.5';
  const unsupportedRequestError = {
    name: 'NotImplementedError',
    feature: 'esbuild.version',
  };

  it('refuses a direct registry-twin substitution when the request excludes exact esbuild 0.28.0', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const lines: string[] = [];

    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: UNSUPPORTED_REQUEST },
        {
          vfs,
          cwd: '/proj',
          registry: new FakeRegistry(await esbuildDb()),
          onSubstitution: (line) => lines.push(line),
        },
      ),
    ).rejects.toMatchObject(unsupportedRequestError);
    expect(lines).toEqual([]);
    expect(await vfs.exists('/proj/node_modules/esbuild/package.json')).toBe(false);
  });

  it('refuses a direct registry-twin substitution on replay when the request excludes exact esbuild 0.28.0', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    await install('root', '1.0.0', { esbuild: '^0.28.0' }, { vfs, cwd: '/proj', registry });
    const aliasBefore = await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs');
    const packument = vi.spyOn(registry, 'getPackument');
    const lines: string[] = [];

    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: UNSUPPORTED_REQUEST },
        { vfs, cwd: '/proj', registry, onSubstitution: (line) => lines.push(line) },
      ),
    ).rejects.toMatchObject(unsupportedRequestError);
    expect(packument).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect(await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs')).toBe(aliasBefore);
  });

  it('refuses a transitive registry-twin substitution outside its exact recipe', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const lines: string[] = [];

    await expect(
      install(
        'root',
        '1.0.0',
        { 'viteish-old': '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry: new FakeRegistry(await esbuildDb()),
          onSubstitution: (line) => lines.push(line),
        },
      ),
    ).rejects.toMatchObject(unsupportedRequestError);
    expect(lines).toEqual([]);
    expect(await vfs.exists('/proj/node_modules/esbuild/package.json')).toBe(false);
  });

  it('refuses transitive replay when the recorded request drifts outside the recipe', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    await install('root', '1.0.0', { viteish: '1.0.0' }, { vfs, cwd: '/proj', registry });
    const lockfile = JSON.parse(await readText(vfs, '/proj/package-lock.json')) as {
      packages: Record<string, { dependencies?: Record<string, string> }>;
    };
    const viteish = lockfile.packages['node_modules/viteish'];
    if (!viteish?.dependencies)
      throw new Error('test setup: viteish lockfile dependencies missing');
    viteish.dependencies.esbuild = UNSUPPORTED_REQUEST;
    await vfs.writeFile('/proj/package-lock.json', JSON.stringify(lockfile));
    const aliasBefore = await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs');
    const packument = vi.spyOn(registry, 'getPackument');
    const lines: string[] = [];

    await expect(
      install(
        'root',
        '1.0.0',
        { viteish: '1.0.0' },
        { vfs, cwd: '/proj', registry, onSubstitution: (line) => lines.push(line) },
      ),
    ).rejects.toMatchObject(unsupportedRequestError);
    expect(packument).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect(await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs')).toBe(aliasBefore);
  });

  it('lets an explicit user target bypass built-in registry-twin policy without shadow attribution', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const overrides = { esbuild: 'user-esbuild-target@0.28.0' };
    const fresh: string[] = [];

    await install(
      'root',
      '1.0.0',
      { esbuild: UNSUPPORTED_REQUEST },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides,
        onSubstitution: (line) => fresh.push(line),
      },
    );
    expect(fresh).toEqual([]);

    const replay: string[] = [];
    await install(
      'root',
      '1.0.0',
      { esbuild: UNSUPPORTED_REQUEST },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides,
        onSubstitution: (line) => replay.push(line),
      },
    );
    expect(replay).toEqual([]);
    expect(await vfs.exists('/proj/node_modules/user-esbuild-target/package.json')).toBe(true);
  });

  it('prints a redirect line for a plain baked redirect without an internals shim (bcrypt)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(db(['bcryptjs', await makeEntry('bcryptjs', '2.4.3')]));
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { bcrypt: '*' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => lines.push(line),
      },
    );
    expect(lines).toContain(
      'npm: bcrypt@* → bcryptjs@2.4.3 (substituted from shadow registry, ADR-0051)',
    );
    expect(lines.filter((l) => l.includes('internals patched'))).toEqual([]);
  });

  it('does NOT attribute a USER override to the shadow registry', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(db(['pure', await makeEntry('pure', '1.0.0')]));
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { native: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides: { native: 'pure@1.0.0' },
        onSubstitution: (line) => lines.push(line),
      },
    );
    expect(lines).toEqual([]);
  });

  it('defaults the substitution sink to console.warn — substitutions are never silent', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await install('root', '1.0.0', { esbuild: '^0.28.0' }, { vfs, cwd: '/proj', registry });
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(MATERIALIZE_LINE);
  });

  it('does not attribute an explicit user target outside the builtin recipe', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(
      db(['user-esbuild-target', await makeEntry('user-esbuild-target', '0.29.0')]),
    );
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { esbuild: '*' },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides: { esbuild: 'user-esbuild-target@0.29.0' },
        onSubstitution: (line) => lines.push(line),
      },
    );
    expect(lines).toEqual([]);
    expect(await vfs.exists('/proj/node_modules/user-esbuild-target/package.json')).toBe(true);
  });
});

describe('shadow-registry data consistency (npm-client is the semver-aware side)', () => {
  it('every baked alias override target version satisfies its internals-shim range', () => {
    for (const [source, shim] of Object.entries(internalsShims)) {
      if (!shim.into) continue;
      const override = resolveOverride(shim.into, undefined, {});
      expect(override?.name).toBe(source);
      // Baked alias overrides pin an exact target version; it must be in range.
      expect(override?.range && matchesRange(override.range, shim.range)).toBe(true);
    }
  });
});
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
