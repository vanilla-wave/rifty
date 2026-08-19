import { createHash } from 'node:crypto';
import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DenyAllRegistry,
  type FixtureManifest,
  LedgerTarballCache,
  type OneShotTarballFault,
  type RegistryEntry,
  SASS_OMITTED_OPTIONAL_DEPENDENCIES,
  SASS_RECIPE_ID,
  SASS_REQUIRED_DEPENDENCIES,
  SASS_SOURCE,
  SASS_SOURCE_INTEGRITY,
  SASS_SOURCE_URL,
  SASS_SOURCE_VERSION,
  SASS_TRIGGER,
  SASS_TRIGGER_VERSION,
  SassFixtureRegistry,
  auxiliaryRegistryEntry,
  loadOfficialSassEntries,
  officialArchiveFiles,
} from './_test-fixtures/sass-embedded-substitution.ts';
import { closureHashOf } from './closure-hash.ts';
import { EDDY_BUNDLE_FORMAT, packEddyBundle } from './eddy-bundle.ts';
import { type InstallOptions, type InstallResult, install } from './installer.ts';
import { shadowAssetPlanForInstallResult } from './internal/shadow/install-result.ts';
import type { Lockfile } from './linker.ts';
import { computeIntegrity } from './tarball-cache.ts';

// Full official-archive tree/retry rows reach 40 s under shared CI contention.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = '/project';
const SASS_ACQUISITION_FEATURE = 'sass-embedded.acquisition';
const SASS_VERSION_FEATURE = 'sass-embedded.version';
const SASS_CJS = 'dist/lib/index.js';
const SASS_ESM = 'dist/lib/index.mjs';
const SASS_BIN = 'dist/bin/sass.js';
const EXPECTED_REQUIRED_VERSIONS = Object.freeze({
  chokidar: '5.0.0',
  immutable: '5.1.9',
  readdirp: '5.1.1',
  'source-map-js': '1.2.1',
});

type Scope = 'root' | 'nested';

interface ScopeFixture {
  readonly aliasPath: string;
  readonly binPath: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly entries: readonly RegistryEntry[];
  readonly sourcePath: string;
}

interface SeededInstall extends ScopeFixture {
  readonly cache: LedgerTarballCache;
  readonly lockBytes: Uint8Array;
  readonly registry: SassFixtureRegistry;
  readonly reports: readonly string[];
  readonly result: InstallResult;
  readonly vfs: MemoryVfs;
}

interface MutableProjection {
  bundleDependencies: string[];
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

interface ProjectionDrift {
  readonly label: string;
  readonly mutate: (projection: MutableProjection) => void;
}

interface ReplayInjection {
  readonly label: string;
  readonly mutate: (lock: Lockfile, fixture: ScopeFixture, watcher: RegistryEntry) => void;
}

type TreeEntry =
  | Readonly<{ readonly kind: 'directory' }>
  | Readonly<{ readonly bytes: number; readonly kind: 'file'; readonly sha256: string }>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorRecord(error: unknown): Readonly<Record<string, unknown>> {
  return error !== null && typeof error === 'object'
    ? (error as Readonly<Record<string, unknown>>)
    : {};
}

async function settled<T>(operation: Promise<T>) {
  return await operation.then(
    (value) => ({ kind: 'resolved' as const, value }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  );
}

function requireSassRecipe() {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.id === SASS_RECIPE_ID,
  );
  expect(recipe, 'builtin exact Sass registry recipe').toBeDefined();
  if (!recipe || recipe.acquisition.kind !== 'registry') {
    throw new Error('builtin exact Sass registry recipe is missing');
  }
  return recipe;
}

async function scopeFixture(scope: Scope): Promise<ScopeFixture> {
  const official = await loadOfficialSassEntries();
  if (scope === 'root') {
    return {
      aliasPath: `node_modules/${SASS_TRIGGER}`,
      binPath: 'node_modules/.bin/sass',
      dependencies: { [SASS_TRIGGER]: SASS_TRIGGER_VERSION },
      entries: official,
      sourcePath: `node_modules/${SASS_SOURCE}`,
    };
  }

  const occupiedSource = await auxiliaryRegistryEntry(SASS_SOURCE, '1.100.1');
  const nestedHost = await auxiliaryRegistryEntry('nested-host', '1.0.0', {
    [SASS_TRIGGER]: SASS_TRIGGER_VERSION,
  });
  return {
    aliasPath: `node_modules/nested-host/node_modules/${SASS_TRIGGER}`,
    binPath: 'node_modules/nested-host/node_modules/.bin/sass',
    dependencies: { [SASS_SOURCE]: '1.100.1', 'nested-host': '1.0.0' },
    entries: [...official, occupiedSource, nestedHost],
    sourcePath: `node_modules/nested-host/node_modules/${SASS_SOURCE}`,
  };
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  return vfs;
}

async function installFixture(
  fixture: Pick<ScopeFixture, 'dependencies'>,
  vfs: MemoryVfs,
  registry: InstallOptions['registry'],
  cache: LedgerTarballCache,
  reports: string[],
  signal?: AbortSignal,
  resolverUrl?: string,
): Promise<InstallResult> {
  if (!registry) throw new Error('Sass contract registry is missing');
  return await install(
    'sass-contract',
    '1.0.0',
    { ...fixture.dependencies },
    {
      vfs,
      cwd: ROOT,
      registry,
      tarballCache: cache,
      ...(signal === undefined ? {} : { signal }),
      ...(resolverUrl === undefined ? {} : { resolverUrl }),
      onSubstitution: (line) => reports.push(line),
    },
  );
}

async function writeLock(vfs: MemoryVfs, lockfile: Lockfile): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(lockfile, null, 2));
  await vfs.writeFile(`${ROOT}/package-lock.json`, bytes);
  return bytes;
}

function officialSource(entries: readonly RegistryEntry[]): RegistryEntry {
  const source = entries.find(
    ({ manifest }) => manifest.name === SASS_SOURCE && manifest.version === SASS_SOURCE_VERSION,
  );
  if (!source) throw new Error('official Sass source fixture is missing');
  return source;
}

function requiredEntry(entries: readonly RegistryEntry[], name: string): RegistryEntry {
  const entry = entries.find(({ manifest }) => manifest.name === name);
  if (!entry) throw new Error(`official Sass closure fixture ${name} is missing`);
  return entry;
}

function officialInstalledEntries(fixture: ScopeFixture): readonly RegistryEntry[] {
  return [
    officialSource(fixture.entries),
    ...Object.keys(EXPECTED_REQUIRED_VERSIONS).map((name) => requiredEntry(fixture.entries, name)),
  ];
}

function identity(entry: RegistryEntry): string {
  return `${entry.manifest.name}@${entry.manifest.version}`;
}

function cacheEvent(entry: RegistryEntry): string {
  return `${identity(entry)} ${entry.manifest.dist.integrity}`;
}

function exactMultiset(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  expect.soft([...actual].sort(), label).toEqual([...expected].sort());
  expect.soft(actual, `${label}: duplicate count`).toHaveLength(expected.length);
}

function expectedReports(): readonly string[] {
  return [
    `npm: ${SASS_TRIGGER}@${SASS_TRIGGER_VERSION} → ${SASS_SOURCE}@${SASS_SOURCE_VERSION} (substituted from shadow registry, ADR-0051)`,
    `npm: ${SASS_TRIGGER}@${SASS_TRIGGER_VERSION} materialized from shadow registry (${SASS_RECIPE_ID})`,
  ];
}

function expectNoForbiddenPackageProbe(events: readonly string[], label: string): void {
  expect
    .soft(
      events.filter(
        (event) => /sass-embedded(?:-|@|$)/i.test(event) || event.includes('@parcel/watcher'),
      ),
      label,
    )
    .toEqual([]);
}

function expectFreshLedgers(fixture: ScopeFixture, seeded: SeededInstall): void {
  const tarballs = fixture.entries.map(({ manifest }) => manifest.dist.tarball);
  const cacheEvents = fixture.entries.map(cacheEvent);
  const packageNames = [...new Set(fixture.entries.map(({ manifest }) => manifest.name))];
  exactMultiset(seeded.registry.packumentReads, packageNames, 'fresh packument ledger');
  exactMultiset(seeded.registry.tarballReads, tarballs, 'fresh tarball ledger');
  exactMultiset(seeded.cache.gets, cacheEvents, 'fresh cache-read ledger');
  exactMultiset(seeded.cache.puts, cacheEvents, 'fresh cache-write ledger');
  expectNoForbiddenPackageProbe(
    [
      ...seeded.registry.packumentReads,
      ...seeded.registry.tarballReads,
      ...seeded.cache.gets,
      ...seeded.cache.puts,
    ],
    'fresh forbidden package probes',
  );
  expect.soft(seeded.reports, 'fresh exact reports').toEqual(expectedReports());
}

function expectReplayLedgers(
  fixture: ScopeFixture,
  registry: DenyAllRegistry,
  cache: LedgerTarballCache,
  reports: readonly string[],
): void {
  const cacheEvents = fixture.entries.map(cacheEvent);
  expect.soft(registry.reads, 'replay registry ledger').toEqual([]);
  exactMultiset(cache.gets, cacheEvents, 'replay cache-read ledger');
  expect.soft(cache.puts, 'replay cache-write ledger').toEqual([]);
  expectNoForbiddenPackageProbe([...registry.reads, ...cache.gets, ...cache.puts], 'replay probes');
  expect.soft(reports, 'replay exact reports').toEqual(expectedReports());
}

function expectEddyLedgers(
  fixture: ScopeFixture,
  registry: DenyAllRegistry,
  cache: LedgerTarballCache,
  reports: readonly string[],
): void {
  const cacheEvents = fixture.entries.map(cacheEvent);
  expect.soft(registry.reads, 'Eddy registry ledger').toEqual([]);
  exactMultiset(cache.gets, [...cacheEvents, ...cacheEvents], 'Eddy cache-read ledger');
  exactMultiset(cache.puts, cacheEvents, 'Eddy cache-write ledger');
  expectNoForbiddenPackageProbe([...registry.reads, ...cache.gets, ...cache.puts], 'Eddy probes');
  expect.soft(reports, 'Eddy exact reports').toEqual(expectedReports());
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
        const bytes = await vfs.readFile(childPath);
        snapshot[childRelative] = {
          kind: 'file',
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
        };
      }
    }
  };
  await visit(root, '');
  return snapshot;
}

async function snapshotFiles(vfs: MemoryVfs, root: string): Promise<Record<string, Uint8Array>> {
  const snapshot: Record<string, Uint8Array> = {};
  const visit = async (path: string, relative: string): Promise<void> => {
    for (const child of await vfs.readdir(path)) {
      const childPath = `${path}/${child.name}`;
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory) await visit(childPath, childRelative);
      else snapshot[childRelative] = await vfs.readFile(childPath);
    }
  };
  await visit(root, '');
  return snapshot;
}

async function expectOfficialArchiveTrees(fixture: ScopeFixture, vfs: MemoryVfs): Promise<void> {
  for (const entry of officialInstalledEntries(fixture)) {
    const installPath =
      entry.manifest.name === SASS_SOURCE
        ? fixture.sourcePath
        : `node_modules/${entry.manifest.name}`;
    const expected = officialArchiveFiles(entry);
    const actual = await snapshotFiles(vfs, `${ROOT}/${installPath}`);
    expect
      .soft(Object.keys(actual).sort(), `${identity(entry)} complete official file set`)
      .toEqual(Object.keys(expected).sort());
    for (const [path, bytes] of Object.entries(expected)) {
      expect.soft(actual[path], `${identity(entry)}:${path}`).toEqual(bytes);
    }
  }
}

function expectedRegistryLockEntry(entry: RegistryEntry): Lockfile['packages'][string] {
  return {
    version: entry.manifest.version,
    resolved: entry.manifest.dist.tarball,
    integrity: entry.manifest.dist.integrity,
    dependencies: { ...(entry.manifest.dependencies ?? {}) },
  };
}

function entryInstallPath(fixture: ScopeFixture, entry: RegistryEntry): string {
  return entry.manifest.name === SASS_SOURCE && entry.manifest.version === SASS_SOURCE_VERSION
    ? fixture.sourcePath
    : `node_modules/${entry.manifest.name}`;
}

function expectedLockPackages(fixture: ScopeFixture): Lockfile['packages'] {
  const packages: Lockfile['packages'] = {};
  for (const entry of fixture.entries) {
    const installPath = entryInstallPath(fixture, entry);
    packages[installPath] = expectedRegistryLockEntry(entry);
  }
  packages[''] = {
    version: '1.0.0',
    dependencies: { ...fixture.dependencies },
  };
  packages[fixture.aliasPath] = {
    version: SASS_TRIGGER_VERSION,
    bin: { sass: SASS_BIN },
    riftyShadowRecipe: SASS_RECIPE_ID,
  };
  return packages;
}

function fileFact(bytes: Uint8Array): Extract<TreeEntry, { readonly kind: 'file' }> {
  return { kind: 'file', bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function addExpectedFile(
  snapshot: Record<string, TreeEntry>,
  path: string,
  bytes: Uint8Array,
): void {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const directory = parts.slice(0, index).join('/');
    if (snapshot[directory]?.kind === 'file') {
      throw new Error(`Sass expected tree collides at ${directory}`);
    }
    snapshot[directory] = { kind: 'directory' };
  }
  if (snapshot[path] !== undefined) throw new Error(`Sass expected tree duplicates ${path}`);
  snapshot[path] = fileFact(bytes);
}

function underNodeModules(path: string): string {
  if (!path.startsWith('node_modules/')) throw new Error(`Sass path escapes node_modules: ${path}`);
  return path.slice('node_modules/'.length);
}

function expectedCompleteTree(fixture: ScopeFixture): Record<string, TreeEntry> {
  const snapshot: Record<string, TreeEntry> = {};
  for (const entry of fixture.entries) {
    const root = underNodeModules(entryInstallPath(fixture, entry));
    for (const [path, bytes] of Object.entries(officialArchiveFiles(entry))) {
      addExpectedFile(snapshot, `${root}/${path}`, bytes);
    }
  }

  const recipe = requireSassRecipe();
  const facadeRoot = underNodeModules(fixture.aliasPath);
  for (const file of recipe.materialization.files) {
    const bytes = new TextEncoder().encode(file.content);
    expect.soft(file.bytes, `${file.path} owner byte fact`).toBe(bytes.byteLength);
    expect.soft(file.sha256, `${file.path} owner digest fact`).toBe(sha256(bytes));
    addExpectedFile(snapshot, `${facadeRoot}/${file.path}`, bytes);
  }
  addExpectedFile(
    snapshot,
    underNodeModules(fixture.binPath),
    new TextEncoder().encode(`#!/usr/bin/env node\nimport('../${SASS_TRIGGER}/${SASS_BIN}');\n`),
  );
  return snapshot;
}

async function expectCompleteTree(fixture: ScopeFixture, vfs: MemoryVfs, label: string) {
  expect
    .soft(await snapshotTree(vfs, `${ROOT}/node_modules`), `${label}: exact complete tree`)
    .toEqual(expectedCompleteTree(fixture));
}

async function boundedReach(
  reached: Promise<void>,
  controller: AbortController,
  release: () => void,
  label: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    reached.then(() => 'reached' as const),
    new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => resolve('timeout'), 1_000);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome === 'reached') return;
  controller.abort(new Error(`${label} did not reach its parked boundary`));
  release();
  throw new Error(`${label} did not reach its parked boundary within 1000ms`);
}

async function boundedSettlement<T>(operation: Promise<T>, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    settled(operation),
    new Promise<{ readonly kind: 'timeout' }>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timeout' }), 1_000);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome.kind === 'timeout') throw new Error(`${label} did not settle within 1000ms`);
  return outcome;
}

async function eddyBundleFor(
  lockfile: Lockfile,
  entries: readonly RegistryEntry[],
): Promise<Uint8Array> {
  const byUrl = new Map(entries.map((entry) => [entry.manifest.dist.tarball, entry]));
  const tarballs: Array<{
    readonly bytes: Uint8Array;
    readonly entry: Readonly<{
      file: string;
      integrity: string;
      name: string;
      version: string;
    }>;
  }> = [];
  const seen = new Set<string>();
  for (const pinned of Object.values(lockfile.packages)) {
    if (!pinned.resolved || !pinned.integrity) continue;
    const source = byUrl.get(pinned.resolved);
    if (!source) throw new Error(`Sass Eddy fixture lacks ${pinned.resolved}`);
    const key = identity(source);
    if (seen.has(key)) continue;
    seen.add(key);
    tarballs.push({
      entry: {
        file: `tarballs/${source.manifest.name.replace('/', '__')}-${source.manifest.version}.tgz`,
        name: source.manifest.name,
        version: source.manifest.version,
        integrity: pinned.integrity,
      },
      bytes: source.tarball,
    });
  }
  return packEddyBundle({
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.1.0-sass-contract',
      asOf: {
        resolvedAt: '2026-08-02T00:00:00.000Z',
        registry: 'https://registry.npmjs.org',
        closureHash: await closureHashOf(lockfile),
      },
      tarballs: tarballs.map(({ entry }) => entry),
    },
    lockfileText: JSON.stringify(lockfile, null, 2),
    tarballs,
  });
}

function cloneManifest(manifest: FixtureManifest): FixtureManifest {
  return {
    ...manifest,
    dependencies: { ...(manifest.dependencies ?? {}) },
    optionalDependencies: { ...(manifest.optionalDependencies ?? {}) },
    peerDependencies: { ...(manifest.peerDependencies ?? {}) },
    ...(manifest.bundleDependencies === undefined
      ? {}
      : { bundleDependencies: [...manifest.bundleDependencies] }),
    ...(manifest.bundledDependencies === undefined
      ? {}
      : { bundledDependencies: [...manifest.bundledDependencies] }),
    dist: { ...manifest.dist },
  };
}

async function entriesWithProjectionDrift(
  mutate: ProjectionDrift['mutate'],
): Promise<readonly RegistryEntry[]> {
  const entries = await loadOfficialSassEntries();
  const source = officialSource(entries);
  const projection: MutableProjection = {
    dependencies: { ...SASS_REQUIRED_DEPENDENCIES },
    optionalDependencies: { ...SASS_OMITTED_OPTIONAL_DEPENDENCIES },
    peerDependencies: {},
    bundleDependencies: [],
  };
  mutate(projection);
  return entries.map((entry) =>
    entry === source
      ? {
          manifest: {
            ...cloneManifest(source.manifest),
            dependencies: projection.dependencies,
            optionalDependencies: projection.optionalDependencies,
            peerDependencies: projection.peerDependencies,
            bundleDependencies: projection.bundleDependencies,
          },
          tarball: source.tarball,
        }
      : entry,
  );
}

function pathAt(root: string, relative: string): string {
  return `${ROOT}/${root}/${relative}`;
}

function traceFact(lockfile: Lockfile): Record<string, unknown> {
  const raw = lockfile as unknown as {
    rifty?: { shadowSubstitutions?: { applied?: unknown[] } };
  };
  const fact = raw.rifty?.shadowSubstitutions?.applied?.find((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return false;
    return (candidate as { substitutionId?: unknown }).substitutionId === SASS_RECIPE_ID;
  });
  if (!fact || typeof fact !== 'object') throw new Error('Sass trace fact is missing');
  return fact as Record<string, unknown>;
}

function traceAcquisition(lockfile: Lockfile): Record<string, unknown> {
  const acquisition = traceFact(lockfile).acquisition;
  if (!acquisition || typeof acquisition !== 'object') {
    throw new Error('Sass trace acquisition is missing');
  }
  return acquisition as Record<string, unknown>;
}

async function expectExactMaterialization(
  fixture: ScopeFixture,
  vfs: MemoryVfs,
  result: InstallResult,
  registry: SassFixtureRegistry | DenyAllRegistry,
  cache: LedgerTarballCache,
  reports: readonly string[],
): Promise<void> {
  const recipe = requireSassRecipe();
  const sourceEntry = result.lockfile.packages[fixture.sourcePath];
  const aliasEntry = result.lockfile.packages[fixture.aliasPath];
  expect
    .soft(result.lockfile.packages, 'exact complete package lock facts')
    .toEqual(expectedLockPackages(fixture));
  expect
    .soft(sourceEntry, 'exact acquired Sass lock entry')
    .toEqual(expectedRegistryLockEntry(officialSource(fixture.entries)));
  expect.soft(aliasEntry, 'exact materialized facade lock entry').toEqual({
    version: SASS_TRIGGER_VERSION,
    bin: { sass: SASS_BIN },
    riftyShadowRecipe: SASS_RECIPE_ID,
  });

  for (const [name] of Object.entries(EXPECTED_REQUIRED_VERSIONS)) {
    const official = requiredEntry(fixture.entries, name);
    const entry = result.lockfile.packages[`node_modules/${name}`];
    expect.soft(entry, `${name} exact lock entry`).toEqual(expectedRegistryLockEntry(official));
    expect
      .soft(await vfs.exists(`${ROOT}/node_modules/${name}/package.json`), `${name} tree`)
      .toBe(true);
  }
  expect
    .soft(Object.keys(result.lockfile.packages).filter((path) => path.includes('@parcel/watcher')))
    .toEqual([]);
  expect.soft(await vfs.exists(`${ROOT}/node_modules/@parcel/watcher`)).toBe(false);
  await expectOfficialArchiveTrees(fixture, vfs);

  const expectedFacadePaths = ['package.json', SASS_CJS, SASS_ESM, SASS_BIN].sort();
  expect
    .soft(
      recipe.materialization.files.map(({ path }) => path).sort(),
      'owner-decoded exact facade paths',
    )
    .toEqual(expectedFacadePaths);
  const facadeFiles = await snapshotFiles(vfs, `${ROOT}/${fixture.aliasPath}`);
  expect
    .soft(Object.keys(facadeFiles).sort(), 'materialized exact facade paths')
    .toEqual(expectedFacadePaths);
  for (const file of recipe.materialization.files) {
    const expectedBytes = new TextEncoder().encode(file.content);
    expect.soft(file.bytes, `${file.path} owner bytes`).toBe(expectedBytes.byteLength);
    expect.soft(file.sha256, `${file.path} owner digest`).toBe(sha256(expectedBytes));
    expect
      .soft(facadeFiles[file.path], `${file.path} exact materialized bytes`)
      .toEqual(expectedBytes);
  }
  const packageManifest = JSON.parse(
    await vfs.readFileText(pathAt(fixture.aliasPath, 'package.json')),
  ) as Record<string, unknown>;
  expect.soft(packageManifest, 'literal facade manifest').toEqual({
    name: SASS_TRIGGER,
    version: SASS_TRIGGER_VERSION,
    main: SASS_CJS,
    exports: {
      import: { default: `./${SASS_ESM}` },
      default: `./${SASS_CJS}`,
    },
    bin: { sass: SASS_BIN },
  });
  for (const target of [SASS_CJS, SASS_ESM, SASS_BIN]) {
    expect.soft(await vfs.exists(pathAt(fixture.aliasPath, target)), `${target} target`).toBe(true);
  }
  expect
    .soft(await vfs.readFileText(`${ROOT}/${fixture.binPath}`), 'user-visible Sass launcher')
    .toBe(`#!/usr/bin/env node\nimport('../${SASS_TRIGGER}/${SASS_BIN}');\n`);

  const plan = shadowAssetPlanForInstallResult(result);
  expect.soft(plan.assets).toEqual([]);
  expect.soft(plan.bindings).toEqual([]);
  const fileFacts = recipe.materialization.files.map(({ path, bytes, sha256: digest }) => ({
    path,
    bytes,
    sha256: digest,
  }));
  const catalog = {
    id: builtinShadowSubstitutionCatalog.id,
    digest: builtinShadowSubstitutionCatalog.digest,
  };
  const trigger = {
    name: SASS_TRIGGER,
    requestedRange: SASS_TRIGGER_VERSION,
    version: SASS_TRIGGER_VERSION,
  };
  const planAcquisition = {
    kind: 'registry',
    name: SASS_SOURCE,
    version: SASS_SOURCE_VERSION,
    resolved: SASS_SOURCE_URL,
    integrity: SASS_SOURCE_INTEGRITY,
  } as const;
  expect.soft(plan.substitutions, 'exact public substitution provenance').toEqual([
    {
      catalog,
      substitutionId: SASS_RECIPE_ID,
      recipeDigest: recipe.digest,
      trigger,
      acquisition: planAcquisition,
      materialization: {
        installPath: fixture.aliasPath,
        name: SASS_TRIGGER,
        version: SASS_TRIGGER_VERSION,
        files: fileFacts,
      },
    },
  ]);

  const acquisition = {
    ...planAcquisition,
    dependencies: SASS_REQUIRED_DEPENDENCIES,
    optionalDependencies: {},
    peerDependencies: {},
    bundleDependencies: [],
    bundled: [],
  };
  expect.soft(traceAcquisition(result.lockfile), 'exact trace acquisition').toEqual(acquisition);
  expect.soft(result.lockfile.rifty?.shadowSubstitutions, 'exact lock provenance').toEqual({
    protocol: 'rifty.shadow-substitutions/v2',
    applied: [
      {
        catalog,
        substitutionId: SASS_RECIPE_ID,
        recipeDigest: recipe.digest,
        trigger,
        acquisition,
        materialization: {
          installPath: fixture.aliasPath,
          name: SASS_TRIGGER,
          version: SASS_TRIGGER_VERSION,
          files: fileFacts,
          bin: { sass: SASS_BIN },
        },
      },
    ],
  });

  const packageEvents = [
    ...('packumentReads' in registry ? registry.packumentReads : registry.reads),
    ...('tarballReads' in registry ? registry.tarballReads : []),
    ...cache.gets,
    ...cache.puts,
  ];
  expectNoForbiddenPackageProbe(packageEvents, 'forbidden native/watcher registry-cache probes');
  expect.soft(reports, 'exact non-duplicated Sass reports').toEqual(expectedReports());
  await expectCompleteTree(fixture, vfs, 'materialization');
}

async function seed(scope: Scope): Promise<SeededInstall> {
  const fixture = await scopeFixture(scope);
  const vfs = await project();
  const cache = new LedgerTarballCache();
  const registry = new SassFixtureRegistry(fixture.entries);
  const reports: string[] = [];
  const result = await installFixture(fixture, vfs, registry, cache, reports);
  const lockBytes = await vfs.readFile(`${ROOT}/package-lock.json`);
  return { ...fixture, cache, lockBytes, registry, reports, result, vfs };
}

async function expectNoNewPublication(
  vfs: MemoryVfs,
  fixture: ScopeFixture,
  reports: readonly string[],
  priorLock?: Uint8Array,
): Promise<void> {
  expect.soft(reports).toEqual([]);
  expect.soft(await vfs.exists(`${ROOT}/${fixture.aliasPath}`)).toBe(false);
  expect.soft(await vfs.exists(`${ROOT}/${fixture.binPath}`)).toBe(false);
  if (priorLock === undefined) {
    expect.soft(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);
  } else {
    expect.soft(await vfs.readFile(`${ROOT}/package-lock.json`)).toEqual(priorLock);
  }
}

const projectionDrifts: readonly ProjectionDrift[] = [
  {
    label: 'required dependency removal',
    mutate(projection) {
      Reflect.deleteProperty(projection.dependencies, 'chokidar');
    },
  },
  {
    label: 'required dependency range change',
    mutate(projection) {
      projection.dependencies.immutable = '^6.0.0';
    },
  },
  {
    label: 'required dependency addition',
    mutate(projection) {
      projection.dependencies['unexpected-required'] = '1.0.0';
    },
  },
  {
    label: 'omitted optional removal',
    mutate(projection) {
      projection.optionalDependencies = {};
    },
  },
  {
    label: 'omitted optional range change',
    mutate(projection) {
      projection.optionalDependencies['@parcel/watcher'] = '^3.0.0';
    },
  },
  {
    label: 'optional dependency addition',
    mutate(projection) {
      projection.optionalDependencies['unexpected-optional'] = '1.0.0';
    },
  },
  {
    label: 'peer dependency injection',
    mutate(projection) {
      projection.peerDependencies['unexpected-peer'] = '^1.0.0';
    },
  },
  {
    label: 'bundle dependency injection',
    mutate(projection) {
      projection.bundleDependencies.push('chokidar');
    },
  },
];

const replayInjections: readonly ReplayInjection[] = [
  {
    label: 'required dependency removal',
    mutate(lock, fixture) {
      const entry = lock.packages[fixture.sourcePath];
      if (!entry) throw new Error('Sass acquisition lock entry is missing');
      entry.dependencies = { immutable: '^5.1.5', 'source-map-js': '>=0.6.2 <2.0.0' };
    },
  },
  {
    label: 'required dependency range drift',
    mutate(lock, fixture) {
      const entry = lock.packages[fixture.sourcePath];
      if (!entry) throw new Error('Sass acquisition lock entry is missing');
      entry.dependencies = { ...SASS_REQUIRED_DEPENDENCIES, immutable: '^6.0.0' };
    },
  },
  {
    label: 'omitted watcher dependency plus forged child',
    mutate(lock, fixture, watcher) {
      const source = lock.packages[fixture.sourcePath];
      const integrity = watcher.manifest.dist.integrity;
      if (!source || !integrity) throw new Error('watcher injection fixture is incomplete');
      source.dependencies = {
        ...SASS_REQUIRED_DEPENDENCIES,
        '@parcel/watcher': '^2.4.1',
      };
      lock.packages['node_modules/@parcel/watcher'] = {
        version: watcher.manifest.version,
        resolved: watcher.manifest.dist.tarball,
        integrity,
        dependencies: {},
      };
    },
  },
  {
    label: 'peer dependency injection',
    mutate(lock, fixture) {
      const source = lock.packages[fixture.sourcePath];
      if (!source) throw new Error('Sass acquisition lock entry is missing');
      source.peerDependencies = { '@parcel/watcher': '^2.4.1' };
    },
  },
  {
    label: 'bundle dependency injection',
    mutate(lock, fixture, watcher) {
      const source = lock.packages[fixture.sourcePath];
      if (!source) throw new Error('Sass acquisition lock entry is missing');
      source.bundleDependencies = ['@parcel/watcher'];
      lock.packages[`${fixture.sourcePath}/node_modules/@parcel/watcher`] = {
        version: watcher.manifest.version,
        inBundle: true,
      };
    },
  },
  {
    label: 'trace required dependency drift',
    mutate(lock) {
      traceAcquisition(lock).dependencies = { ...SASS_REQUIRED_DEPENDENCIES, chokidar: '^6.0.0' };
    },
  },
  {
    label: 'trace optional dependency injection',
    mutate(lock) {
      traceAcquisition(lock).optionalDependencies = { '@parcel/watcher': '^2.4.1' };
    },
  },
  {
    label: 'trace peer dependency injection',
    mutate(lock) {
      traceAcquisition(lock).peerDependencies = { unexpected: '^1.0.0' };
    },
  },
  {
    label: 'trace bundle dependency injection',
    mutate(lock) {
      traceAcquisition(lock).bundleDependencies = ['@parcel/watcher'];
    },
  },
];

function writerSpies(vfs: MemoryVfs) {
  return [
    vi.spyOn(vfs, 'mkdir'),
    vi.spyOn(vfs, 'writeFile'),
    vi.spyOn(vfs, 'rm'),
    vi.spyOn(vfs, 'utimes'),
  ];
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sass-embedded official installer fixture authority', () => {
  it('serves only the exact official Sass and complete required-closure tarballs', async () => {
    const entries = await loadOfficialSassEntries();
    expect(entries.map(({ manifest }) => `${manifest.name}@${manifest.version}`)).toEqual([
      'sass@1.100.0',
      'chokidar@5.0.0',
      'readdirp@5.1.1',
      'immutable@5.1.9',
      'source-map-js@1.2.1',
    ]);
    expect(entries.map(({ tarball }) => tarball.byteLength)).toEqual([
      927_111, 23_399, 9_058, 148_909, 35_340,
    ]);
    for (const entry of entries) {
      expect(await computeIntegrity(entry.tarball)).toBe(entry.manifest.dist.integrity);
      const files = officialArchiveFiles(entry);
      const packageJson = files['package.json'];
      expect(packageJson, `${identity(entry)} independent package.json snapshot`).toBeDefined();
      expect(JSON.parse(new TextDecoder().decode(packageJson)) as unknown).toMatchObject({
        name: entry.manifest.name,
        version: entry.manifest.version,
      });
    }
    expect(officialSource(entries).manifest).toMatchObject({
      dependencies: SASS_REQUIRED_DEPENDENCIES,
      optionalDependencies: SASS_OMITTED_OPTIONAL_DEPENDENCIES,
      peerDependencies: {},
      bundleDependencies: [],
      bin: { sass: 'sass.js' },
    });
  });
});

describe('sass-embedded exact admission and complete projection', () => {
  it.each(['^1.100.0', '~1.100.0', '>=1.100.0', '1.100.x', '*', 'latest'])(
    '[fault: observable-order] rejects non-exact %s before registry, cache, VFS, or report effects',
    async (range) => {
      const vfs = await project();
      const registry = new DenyAllRegistry();
      const cache = new LedgerTarballCache();
      const reports: string[] = [];
      const writers = writerSpies(vfs);
      const outcome = await settled(
        installFixture({ dependencies: { [SASS_TRIGGER]: range } }, vfs, registry, cache, reports),
      );

      expect.soft(outcome.kind).toBe('rejected');
      expect
        .soft(errorRecord(outcome.kind === 'rejected' ? outcome.error : undefined))
        .toMatchObject({
          name: 'NotImplementedError',
          feature: SASS_VERSION_FEATURE,
        });
      expect.soft(registry.reads).toEqual([]);
      expect.soft(cache.gets).toEqual([]);
      expect.soft(cache.puts).toEqual([]);
      expect.soft(reports).toEqual([]);
      for (const writer of writers) expect.soft(writer).not.toHaveBeenCalled();
      expect.soft(await vfs.exists(`${ROOT}/node_modules`)).toBe(false);
      expect(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);
    },
  );

  it.each(projectionDrifts)(
    '[fault: corrupt-input / observable-order] rejects $label before tarball, cache, VFS, or report effects',
    async ({ mutate }) => {
      const entries = await entriesWithProjectionDrift(mutate);
      const registry = new SassFixtureRegistry(entries);
      const cache = new LedgerTarballCache();
      const vfs = await project();
      const reports: string[] = [];
      const writers = writerSpies(vfs);
      const outcome = await settled(
        installFixture(
          { dependencies: { [SASS_TRIGGER]: SASS_TRIGGER_VERSION } },
          vfs,
          registry,
          cache,
          reports,
        ),
      );

      expect.soft(outcome.kind).toBe('rejected');
      expect
        .soft(errorRecord(outcome.kind === 'rejected' ? outcome.error : undefined))
        .toMatchObject({
          name: 'NotImplementedError',
          feature: SASS_ACQUISITION_FEATURE,
        });
      expect.soft(registry.packumentReads).toEqual([SASS_SOURCE]);
      expect.soft(registry.tarballReads).toEqual([]);
      expect.soft(cache.gets).toEqual([]);
      expect.soft(cache.puts).toEqual([]);
      expect.soft(reports).toEqual([]);
      for (const writer of writers) expect.soft(writer).not.toHaveBeenCalled();
      expect.soft(await vfs.exists(`${ROOT}/node_modules`)).toBe(false);
      expect(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);
    },
  );
});

describe('sass-embedded required traversal, materialization, and replay', () => {
  it.each(['root', 'nested'] as const)(
    'materializes the exact official closure at %s and replays it offline byte-for-byte',
    async (scope) => {
      requireSassRecipe();
      const seeded = await seed(scope);
      await expectExactMaterialization(
        seeded,
        seeded.vfs,
        seeded.result,
        seeded.registry,
        seeded.cache,
        seeded.reports,
      );
      expectFreshLedgers(seeded, seeded);
      const freshTree = await snapshotTree(seeded.vfs, `${ROOT}/node_modules`);

      const replayVfs = await project();
      const lockBefore = await writeLock(replayVfs, seeded.result.lockfile);
      const replayCache = seeded.cache.clone();
      replayCache.clearLedger();
      const denyRegistry = new DenyAllRegistry();
      const replayReports: string[] = [];
      const replay = await installFixture(
        seeded,
        replayVfs,
        denyRegistry,
        replayCache,
        replayReports,
      );

      expect.soft(await replayVfs.readFile(`${ROOT}/package-lock.json`)).toEqual(lockBefore);
      expect.soft(replay.lockfile).toEqual(seeded.result.lockfile);
      await expectExactMaterialization(
        seeded,
        replayVfs,
        replay,
        denyRegistry,
        replayCache,
        replayReports,
      );
      expectReplayLedgers(seeded, denyRegistry, replayCache, replayReports);
      expect
        .soft(await snapshotTree(replayVfs, `${ROOT}/node_modules`), 'complete replay VFS tree')
        .toEqual(freshTree);
    },
  );

  it('[fault: frozen-assumption] replays a lock-pinned peer RANGE edge onto the recorded exact facade offline', async () => {
    requireSassRecipe();
    // External oracle (docs/backlog/npm-client/reference/
    // npm-11-lockfile-replay-probe-output.json `rangePeer`): npm 11.17.0
    // records a host's peer RANGE verbatim on its lock entry and `npm ci`
    // reifies it onto the exact pinned entry with exit 0. Live resolve never
    // resolves peer edges — the recorded pin is the only admission fact replay
    // may consult. A replay that re-runs request-shape admission with the peer
    // range freezes the false assumption that every resolved (name, range) is
    // a user request.
    const official = await loadOfficialSassEntries();
    const peerHost = await auxiliaryRegistryEntry(
      'peer-host',
      '1.0.0',
      {},
      { peerDependencies: { [SASS_TRIGGER]: '^1.70.0' } },
    );
    const fixture = {
      dependencies: { 'peer-host': '1.0.0', [SASS_TRIGGER]: SASS_TRIGGER_VERSION },
      entries: [...official, peerHost],
    };
    const vfs = await project();
    const cache = new LedgerTarballCache();
    const reports: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await installFixture(
        fixture,
        vfs,
        new SassFixtureRegistry(fixture.entries),
        cache,
        reports,
      );
      expect(result.lockfile.packages['node_modules/peer-host']?.peerDependencies).toEqual({
        [SASS_TRIGGER]: '^1.70.0',
      });
      const freshTree = await snapshotTree(vfs, `${ROOT}/node_modules`);

      const replayVfs = await project();
      const lockBefore = await writeLock(replayVfs, result.lockfile);
      const replayCache = cache.clone();
      replayCache.clearLedger();
      const replayReports: string[] = [];
      const replay = await installFixture(
        fixture,
        replayVfs,
        new DenyAllRegistry(),
        replayCache,
        replayReports,
      );

      expect.soft(await replayVfs.readFile(`${ROOT}/package-lock.json`)).toEqual(lockBefore);
      expect.soft(replay.lockfile).toEqual(result.lockfile);
      expect
        .soft(await snapshotTree(replayVfs, `${ROOT}/node_modules`), 'complete replay VFS tree')
        .toEqual(freshTree);
    } finally {
      warn.mockRestore();
    }
  });

  it('[fault: observable-order] live install warn-skips an OPTIONAL trigger-range edge instead of failing at prefetch', async () => {
    requireSassRecipe();
    // npm parity: an optional edge naming the trigger with a non-admitted
    // range warn-and-skips. Today the walk's registry-source PREFETCH
    // (advisory warm-up, installer.ts registry `prefetch`) runs request-shape
    // admission synchronously OUTSIDE the optional error boundary, so live
    // install fails loudly before the boundary can catch what resolve would
    // have thrown in the right slot.
    const optHost = await auxiliaryRegistryEntry(
      'opt-host',
      '1.0.0',
      {},
      { optionalDependencies: { [SASS_TRIGGER]: '^1.70.0' } },
    );
    const fixture = { dependencies: { 'opt-host': '1.0.0' }, entries: [optHost] };
    const vfs = await project();
    const cache = new LedgerTarballCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await installFixture(
        fixture,
        vfs,
        new SassFixtureRegistry(fixture.entries),
        cache,
        [],
      );
      expect(result.packages.map(({ name }) => name)).toEqual(['opt-host']);
      // The npm-visible skip observable, pinned verbatim including the reason.
      expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
        `optional dependency ${SASS_TRIGGER}@^1.70.0 of opt-host could not be installed: Not implemented: ${SASS_VERSION_FEATURE} (shadow recipe does not admit ^1.70.0)`,
      );
      // Writer records the declared edge; the never-pinned target has no entry.
      expect(result.lockfile.packages['node_modules/opt-host']?.optionalDependencies).toEqual({
        [SASS_TRIGGER]: '^1.70.0',
      });
      expect(result.lockfile.packages[`node_modules/${SASS_TRIGGER}`]).toBeUndefined();
      expect(await vfs.exists(`${ROOT}/node_modules/${SASS_TRIGGER}`)).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('[fault: observable-order] lock replay warn-skips a recorded OPTIONAL trigger-range edge with no entry', async () => {
    requireSassRecipe();
    // Same npm-recorded shape, replay side: the incremental source's PREFETCH
    // (`useRegistry` → `lockfileReuseDecision`) runs the same request-shape
    // admission synchronously outside the optional boundary. The lock is
    // crafted directly (npm keeps a failed optional's edge and drops its
    // entry), so this RED does not depend on the live-path fix.
    const optHost = await auxiliaryRegistryEntry('opt-host', '1.0.0');
    const fixture = { dependencies: { 'opt-host': '1.0.0' }, entries: [optHost] };
    const vfs = await project();
    const cache = new LedgerTarballCache();
    const seedResult = await installFixture(
      fixture,
      vfs,
      new SassFixtureRegistry(fixture.entries),
      cache,
      [],
    );
    const lock = structuredClone(seedResult.lockfile);
    const hostEntry = lock.packages['node_modules/opt-host'];
    if (!hostEntry) throw new Error('opt-host lock entry missing');
    hostEntry.optionalDependencies = { [SASS_TRIGGER]: '^1.70.0' };

    const replayVfs = await project();
    await writeLock(replayVfs, lock);
    const replayCache = cache.clone();
    replayCache.clearLedger();
    const registry = new DenyAllRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const replay = await installFixture(fixture, replayVfs, registry, replayCache, []);
      expect(replay.packages.map(({ name }) => name)).toEqual(['opt-host']);
      expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
        `optional dependency ${SASS_TRIGGER}@^1.70.0 of opt-host could not be installed: Not implemented: ${SASS_VERSION_FEATURE} (shadow recipe does not admit ^1.70.0)`,
      );
      expect(registry.reads).toEqual([]);
      expect(await replayVfs.exists(`${ROOT}/node_modules/${SASS_TRIGGER}`)).toBe(false);
      // Post-replay lock shape: the recorded optional edge survives the
      // rewrite and the never-pinned target still has no entry.
      const rewritten = JSON.parse(
        new TextDecoder().decode(await replayVfs.readFile(`${ROOT}/package-lock.json`)),
      ) as Lockfile;
      expect(rewritten.packages['node_modules/opt-host']?.optionalDependencies).toEqual({
        [SASS_TRIGGER]: '^1.70.0',
      });
      expect(rewritten.packages[`node_modules/${SASS_TRIGGER}`]).toBeUndefined();
      expect(replay.lockfile.packages['node_modules/opt-host']?.optionalDependencies).toEqual({
        [SASS_TRIGGER]: '^1.70.0',
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses a foreign lock that pins a NON-attested trigger version behind a peer range', async () => {
    requireSassRecipe();
    // Regression pin, GREEN before and after: only the recipe's attested
    // product replays without request admission. A foreign (npm-authored,
    // native) sass-embedded pin stays a loud NotImplementedError.
    const peerHost = await auxiliaryRegistryEntry(
      'foreign-peer-host',
      '1.0.0',
      {},
      { peerDependencies: { [SASS_TRIGGER]: '^1.70.0' } },
    );
    const fixture = { dependencies: { 'foreign-peer-host': '1.0.0' }, entries: [peerHost] };
    const vfs = await project();
    const cache = new LedgerTarballCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await installFixture(
        fixture,
        vfs,
        new SassFixtureRegistry(fixture.entries),
        cache,
        [],
      );
      const lock = structuredClone(result.lockfile);
      lock.packages[`node_modules/${SASS_TRIGGER}`] = {
        version: '1.77.0',
        resolved: `https://fixture.invalid/${SASS_TRIGGER}-1.77.0.tgz`,
        integrity: 'sha512-Zm9yZWlnbi1sb2NrLXBpbi1uZXZlci1mZXRjaGVk',
      };
      const replayVfs = await project();
      await writeLock(replayVfs, lock);
      const replayCache = cache.clone();
      replayCache.clearLedger();
      const registry = new DenyAllRegistry();
      const outcome = await settled(
        installFixture(fixture, replayVfs, registry, replayCache, []),
      );
      expect(outcome.kind).toBe('rejected');
      expect(
        errorRecord(outcome.kind === 'rejected' ? outcome.error : undefined),
      ).toMatchObject({ name: 'NotImplementedError', feature: SASS_VERSION_FEATURE });
      expect(registry.reads).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps a REQUIRED trigger-range edge with no entry a loud NotImplementedError, not a lock repair', async () => {
    requireSassRecipe();
    // Regression pin, GREEN before and after: request-shape admission still
    // precedes missing-entry handling — deleting the lock and re-installing
    // could never satisfy this edge, so EBROKENLOCK guidance would lie.
    const reqHost = await auxiliaryRegistryEntry('req-host', '1.0.0');
    const fixture = { dependencies: { 'req-host': '1.0.0' }, entries: [reqHost] };
    const vfs = await project();
    const cache = new LedgerTarballCache();
    const result = await installFixture(
      fixture,
      vfs,
      new SassFixtureRegistry(fixture.entries),
      cache,
      [],
    );
    const lock = structuredClone(result.lockfile);
    const hostEntry = lock.packages['node_modules/req-host'];
    if (!hostEntry) throw new Error('req-host lock entry missing');
    hostEntry.dependencies = { [SASS_TRIGGER]: '^1.70.0' };
    const replayVfs = await project();
    await writeLock(replayVfs, lock);
    const replayCache = cache.clone();
    replayCache.clearLedger();
    const registry = new DenyAllRegistry();
    const outcome = await settled(installFixture(fixture, replayVfs, registry, replayCache, []));
    expect(outcome.kind).toBe('rejected');
    expect(errorRecord(outcome.kind === 'rejected' ? outcome.error : undefined)).toMatchObject({
      name: 'NotImplementedError',
      feature: SASS_VERSION_FEATURE,
    });
    expect(registry.reads).toEqual([]);
  });

  it('materializes the official Sass closure through general Eddy with exact persisted tree/lock/provenance', async () => {
    requireSassRecipe();
    const seeded = await seed('root');
    const freshTree = await snapshotTree(seeded.vfs, `${ROOT}/node_modules`);
    const bundle = await eddyBundleFor(seeded.result.lockfile, seeded.entries);
    const vfs = await project();
    const registry = new DenyAllRegistry();
    const cache = new LedgerTarballCache();
    const reports: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(bundle as unknown as BodyInit));

    const result = await installFixture(
      seeded,
      vfs,
      registry,
      cache,
      reports,
      undefined,
      'https://eddy.test/resolve',
    );

    expect.soft(fetchSpy).toHaveBeenCalledTimes(1);
    expect.soft(result.source).toBe('eddy');
    expect.soft(result.lockfile).toEqual(seeded.result.lockfile);
    expect.soft(await vfs.readFile(`${ROOT}/package-lock.json`)).toEqual(seeded.lockBytes);
    await expectExactMaterialization(seeded, vfs, result, registry, cache, reports);
    expectEddyLedgers(seeded, registry, cache, reports);
    expect
      .soft(await snapshotTree(vfs, `${ROOT}/node_modules`), 'complete Eddy VFS tree')
      .toEqual(freshTree);
  });

  it('[fault: corrupt-input / observable-order] rejects acquisition-entry and trace injections before replay effects', async () => {
    requireSassRecipe();
    const seeded = await seed('root');
    const watcher = await auxiliaryRegistryEntry('@parcel/watcher', '2.4.1');

    for (const injection of replayInjections) {
      const lock = structuredClone(seeded.result.lockfile);
      injection.mutate(lock, seeded, watcher);
      const vfs = await project();
      const lockBefore = await writeLock(vfs, lock);
      const writers = writerSpies(vfs);
      const cache = seeded.cache.clone();
      cache.seed(watcher);
      cache.clearLedger();
      const registry = new DenyAllRegistry();
      const reports: string[] = [];
      const outcome = await settled(installFixture(seeded, vfs, registry, cache, reports));

      expect.soft(outcome.kind, injection.label).toBe('rejected');
      expect
        .soft(errorRecord(outcome.kind === 'rejected' ? outcome.error : undefined), injection.label)
        .toMatchObject({ code: 'EBROKENLOCK', reason: 'shadow-trace-drift' });
      expect.soft(registry.reads, `${injection.label}: registry`).toEqual([]);
      expect.soft(cache.gets, `${injection.label}: cache`).toEqual([]);
      expect.soft(cache.puts, `${injection.label}: cache writes`).toEqual([]);
      expect.soft(reports, `${injection.label}: reports`).toEqual([]);
      for (const writer of writers) {
        expect.soft(writer, `${injection.label}: ${writer.getMockName()}`).not.toHaveBeenCalled();
      }
      expect.soft(await vfs.exists(`${ROOT}/${seeded.aliasPath}`), injection.label).toBe(false);
      expect
        .soft(await vfs.readFile(`${ROOT}/package-lock.json`), `${injection.label}: raw lock`)
        .toEqual(lockBefore);
    }
  });
});

describe('sass-embedded acquisition/cache failure publication', () => {
  it.each([SASS_SOURCE, 'immutable'])(
    '[fault: provenance-lie] keeps an immediate fresh %s acquisition failure unpublished and exact on retry',
    async (packageName) => {
      requireSassRecipe();
      const fixture = await scopeFixture('root');
      const failure = new Error(`injected ${packageName} tarball failure`);
      const fault: OneShotTarballFault = { kind: 'throw', packageName, error: failure };
      const registry = new SassFixtureRegistry(fixture.entries, fault);
      const cache = new LedgerTarballCache();
      const vfs = await project();
      const reports: string[] = [];
      const first = await settled(installFixture(fixture, vfs, registry, cache, reports));

      expect.soft(first.kind).toBe('rejected');
      expect.soft(first.kind === 'rejected' ? first.error : undefined).toBe(failure);
      await expectNoNewPublication(vfs, fixture, reports);

      const result = await installFixture(fixture, vfs, registry, cache, reports);
      await expectExactMaterialization(fixture, vfs, result, registry, cache, reports);
    },
  );

  it.each(
    (['corrupt', 'partial'] as const).flatMap((kind) =>
      [SASS_SOURCE, 'immutable'].map((packageName) => ({ kind, packageName })),
    ),
  )(
    '[fault: corrupt-input / provenance-lie] keeps fresh $packageName $kind bytes unpublished and exact on retry',
    async ({ kind, packageName }) => {
      requireSassRecipe();
      const fixture = await scopeFixture('root');
      const registry = new SassFixtureRegistry(fixture.entries, { kind, packageName });
      const cache = new LedgerTarballCache();
      const vfs = await project();
      const reports: string[] = [];
      const first = await settled(installFixture(fixture, vfs, registry, cache, reports));

      expect.soft(first.kind).toBe('rejected');
      expect
        .soft(errorRecord(first.kind === 'rejected' ? first.error : undefined))
        .toMatchObject({ code: 'EINTEGRITY', packageName });
      await expectNoNewPublication(vfs, fixture, reports);

      const result = await installFixture(fixture, vfs, registry, cache, reports);
      await expectExactMaterialization(fixture, vfs, result, registry, cache, reports);
    },
  );

  it.each([SASS_SOURCE, 'immutable'])(
    '[fault: observable-order / provenance-lie] aborts a reached fresh %s tarball stall and reconciles on retry',
    async (packageName) => {
      requireSassRecipe();
      const fixture = await scopeFixture('root');
      const reached = deferred<void>();
      const release = deferred<void>();
      const registry = new SassFixtureRegistry(fixture.entries, {
        kind: 'stall',
        packageName,
        reached: reached.resolve,
        release: release.promise,
      });
      const cache = new LedgerTarballCache();
      const vfs = await project();
      const reports: string[] = [];
      const controller = new AbortController();
      const reason = new Error(`abort reached ${packageName} tarball stall`);
      const installing = installFixture(fixture, vfs, registry, cache, reports, controller.signal);

      try {
        await boundedReach(
          reached.promise,
          controller,
          release.resolve,
          `${packageName} tarball stall`,
        );
      } catch (error) {
        await boundedSettlement(installing, `${packageName} aborted stall cleanup`);
        throw error;
      }
      controller.abort(reason);
      release.resolve();
      const aborted = await boundedSettlement(installing, `${packageName} aborted stall`);
      expect.soft(aborted.kind).toBe('rejected');
      expect.soft(aborted.kind === 'rejected' ? aborted.error : undefined).toBe(reason);
      await expectNoNewPublication(vfs, fixture, reports);

      const result = await installFixture(fixture, vfs, registry, cache, reports);
      await expectExactMaterialization(fixture, vfs, result, registry, cache, reports);
    },
  );

  it.each(
    (['missing', 'corrupt'] as const).flatMap((kind) =>
      [SASS_SOURCE, 'immutable'].map((packageName) => ({ kind, packageName })),
    ),
  )(
    '[fault: poisoned-cache / provenance-lie] keeps offline $packageName $kind loud and exact on retry',
    async ({ kind, packageName }) => {
      requireSassRecipe();
      const seeded = await seed('root');
      const target = requiredEntry(seeded.entries, packageName);
      const cache = seeded.cache.clone();
      if (kind === 'missing') cache.delete(target);
      else cache.corrupt(target);
      cache.clearLedger();
      const vfs = await project();
      const lockBefore = await writeLock(vfs, seeded.result.lockfile);
      const reports: string[] = [];
      const registry = new DenyAllRegistry();
      const first = await settled(installFixture(seeded, vfs, registry, cache, reports));

      expect.soft(first.kind).toBe('rejected');
      await expectNoNewPublication(vfs, seeded, reports, lockBefore);
      cache.seed(target);
      cache.clearLedger();
      const result = await installFixture(seeded, vfs, registry, cache, reports);
      expect
        .soft(registry.reads)
        .toEqual(
          packageName === SASS_SOURCE || kind === 'corrupt'
            ? []
            : [`tarball:${target.manifest.dist.tarball}`],
        );
      await expectExactMaterialization(seeded, vfs, result, registry, cache, reports);
    },
  );
});

describe('sass-embedded facade/bin VFS fault publication', () => {
  it('[fault: torn-state] aborts a parked facade write without lock/report and reconciles on retry', async () => {
    requireSassRecipe();
    const fixture = await scopeFixture('root');
    const vfs = await project();
    const registry = new SassFixtureRegistry(fixture.entries);
    const cache = new LedgerTarballCache();
    const reports: string[] = [];
    const target = `${ROOT}/${fixture.aliasPath}/${SASS_CJS}`;
    const started = deferred<void>();
    const release = deferred<void>();
    const writeFile = vfs.writeFile.bind(vfs);
    const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path === target) {
        started.resolve();
        await release.promise;
      }
      await writeFile(path, data);
    });
    const controller = new AbortController();
    const reason = new Error('cancel Sass facade publication');
    const installing = installFixture(fixture, vfs, registry, cache, reports, controller.signal);

    try {
      await boundedReach(started.promise, controller, release.resolve, 'Sass facade write');
    } catch (error) {
      await boundedSettlement(installing, 'aborted Sass facade cleanup');
      throw error;
    }
    controller.abort(reason);
    release.resolve();
    const aborted = await boundedSettlement(installing, 'aborted Sass facade write');
    expect.soft(aborted.kind).toBe('rejected');
    expect.soft(aborted.kind === 'rejected' ? aborted.error : undefined).toBe(reason);
    expect.soft(reports).toEqual([]);
    expect.soft(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);
    expect.soft(await vfs.exists(`${ROOT}/${fixture.binPath}`)).toBe(false);

    write.mockRestore();
    const result = await installFixture(fixture, vfs, registry, cache, reports);
    await expectExactMaterialization(fixture, vfs, result, registry, cache, reports);
  });

  it('[fault: torn-state] aborts a parked launcher write without lock/report and reconciles on retry', async () => {
    requireSassRecipe();
    const fixture = await scopeFixture('root');
    const vfs = await project();
    const registry = new SassFixtureRegistry(fixture.entries);
    const cache = new LedgerTarballCache();
    const reports: string[] = [];
    const target = `${ROOT}/${fixture.binPath}`;
    const started = deferred<void>();
    const release = deferred<void>();
    const writeFile = vfs.writeFile.bind(vfs);
    const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path === target) {
        started.resolve();
        await release.promise;
      }
      await writeFile(path, data);
    });
    const controller = new AbortController();
    const reason = new Error('cancel Sass bin publication');
    const installing = installFixture(fixture, vfs, registry, cache, reports, controller.signal);

    try {
      await boundedReach(started.promise, controller, release.resolve, 'Sass launcher write');
    } catch (error) {
      await boundedSettlement(installing, 'aborted Sass launcher cleanup');
      throw error;
    }
    controller.abort(reason);
    release.resolve();
    const aborted = await boundedSettlement(installing, 'aborted Sass launcher write');
    expect.soft(aborted.kind).toBe('rejected');
    expect.soft(aborted.kind === 'rejected' ? aborted.error : undefined).toBe(reason);
    expect.soft(reports).toEqual([]);
    expect.soft(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);

    write.mockRestore();
    const result = await installFixture(fixture, vfs, registry, cache, reports);
    await expectExactMaterialization(fixture, vfs, result, registry, cache, reports);
  });

  it.each(
    (['ENOSPC', 'EACCES'] as const).flatMap((code) =>
      (['facade', 'bin'] as const).map((surface) => ({ code, surface })),
    ),
  )(
    '[fault: quota-perm-fail] keeps $code $surface write loud, unpublished, and exact on retry',
    async ({ code, surface }) => {
      requireSassRecipe();
      const fixture = await scopeFixture('root');
      const vfs = await project();
      const registry = new SassFixtureRegistry(fixture.entries);
      const cache = new LedgerTarballCache();
      const reports: string[] = [];
      const target =
        surface === 'facade'
          ? `${ROOT}/${fixture.aliasPath}/${SASS_CJS}`
          : `${ROOT}/${fixture.binPath}`;
      const failure = Object.assign(new Error(`${code}: Sass ${surface} write denied`), { code });
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectTarget = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectTarget && path === target) {
          rejectTarget = false;
          throw failure;
        }
        await writeFile(path, data);
      });

      await expect(installFixture(fixture, vfs, registry, cache, reports)).rejects.toBe(failure);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);
      if (surface === 'bin') expect.soft(await vfs.exists(target)).toBe(false);

      const result = await installFixture(fixture, vfs, registry, cache, reports);
      await expectExactMaterialization(fixture, vfs, result, registry, cache, reports);
    },
  );
});
