import { createHash } from 'node:crypto';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED,
  BUNDLED_VERSION,
  LedgerCache,
  LedgerRegistry,
  REAL_FILES,
  type RegistryEntry,
  SOURCE,
  SOURCE_INTEGRITY,
  SOURCE_URL,
  SOURCE_VERSION,
  scopeDependencies,
  scopeEntries,
} from './_test-fixtures/shadow-recipe-v2-embedded-source.ts';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { planShadowSubstitutionsFromLockfile } from './internal/shadow/planner.ts';
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
const BUNDLED_NAPI_INDEX = 'module.exports = "bundled napi-wasm";\n';
const ESBUILD_LAUNCHER = "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n";

type Scope = 'root' | 'nested';

interface CachedTarball {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string;
  readonly bytes: Uint8Array;
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
  readonly entries: readonly RegistryEntry[];
  readonly expectedCacheGets: readonly string[];
}

type TreeEntry =
  | Readonly<{ kind: 'directory' }>
  | Readonly<{ kind: 'file'; bytes: readonly number[] }>;

function cacheReadKey(entry: Pick<CachedTarball, 'integrity' | 'name' | 'version'>): string {
  return `${entry.name}\0${entry.version}\0${entry.integrity}`;
}

class PreseededCache implements TarballCache {
  readonly #entries = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];

  constructor(entries: readonly CachedTarball[]) {
    for (const entry of entries) {
      this.#entries.set(`${entry.name}\0${entry.version}\0${entry.integrity}`, entry.bytes.slice());
    }
  }

  delete(entry: CachedTarball): void {
    this.#entries.delete(`${entry.name}\0${entry.version}\0${entry.integrity}`);
  }

  replace(entry: CachedTarball, bytes: Uint8Array): void {
    this.#entries.set(`${entry.name}\0${entry.version}\0${entry.integrity}`, bytes.slice());
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.gets.push(cacheReadKey({ name, version, integrity }));
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
  };
}

function cachedTarball(entry: RegistryEntry): CachedTarball {
  const integrity = entry.manifest.dist.integrity;
  if (!integrity)
    throw new Error(`${entry.manifest.name}@${entry.manifest.version} lacks integrity`);
  return {
    name: entry.manifest.name,
    version: entry.manifest.version,
    resolved: entry.manifest.dist.tarball,
    integrity,
    bytes: entry.tarball,
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
  const entries = await scopeEntries(scope);
  const sourceEntry = entries.find(
    ({ manifest }) => manifest.name === SOURCE && manifest.version === SOURCE_VERSION,
  );
  if (!sourceEntry) throw new Error(`fixture lacks ${SOURCE}@${SOURCE_VERSION}`);
  const acquisition = cachedTarball(sourceEntry);
  if (acquisition.resolved !== SOURCE_URL || acquisition.integrity !== SOURCE_INTEGRITY) {
    throw new Error('fixture official source identity drifted');
  }
  const nested = scope === 'nested';
  const hostEntry = entries.find(({ manifest }) => manifest.name === 'nested-host');
  const occupiedEntry = entries.find(
    ({ manifest }) => manifest.name === SOURCE && manifest.version === '1.32.1',
  );
  const host = hostEntry ? cachedTarball(hostEntry) : undefined;
  const occupied = occupiedEntry ? cachedTarball(occupiedEntry) : undefined;
  if (nested && (!host || !occupied)) throw new Error('fixture lacks nested ordinary sources');
  const acquisitionPath = nested
    ? 'node_modules/nested-host/node_modules/lightningcss-wasm'
    : 'node_modules/lightningcss-wasm';
  const aliasPath = nested
    ? 'node_modules/nested-host/node_modules/lightningcss'
    : 'node_modules/lightningcss';
  const bundledChildPath = `${acquisitionPath}/node_modules/napi-wasm`;
  const dependencies: Record<string, string> = {
    esbuild: '^0.28.0',
    ...scopeDependencies(scope),
  };
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
  const expectedReadEntries =
    nested && occupied && host ? [occupied, host, acquisition] : [acquisition];
  return {
    scope,
    dependencies,
    acquisition,
    acquisitionPath,
    aliasPath,
    bundledChildPath,
    cacheEntries,
    entries,
    expectedCacheGets: expectedReadEntries.map(cacheReadKey),
    lock: {
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages,
      rifty: {
        shadowSubstitutions: {
          protocol: 'rifty.shadow-substitutions/v2',
          applied: [lightningFact(acquisition, aliasPath), esbuildFact()],
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

async function freshOnce(fixture: ReplayFixture) {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: fixture.dependencies }),
  );
  const registry = new LedgerRegistry(fixture.entries);
  const cache = new LedgerCache();
  const reports: string[] = [];
  const result = await install('fixture', '1.0.0', fixture.dependencies, {
    vfs,
    cwd: '/project',
    registry,
    tarballCache: cache,
    onSubstitution: (line) => reports.push(line),
  });
  return { vfs, reports, result };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function expectOfficialSource(vfs: MemoryVfs, root: string): Promise<void> {
  for (const file of REAL_FILES) {
    const bytes = await vfs.readFile(`${root}/${file.path}`);
    expect.soft(bytes.byteLength, `${root}/${file.path}: bytes`).toBe(file.bytes);
    expect.soft(sha256(bytes), `${root}/${file.path}: sha256`).toBe(file.sha256);
  }
}

function replayError(error: unknown): {
  readonly code?: unknown;
  readonly reason?: unknown;
} {
  return {
    code: error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined,
    reason:
      error !== null && typeof error === 'object' && 'reason' in error ? error.reason : undefined,
  };
}

async function expectReplayFailureBeforePublication(
  fixture: ReplayFixture,
  lock: ReplayLock,
  cache: PreseededCache,
  label: string,
  expectedCacheGets: readonly string[],
): Promise<void> {
  const vfs = new MemoryVfs();
  const lockBefore = await seedProject(vfs, fixture, lock);
  const registry = new DenyAllRegistry();
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

  expect.soft(outcome.status, `${label}: outcome`).toBe('rejected');
  const error = outcome.status === 'rejected' ? outcome.error : undefined;
  expect.soft(replayError(error), `${label}: rejection`).toEqual({
    code: 'EBROKENLOCK',
    reason: 'shadow-trace-drift',
  });
  expect.soft(registry.packumentReads, `${label}: packuments`).toEqual([]);
  expect.soft(registry.tarballReads, `${label}: tarballs`).toEqual([]);
  expect.soft(cache.gets, `${label}: cache gets`).toEqual(expectedCacheGets);
  expect.soft(cache.puts, `${label}: cache puts`).toEqual([]);
  expect.soft(reports, `${label}: reports`).toEqual([]);
  for (const mutator of mutators) {
    expect.soft(mutator, `${label}: ${mutator.getMockName()}`).not.toHaveBeenCalled();
  }
  expect
    .soft(await vfs.readFile('/project/package-lock.json'), `${label}: lock`)
    .toEqual(lockBefore);
  await expect.soft(vfs.exists('/project/node_modules'), `${label}: tree`).resolves.toBe(false);
}

function lightningTraceFact(lock: ReplayLock): ReplayFact {
  const fact = lock.rifty.shadowSubstitutions.applied.find(
    ({ substitutionId }) => substitutionId === LIGHTNING_RECIPE.id,
  );
  if (!fact) throw new Error('fixture LightningCSS trace fact is missing');
  return fact;
}

function registryTraceAcquisition(lock: ReplayLock): Record<string, unknown> {
  const acquisition = lightningTraceFact(lock).acquisition;
  if (acquisition.kind !== 'registry') {
    throw new Error('fixture LightningCSS trace acquisition is not registry-backed');
  }
  return acquisition as Record<string, unknown>;
}

function traceFactRecord(lock: ReplayLock): Record<string, unknown> {
  return lightningTraceFact(lock) as unknown as Record<string, unknown>;
}

function materializationTrace(lock: ReplayLock): Record<string, unknown> {
  return lightningTraceFact(lock).materialization as unknown as Record<string, unknown>;
}

function bundledTraceFacts(lock: ReplayLock): unknown[] {
  const bundled = registryTraceAcquisition(lock).bundled;
  if (!Array.isArray(bundled)) throw new Error('fixture LightningCSS bundled facts are malformed');
  return bundled;
}

function firstBundledTraceFact(lock: ReplayLock): Record<string, unknown> {
  const bundled = bundledTraceFacts(lock);
  if (bundled.length !== 1) {
    throw new Error('fixture LightningCSS trace bundled facts are missing');
  }
  const first: unknown = bundled[0];
  if (first === null || typeof first !== 'object') {
    throw new Error('fixture LightningCSS bundled fact is malformed');
  }
  return first as Record<string, unknown>;
}

function firstMaterializationFile(lock: ReplayLock): Record<string, unknown> {
  const files = lightningTraceFact(lock).materialization.files;
  const first = files[0];
  if (!first) throw new Error('fixture LightningCSS materialization file is missing');
  return first as unknown as Record<string, unknown>;
}

const replayCorruptions = [
  {
    label: 'lock acquisition dependencies',
    mutate(lock: ReplayLock, fixture: ReplayFixture): void {
      const entry = lock.packages[fixture.acquisitionPath];
      if (!entry) throw new Error('fixture acquisition lock entry is missing');
      entry.dependencies = { 'napi-wasm': '9.9.9' };
    },
  },
  {
    label: 'lock acquisition bundleDependencies',
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
    label: 'trace acquisition dependencies',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).dependencies = { 'napi-wasm': '9.9.9' };
    },
  },
  {
    label: 'trace acquisition optionalDependencies',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).optionalDependencies = { 'native-optional': '1.0.0' };
    },
  },
  {
    label: 'trace acquisition dependencies malformed',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).dependencies = [];
    },
  },
  {
    label: 'trace acquisition optionalDependencies missing',
    mutate(lock: ReplayLock): void {
      Reflect.deleteProperty(registryTraceAcquisition(lock), 'optionalDependencies');
    },
  },
  {
    label: 'trace acquisition extra field',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).unexpected = true;
    },
  },
  {
    label: 'trace acquisition peerDependencies',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).peerDependencies = { 'peer-api': '^2.0.0' };
    },
  },
  {
    label: 'trace acquisition bundleDependencies',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).bundleDependencies = [];
    },
  },
  ...(
    [
      ['kind', 'synthetic'],
      ['name', 'forged-source'],
      ['version', '9.9.9'],
      ['resolved', 'https://registry.test/forged-source-1.32.0.tgz'],
      ['integrity', `sha512-${'A'.repeat(86)}==`],
    ] as const
  ).map(([field, value]) => ({
    label: `trace acquisition ${field}`,
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock)[field] = value;
    },
  })),
  {
    label: 'trace acquisition missing',
    mutate(lock: ReplayLock): void {
      Reflect.deleteProperty(traceFactRecord(lock), 'acquisition');
    },
  },
  {
    label: 'trace acquisition malformed',
    mutate(lock: ReplayLock): void {
      traceFactRecord(lock).acquisition = [];
    },
  },
  {
    label: 'trace bundled child version',
    mutate(lock: ReplayLock): void {
      firstBundledTraceFact(lock).version = '9.9.9';
    },
  },
  {
    label: 'trace bundled child inBundle',
    mutate(lock: ReplayLock): void {
      firstBundledTraceFact(lock).inBundle = false;
    },
  },
  {
    label: 'trace bundled child name',
    mutate(lock: ReplayLock): void {
      firstBundledTraceFact(lock).name = 'forged-napi-wasm';
    },
  },
  {
    label: 'trace bundled missing',
    mutate(lock: ReplayLock): void {
      Reflect.deleteProperty(registryTraceAcquisition(lock), 'bundled');
    },
  },
  {
    label: 'trace bundled malformed',
    mutate(lock: ReplayLock): void {
      registryTraceAcquisition(lock).bundled = {};
    },
  },
  {
    label: 'trace bundled child malformed',
    mutate(lock: ReplayLock): void {
      bundledTraceFacts(lock)[0] = null;
    },
  },
  {
    label: 'trace bundled extra child',
    mutate(lock: ReplayLock): void {
      bundledTraceFacts(lock).push({ name: 'extra-child', version: '1.0.0', inBundle: true });
    },
  },
  ...(
    [
      ['installPath', 'node_modules/forged-lightningcss'],
      ['name', 'forged-lightningcss'],
      ['version', '9.9.9'],
    ] as const
  ).map(([field, value]) => ({
    label: `materialization.${field}`,
    mutate(lock: ReplayLock): void {
      materializationTrace(lock)[field] = value;
    },
  })),
  {
    label: 'materialization missing',
    mutate(lock: ReplayLock): void {
      Reflect.deleteProperty(traceFactRecord(lock), 'materialization');
    },
  },
  {
    label: 'materialization malformed',
    mutate(lock: ReplayLock): void {
      traceFactRecord(lock).materialization = [];
    },
  },
  {
    label: 'materialization.files',
    mutate(lock: ReplayLock): void {
      const first = lightningTraceFact(lock).materialization.files[0];
      if (!first) throw new Error('fixture LightningCSS materialization file is missing');
      first.sha256 = '0'.repeat(64);
    },
  },
  {
    label: 'materialization file path',
    mutate(lock: ReplayLock): void {
      firstMaterializationFile(lock).path = 'forged.cjs';
    },
  },
  {
    label: 'materialization file bytes',
    mutate(lock: ReplayLock): void {
      firstMaterializationFile(lock).bytes = 9_999;
    },
  },
  {
    label: 'materialization files missing',
    mutate(lock: ReplayLock): void {
      Reflect.deleteProperty(materializationTrace(lock), 'files');
    },
  },
  {
    label: 'materialization files malformed',
    mutate(lock: ReplayLock): void {
      materializationTrace(lock).files = {};
    },
  },
  {
    label: 'materialization.bin',
    mutate(lock: ReplayLock): void {
      lightningTraceFact(lock).materialization.bin = { lightningcss: 'bin/forged.js' };
    },
  },
  {
    label: 'materialization.bin missing',
    mutate(lock: ReplayLock): void {
      Reflect.deleteProperty(lightningTraceFact(lock).materialization, 'bin');
    },
  },
  {
    label: 'materialization.bin malformed',
    mutate(lock: ReplayLock): void {
      materializationTrace(lock).bin = [];
    },
  },
  {
    label: 'materialization extra field',
    mutate(lock: ReplayLock): void {
      (lightningTraceFact(lock).materialization as Record<string, unknown>).unexpected = true;
    },
  },
] as const;

async function substitutedSource(childManifest: string | undefined): Promise<CachedTarball> {
  return tarballFixture(
    SOURCE,
    SOURCE_VERSION,
    {
      dependencies: { ...ACQUISITION_DEPENDENCIES },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [...BUNDLE_DEPENDENCIES],
    },
    {
      ...(childManifest === undefined
        ? {}
        : { [`node_modules/${BUNDLED}/package.json`]: childManifest }),
      [`node_modules/${BUNDLED}/index.js`]: BUNDLED_NAPI_INDEX,
    },
  );
}

function adoptSubstitutedSource(
  fixture: ReplayFixture,
  source: CachedTarball,
): Readonly<{ lock: ReplayLock; cache: PreseededCache; expectedCacheGets: readonly string[] }> {
  const lock = structuredClone(fixture.lock);
  const entry = lock.packages[fixture.acquisitionPath];
  if (!entry) throw new Error('fixture acquisition lock entry is missing');
  entry.resolved = source.resolved;
  entry.integrity = source.integrity;
  const acquisition = registryTraceAcquisition(lock);
  acquisition.resolved = source.resolved;
  acquisition.integrity = source.integrity;
  const cache = new PreseededCache(fixture.cacheEntries);
  cache.replace(source, source.bytes);
  const originalKey = cacheReadKey(fixture.acquisition);
  return {
    lock,
    cache,
    expectedCacheGets: fixture.expectedCacheGets.map((key) =>
      key === originalKey ? cacheReadKey(source) : key,
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 replay authority', () => {
  it.each(['root', 'nested'] as const)(
    '[fault: poisoned-cache / provenance-lie] replays the exact %s acquisition, aliases, bins, tree, and raw lock offline',
    async (scope) => {
      const fixture = await replayFixture(scope);
      const fresh = await freshOnce(fixture);
      const first = await replayOnce(fixture);
      const second = await replayOnce(fixture);

      expect
        .soft(fresh.result.lockfile, `${scope}: literal lock equals fresh lock`)
        .toEqual(fixture.lock);
      for (const replay of [first, second]) {
        expect.soft(replay.registry.packumentReads, `${scope}: packuments`).toEqual([]);
        expect.soft(replay.registry.tarballReads, `${scope}: registry tarballs`).toEqual([]);
        expect.soft(replay.cache.gets, `${scope}: cache gets`).toEqual(fixture.expectedCacheGets);
        expect.soft(replay.cache.puts, `${scope}: cache puts`).toEqual([]);
        expect
          .soft(
            replay.cache.gets.some((key) => key.startsWith(`${BUNDLED}\0${BUNDLED_VERSION}\0`)),
            `${scope}: bundled child cache`,
          )
          .toBe(false);
        expect.soft(replay.result.lockfile, `${scope}: returned lock`).toEqual(fixture.lock);
        expect
          .soft(await replay.vfs.readFile('/project/package-lock.json'), `${scope}: raw lock`)
          .toEqual(replay.lockBefore);
        expect.soft(replay.reports, `${scope}: exact reports`).toEqual(fresh.reports);
        await expectOfficialSource(replay.vfs, `/project/${fixture.acquisitionPath}`);
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

      const freshTree = await snapshotTree(fresh.vfs, '/project/node_modules');
      expect(await snapshotTree(first.vfs, '/project/node_modules')).toEqual(freshTree);
      expect(await snapshotTree(second.vfs, '/project/node_modules')).toEqual(freshTree);
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
      expect(() =>
        planShadowSubstitutionsFromLockfile(structuredClone(fixture.lock)),
      ).not.toThrow();
      const lock = structuredClone(fixture.lock);
      corruption.mutate(lock, fixture);
      const cache = new PreseededCache(fixture.cacheEntries);
      await expectReplayFailureBeforePublication(
        fixture,
        lock,
        cache,
        `${scope} ${corruption.label}`,
        [],
      );
    },
  );

  it.each(
    (['root', 'nested'] as const).flatMap((scope) =>
      (['missing', 'corrupt'] as const).map((fault) => ({ scope, fault })),
    ),
  )(
    '[fault: poisoned-cache / observable-order] rejects $scope $fault pinned parent bytes without registry fallback',
    async ({ scope, fault }) => {
      const fixture = await replayFixture(scope);
      expect(() =>
        planShadowSubstitutionsFromLockfile(structuredClone(fixture.lock)),
      ).not.toThrow();
      const cache = new PreseededCache(fixture.cacheEntries);
      if (fault === 'missing') {
        cache.delete(fixture.acquisition);
      } else {
        const bytes = fixture.acquisition.bytes.slice();
        bytes[0] = (bytes[0] ?? 0) ^ 0xff;
        expect(await computeIntegrity(bytes)).not.toBe(fixture.acquisition.integrity);
        cache.replace(fixture.acquisition, bytes);
      }
      await expectReplayFailureBeforePublication(
        fixture,
        structuredClone(fixture.lock),
        cache,
        `${scope} ${fault} parent`,
        fixture.expectedCacheGets,
      );
    },
  );

  it.each(
    (['root', 'nested'] as const).flatMap((scope) => [
      { scope, label: 'missing manifest', childManifest: undefined },
      { scope, label: 'malformed manifest', childManifest: '{' },
      {
        scope,
        label: 'wrong child name',
        childManifest: JSON.stringify({ name: 'forged-napi-wasm', version: BUNDLED_VERSION }),
      },
      {
        scope,
        label: 'exact child version drift',
        childManifest: JSON.stringify({ name: BUNDLED, version: '1.1.4' }),
      },
      {
        scope,
        label: 'child range drift',
        childManifest: JSON.stringify({ name: BUNDLED, version: '2.0.0' }),
      },
    ]),
  )(
    '[fault: poisoned-cache / provenance-lie] rejects $scope substituted parent with $label before publication',
    async ({ scope, label, childManifest }) => {
      const fixture = await replayFixture(scope);
      const source = await substitutedSource(childManifest);
      expect(source.integrity).not.toBe(fixture.acquisition.integrity);
      const substituted = adoptSubstitutedSource(fixture, source);
      expect(() =>
        planShadowSubstitutionsFromLockfile(structuredClone(substituted.lock)),
      ).not.toThrow();
      await expectReplayFailureBeforePublication(
        fixture,
        substituted.lock,
        substituted.cache,
        `${scope} ${label}`,
        substituted.expectedCacheGets,
      );
    },
  );
});
