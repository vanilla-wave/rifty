import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { type TarballCache, computeIntegrity } from './tarball-cache.ts';

const encoder = new TextEncoder();

const CATALOG = {
  id: 'rifty.shadow-substitutions.builtin.v2',
  digest: 'a037016265e1c348254b3f067403278f5baee8b1f39e2bcd16f535fd0b9c3b52',
} as const;

const ESBUILD_RECIPE = {
  id: 'rifty.shadow-substitution.esbuild.v2',
  digest: 'e6af53d0b43aa2a4cf83d46818de1b7313f7ad5345cfe0db298b981d3f89368a',
  bin: { esbuild: 'bin/esbuild' },
  files: [
    {
      path: 'bin/esbuild',
      content: `#!/usr/bin/env node
class NotImplementedError extends Error {
  constructor(feature) {
    super(\`Not implemented: \${feature}\`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}
throw new NotImplementedError('esbuild.cli');
`,
      sha256: 'd1e76833fddb0febf70bfaf8d6942286382fbb549b0722e49de997fdaa773f47',
      bytes: 248,
    },
    {
      path: 'lib/main.cjs',
      content: `const esbuild = globalThis.__rifty?.esbuild;
if (esbuild == null) {
  throw new Error('rifty invariant: esbuild runtime slot is not initialized');
}
module.exports = esbuild;
`,
      sha256: '961d1a20258b40af980ed63ece45a0f3a2ca7e0df375cb5bfa3a99cde0386cb4',
      bytes: 175,
    },
    {
      path: 'package.json',
      content: `{
  "name": "esbuild",
  "version": "0.28.0",
  "main": "./lib/main.cjs",
  "module": "./lib/main.cjs",
  "type": "commonjs",
  "bin": {
    "esbuild": "./bin/esbuild"
  },
  "exports": {
    ".": {
      "import": "./lib/main.cjs",
      "require": "./lib/main.cjs",
      "default": "./lib/main.cjs"
    }
  }
}`,
      sha256: '6ea61c374d8c8681e86b0e950c4c87dea840996284709d35af7e799169e064ab',
      bytes: 313,
    },
  ],
} as const;

const LIGHTNING_RECIPE = {
  id: 'rifty.shadow-substitution.lightningcss.v2',
  digest: '1800acdcf6efc1eb97de67a1fa4bb27d7f0c77c583b270644e258543be0dcfc4',
  bin: {},
  files: [
    {
      path: 'index.cjs',
      content: "module.exports = require('lightningcss-wasm');\n",
      sha256: 'e862f01641a1b33713b5c205474ffb23379b4e66affdf08680fe4c00faf56e20',
      bytes: 47,
    },
    {
      path: 'index.mjs',
      content: `export {
  Features,
  browserslistToTargets,
  bundle,
  bundleAsync,
  composeVisitors,
  transform,
  transformStyleAttribute,
} from 'lightningcss-wasm';

import * as lightningcss from 'lightningcss-wasm';
export default lightningcss;
`,
      sha256: '1be16085d6c090f58b459e45b2531616bff8836c3f3d95e363fc36c7ebfdb9cd',
      bytes: 239,
    },
    {
      path: 'package.json',
      content: `{
  "name": "lightningcss",
  "version": "1.32.0",
  "main": "./index.cjs",
  "module": "./index.mjs",
  "type": "module",
  "exports": {
    ".": {
      "import": "./index.mjs",
      "require": "./index.cjs",
      "default": "./index.mjs"
    }
  }
}`,
      sha256: '3ebddaa8830dd3bd37e01a4c798f73d5a493abb737fc24909e906b62fd8acfe1',
      bytes: 254,
    },
  ],
} as const;

const ACQUISITION_DEPENDENCIES = { 'napi-wasm': '^1.0.1' } as const;
const BUNDLE_DEPENDENCIES = ['napi-wasm'] as const;
const BUNDLED_NAPI_MANIFEST = JSON.stringify({ name: 'napi-wasm', version: '1.1.3' });
const BUNDLED_NAPI_INDEX = 'module.exports = "bundled napi-wasm";\n';
const ACQUIRED_BIN = '#!/usr/bin/env node\nthrow new Error("acquired twin leaked");\n';
const ESBUILD_LAUNCHER = "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n";

type Scope = 'root' | 'nested';

interface CachedTarball {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string;
  readonly bytes: Uint8Array;
  readonly files: Readonly<Record<string, string>>;
}

interface ReplayPackageEntry {
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  bundleDependencies?: string[];
  inBundle?: boolean;
  bin?: Record<string, string>;
  riftyShadowRecipe?: string;
}

interface ReplayFact {
  readonly catalog: Readonly<{ id: string; digest: string }>;
  readonly substitutionId: string;
  readonly recipeDigest: string;
  readonly trigger: Readonly<{
    name: string;
    requestedRange: string;
    version: string;
  }>;
  readonly acquisition: Readonly<Record<string, unknown>>;
  materialization: {
    installPath: string;
    name: string;
    version: string;
    bin: Record<string, string>;
    files: Array<{ path: string; sha256: string; bytes: number }>;
  };
  readonly binding?: Readonly<{ adapterId: string; assets: readonly string[] }>;
}

interface ReplayLock {
  readonly name: string;
  readonly version: string;
  readonly lockfileVersion: 3;
  readonly requires: true;
  readonly packages: Record<string, ReplayPackageEntry>;
  readonly rifty: {
    readonly shadowSubstitutions: {
      readonly protocol: 'rifty.shadow-substitutions/v2';
      readonly applied: ReplayFact[];
    };
  };
}

interface ReplayFixture {
  readonly scope: Scope;
  readonly dependencies: Record<string, string>;
  readonly lock: ReplayLock;
  readonly acquisition: CachedTarball;
  readonly acquisitionPath: string;
  readonly aliasPath: string;
  readonly bundledChildPath: string;
  readonly cacheEntries: readonly CachedTarball[];
  readonly expectedCacheGets: readonly string[];
}

type TreeEntry =
  | Readonly<{ kind: 'directory' }>
  | Readonly<{ kind: 'file'; bytes: readonly number[] }>;

class PreseededCache implements TarballCache {
  readonly #entries = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];

  constructor(entries: readonly CachedTarball[]) {
    for (const entry of entries) {
      this.#entries.set(`${entry.name}\0${entry.version}\0${entry.integrity}`, entry.bytes.slice());
    }
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.gets.push(`${name}@${version}`);
    return this.#entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string): Promise<string> {
    this.puts.push(`${name}@${version}`);
    throw new Error(`offline replay attempted cache write for ${name}@${version}`);
  }
}

class DenyAllRegistry extends RegistryClient {
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];

  constructor() {
    super({ baseUrl: '/deny-all', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    throw new Error(`offline replay read registry packument ${name}`);
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads.push(url);
    throw new Error(`offline replay read registry tarball ${url}`);
  }
}

async function tarballFixture(
  name: string,
  version: string,
  manifestFields: Readonly<Record<string, unknown>>,
  extraFiles: Readonly<Record<string, string>> = {},
): Promise<CachedTarball> {
  const files = {
    'package.json': JSON.stringify({ name, version, ...manifestFields }),
    ...extraFiles,
  };
  const chunks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = encoder.encode(content);
    chunks.push(buildHeader(`package/${path}`, bytes.byteLength), padToBlock(bytes));
  }
  const bytes = await gzip(concat(...chunks, TAR_TRAILER));
  return {
    name,
    version,
    resolved: `https://registry.test/${name}-${version}.tgz`,
    integrity: await computeIntegrity(bytes),
    bytes,
    files,
  };
}

function fileFacts(
  files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[],
): Array<{ path: string; sha256: string; bytes: number }> {
  return files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
}

function esbuildFact(): ReplayFact {
  return {
    catalog: { ...CATALOG },
    substitutionId: ESBUILD_RECIPE.id,
    recipeDigest: ESBUILD_RECIPE.digest,
    trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
    acquisition: { kind: 'synthetic' },
    materialization: {
      installPath: 'node_modules/esbuild',
      name: 'esbuild',
      version: '0.28.0',
      bin: { ...ESBUILD_RECIPE.bin },
      files: fileFacts(ESBUILD_RECIPE.files),
    },
    binding: {
      adapterId: 'rifty.runtime-adapter.esbuild.v1',
      assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
    },
  };
}

function lightningFact(source: CachedTarball, installPath: string): ReplayFact {
  return {
    catalog: { ...CATALOG },
    substitutionId: LIGHTNING_RECIPE.id,
    recipeDigest: LIGHTNING_RECIPE.digest,
    trigger: { name: 'lightningcss', requestedRange: '^1.32.0', version: '1.32.0' },
    acquisition: {
      kind: 'registry',
      name: 'lightningcss-wasm',
      version: '1.32.0',
      resolved: source.resolved,
      integrity: source.integrity,
      dependencies: { ...ACQUISITION_DEPENDENCIES },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [...BUNDLE_DEPENDENCIES],
      bundled: [{ name: 'napi-wasm', version: '1.1.3', inBundle: true }],
    },
    materialization: {
      installPath,
      name: 'lightningcss',
      version: '1.32.0',
      bin: { ...LIGHTNING_RECIPE.bin },
      files: fileFacts(LIGHTNING_RECIPE.files),
    },
  };
}

async function replayFixture(scope: Scope): Promise<ReplayFixture> {
  const acquisition = await tarballFixture(
    'lightningcss-wasm',
    '1.32.0',
    {
      dependencies: { ...ACQUISITION_DEPENDENCIES },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [...BUNDLE_DEPENDENCIES],
      bin: { lightningcss: 'bin/acquired.js', 'acquired-only': 'bin/acquired.js' },
    },
    {
      'bin/acquired.js': ACQUIRED_BIN,
      'node_modules/napi-wasm/package.json': BUNDLED_NAPI_MANIFEST,
      'node_modules/napi-wasm/index.js': BUNDLED_NAPI_INDEX,
    },
  );
  const nested = scope === 'nested';
  const host = nested
    ? await tarballFixture(
        'nested-host',
        '1.0.0',
        { dependencies: { lightningcss: '^1.32.0' } },
        { 'index.js': 'module.exports = "nested host";\n' },
      )
    : undefined;
  const occupied = nested
    ? await tarballFixture(
        'lightningcss-wasm',
        '1.32.1',
        { dependencies: {} },
        { 'index.js': 'module.exports = "occupied flat identity";\n' },
      )
    : undefined;
  const acquisitionPath = nested
    ? 'node_modules/nested-host/node_modules/lightningcss-wasm'
    : 'node_modules/lightningcss-wasm';
  const aliasPath = nested
    ? 'node_modules/nested-host/node_modules/lightningcss'
    : 'node_modules/lightningcss';
  const bundledChildPath = `${acquisitionPath}/node_modules/napi-wasm`;
  const dependencies: Record<string, string> = nested
    ? { esbuild: '^0.28.0', 'lightningcss-wasm': '1.32.1', 'nested-host': '1.0.0' }
    : { esbuild: '^0.28.0', lightningcss: '^1.32.0' };
  const packages: Record<string, ReplayPackageEntry> = {
    '': {
      version: '1.0.0',
      dependencies: nested
        ? { esbuild: '0.28.0', 'lightningcss-wasm': '1.32.1', 'nested-host': '1.0.0' }
        : { esbuild: '0.28.0', 'lightningcss-wasm': '1.32.0' },
    },
    'node_modules/esbuild': {
      version: '0.28.0',
      dependencies: {},
      bin: { ...ESBUILD_RECIPE.bin },
      resolved: `rifty:shadow-substitution/${ESBUILD_RECIPE.id}@${ESBUILD_RECIPE.digest}`,
      riftyShadowRecipe: ESBUILD_RECIPE.id,
    },
    [aliasPath]: {
      version: '1.32.0',
      riftyShadowRecipe: LIGHTNING_RECIPE.id,
    },
    [acquisitionPath]: {
      version: '1.32.0',
      dependencies: { ...ACQUISITION_DEPENDENCIES },
      bundleDependencies: [...BUNDLE_DEPENDENCIES],
      resolved: acquisition.resolved,
      integrity: acquisition.integrity,
    },
    [bundledChildPath]: { version: '1.1.3', inBundle: true },
  };
  const cacheEntries: CachedTarball[] = [acquisition];
  if (host && occupied) {
    packages['node_modules/lightningcss-wasm'] = {
      version: occupied.version,
      dependencies: {},
      resolved: occupied.resolved,
      integrity: occupied.integrity,
    };
    packages['node_modules/nested-host'] = {
      version: host.version,
      dependencies: { lightningcss: '^1.32.0' },
      resolved: host.resolved,
      integrity: host.integrity,
    };
    cacheEntries.push(occupied, host);
  }
  return {
    scope,
    dependencies,
    acquisition,
    acquisitionPath,
    aliasPath,
    bundledChildPath,
    cacheEntries,
    expectedCacheGets: cacheEntries.map(({ name, version }) => `${name}@${version}`).sort(),
    lock: {
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages,
      rifty: {
        shadowSubstitutions: {
          protocol: 'rifty.shadow-substitutions/v2',
          applied: [esbuildFact(), lightningFact(acquisition, aliasPath)],
        },
      },
    },
  };
}

async function seedProject(vfs: MemoryVfs, fixture: ReplayFixture, lock = fixture.lock) {
  const lockBytes = JSON.stringify(lock, null, 2);
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: fixture.dependencies }),
  );
  await vfs.writeFile('/project/package-lock.json', lockBytes);
  return encoder.encode(lockBytes);
}

async function snapshotTree(vfs: MemoryVfs, root: string): Promise<Record<string, TreeEntry>> {
  const snapshot: Record<string, TreeEntry> = {};
  const visit = async (path: string, relative: string): Promise<void> => {
    for (const child of await vfs.readdir(path)) {
      const childPath = `${path}/${child.name}`;
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory) {
        snapshot[childRelative] = { kind: 'directory' };
        await visit(childPath, childRelative);
      } else {
        snapshot[childRelative] = {
          kind: 'file',
          bytes: [...(await vfs.readFile(childPath))],
        };
      }
    }
  };
  await visit(root, '');
  return snapshot;
}

async function expectFiles(
  vfs: MemoryVfs,
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    expect.soft(await vfs.readFileText(`${root}/${path}`), `${root}/${path}`).toBe(content);
  }
}

async function expectRecipeFiles(
  vfs: MemoryVfs,
  root: string,
  files: readonly { readonly path: string; readonly content: string }[],
): Promise<void> {
  await expectFiles(
    vfs,
    root,
    Object.fromEntries(files.map(({ path, content }) => [path, content])),
  );
}

async function replayOnce(fixture: ReplayFixture) {
  const vfs = new MemoryVfs();
  const lockBefore = await seedProject(vfs, fixture);
  const registry = new DenyAllRegistry();
  const cache = new PreseededCache(fixture.cacheEntries);
  const reports: string[] = [];
  const result = await install('fixture', '1.0.0', fixture.dependencies, {
    vfs,
    cwd: '/project',
    registry,
    tarballCache: cache,
    onSubstitution: (line) => reports.push(line),
  });
  return { vfs, lockBefore, registry, cache, reports, result };
}

function replayError(error: unknown): {
  readonly code?: unknown;
  readonly reason?: unknown;
  readonly hasCause: boolean;
} {
  return {
    code: error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined,
    reason:
      error !== null && typeof error === 'object' && 'reason' in error ? error.reason : undefined,
    hasCause: error !== null && typeof error === 'object' && Object.hasOwn(error, 'cause'),
  };
}

const replayCorruptions = [
  {
    label: 'acquisition dependencies',
    mutate(lock: ReplayLock, fixture: ReplayFixture): void {
      const entry = lock.packages[fixture.acquisitionPath];
      if (!entry) throw new Error('fixture acquisition lock entry is missing');
      entry.dependencies = { 'napi-wasm': '9.9.9' };
    },
  },
  {
    label: 'acquisition bundleDependencies',
    mutate(lock: ReplayLock, fixture: ReplayFixture): void {
      const entry = lock.packages[fixture.acquisitionPath];
      if (!entry) throw new Error('fixture acquisition lock entry is missing');
      entry.bundleDependencies = [];
    },
  },
  {
    label: 'bundled child version',
    mutate(lock: ReplayLock, fixture: ReplayFixture): void {
      const entry = lock.packages[fixture.bundledChildPath];
      if (!entry) throw new Error('fixture bundled-child lock entry is missing');
      entry.version = '9.9.9';
    },
  },
  {
    label: 'bundled child inBundle',
    mutate(lock: ReplayLock, fixture: ReplayFixture): void {
      const entry = lock.packages[fixture.bundledChildPath];
      if (!entry) throw new Error('fixture bundled-child lock entry is missing');
      entry.inBundle = false;
    },
  },
  {
    label: 'materialization.bin',
    mutate(lock: ReplayLock): void {
      const fact = lock.rifty.shadowSubstitutions.applied.find(
        ({ substitutionId }) => substitutionId === LIGHTNING_RECIPE.id,
      );
      if (!fact) throw new Error('fixture LightningCSS trace fact is missing');
      fact.materialization.bin = { lightningcss: 'bin/forged.js' };
    },
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 replay authority', () => {
  it.each(['root', 'nested'] as const)(
    '[fault: poisoned-cache / provenance-lie] replays the exact %s acquisition, aliases, bins, tree, and raw lock offline',
    async (scope) => {
      const fixture = await replayFixture(scope);
      const first = await replayOnce(fixture);
      const second = await replayOnce(fixture);

      for (const replay of [first, second]) {
        expect.soft(replay.registry.packumentReads, `${scope}: packuments`).toEqual([]);
        expect.soft(replay.registry.tarballReads, `${scope}: registry tarballs`).toEqual([]);
        expect
          .soft(replay.cache.gets.sort(), `${scope}: cache gets`)
          .toEqual(fixture.expectedCacheGets);
        expect.soft(replay.cache.puts, `${scope}: cache puts`).toEqual([]);
        expect
          .soft(replay.cache.gets, `${scope}: bundled child cache`)
          .not.toContain('napi-wasm@1.1.3');
        expect.soft(replay.result.lockfile, `${scope}: returned lock`).toEqual(fixture.lock);
        expect
          .soft(await replay.vfs.readFile('/project/package-lock.json'), `${scope}: raw lock`)
          .toEqual(replay.lockBefore);
        expect
          .soft(replay.reports, `${scope}: esbuild report`)
          .toContain(
            'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
          );
        expect
          .soft(replay.reports, `${scope}: LightningCSS report`)
          .toContain(
            'npm: lightningcss@^1.32.0 materialized from shadow registry (rifty.shadow-substitution.lightningcss.v2)',
          );
        await expectFiles(
          replay.vfs,
          `/project/${fixture.acquisitionPath}`,
          fixture.acquisition.files,
        );
        await expectRecipeFiles(
          replay.vfs,
          `/project/${fixture.aliasPath}`,
          LIGHTNING_RECIPE.files,
        );
        await expectRecipeFiles(replay.vfs, '/project/node_modules/esbuild', ESBUILD_RECIPE.files);
        expect
          .soft(await replay.vfs.readFileText('/project/node_modules/.bin/esbuild'))
          .toBe(ESBUILD_LAUNCHER);
        await expect
          .soft(replay.vfs.exists('/project/node_modules/napi-wasm'))
          .resolves.toBe(false);
        await expect
          .soft(replay.vfs.exists('/project/node_modules/.bin/lightningcss'))
          .resolves.toBe(false);
        await expect
          .soft(replay.vfs.exists('/project/node_modules/.bin/acquired-only'))
          .resolves.toBe(false);
      }

      expect(await snapshotTree(second.vfs, '/project/node_modules')).toEqual(
        await snapshotTree(first.vfs, '/project/node_modules'),
      );
    },
  );

  it.each(
    (['root', 'nested'] as const).flatMap((scope) =>
      replayCorruptions.map((corruption) => ({ scope, corruption })),
    ),
  )(
    '[fault: corrupt-input / observable-order] rejects $scope $corruption.label drift before registry, cache, VFS, report, or lock effects',
    async ({ scope, corruption }) => {
      const fixture = await replayFixture(scope);
      const lock = structuredClone(fixture.lock);
      corruption.mutate(lock, fixture);
      const vfs = new MemoryVfs();
      const lockBefore = await seedProject(vfs, fixture, lock);
      const registry = new DenyAllRegistry();
      const cache = new PreseededCache(fixture.cacheEntries);
      const reports: string[] = [];
      const mutators = [
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      const outcome = await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry,
        tarballCache: cache,
        onSubstitution: (line) => reports.push(line),
      }).then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );

      expect.soft(outcome.status, `${scope} ${corruption.label}: outcome`).toBe('rejected');
      const error = outcome.status === 'rejected' ? outcome.error : undefined;
      expect.soft(replayError(error), `${scope} ${corruption.label}: rejection`).toEqual({
        code: 'EBROKENLOCK',
        reason: 'shadow-trace-drift',
        hasCause: false,
      });
      expect.soft(registry.packumentReads, `${scope} ${corruption.label}: packuments`).toEqual([]);
      expect.soft(registry.tarballReads, `${scope} ${corruption.label}: tarballs`).toEqual([]);
      expect.soft(cache.gets, `${scope} ${corruption.label}: cache gets`).toEqual([]);
      expect.soft(cache.puts, `${scope} ${corruption.label}: cache puts`).toEqual([]);
      expect.soft(reports, `${scope} ${corruption.label}: reports`).toEqual([]);
      for (const mutator of mutators) {
        expect
          .soft(mutator, `${scope} ${corruption.label}: ${mutator.getMockName()}`)
          .not.toHaveBeenCalled();
      }
      expect
        .soft(
          await vfs.readFile('/project/package-lock.json'),
          `${scope} ${corruption.label}: lock`,
        )
        .toEqual(lockBefore);
      await expect
        .soft(vfs.exists('/project/node_modules'), `${scope} ${corruption.label}: tree`)
        .resolves.toBe(false);
    },
  );
});
