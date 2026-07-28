import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  type BuiltinShadowSubstitutionRecipe,
  type ShadowRegistryDependencyProjection,
  builtinShadowSubstitutionCatalog,
} from '@riftydev/shadow-registry/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from '../../_test-fixtures/tar-builder.ts';
import { install } from '../../installer.ts';
import type { Packument, VersionManifest } from '../../registry.ts';
import { RegistryClient } from '../../registry.ts';
import { type TarballCache, computeIntegrity } from '../../tarball-cache.ts';
import { attestBuiltinShadowSubstitution } from './planner.ts';

type RegistryManifest = VersionManifest & {
  bundleDependencies?: string[];
  bundledDependencies?: string[];
};

interface RegistryEntry {
  readonly manifest: RegistryManifest;
  readonly tarball: Uint8Array;
  readonly files: Readonly<Record<string, string>>;
}

const encoder = new TextEncoder();

async function entry(
  name: string,
  version: string,
  fields: Partial<Omit<RegistryManifest, 'dist' | 'name' | 'version'>> = {},
  files: Readonly<Record<string, string>> = {},
): Promise<RegistryEntry> {
  const manifest: RegistryManifest = {
    name,
    version,
    ...fields,
    dist: { tarball: `https://registry.test/${encodeURIComponent(name)}-${version}.tgz` },
  };
  const { dist: _dist, ...packageManifest } = manifest;
  const packageFiles = {
    'package.json': JSON.stringify(packageManifest),
    ...files,
  };
  const chunks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(packageFiles)) {
    const bytes = encoder.encode(content);
    chunks.push(buildHeader(`package/${path}`, bytes.byteLength), padToBlock(bytes));
  }
  const tarball = await gzip(concat(...chunks, TAR_TRAILER));
  manifest.dist.integrity = await computeIntegrity(tarball);
  return { manifest, tarball, files: packageFiles };
}

class PreseededTarballCache implements TarballCache {
  readonly #entries = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];

  constructor(entries: readonly RegistryEntry[]) {
    for (const candidate of entries) {
      const integrity = candidate.manifest.dist.integrity;
      if (!integrity) throw new Error(`preseeded ${candidate.manifest.name} has no integrity`);
      this.#entries.set(
        `${candidate.manifest.name}\0${candidate.manifest.version}\0${integrity}`,
        candidate.tarball.slice(),
      );
    }
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.gets.push(`${name}@${version}`);
    return this.#entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string): Promise<string> {
    this.puts.push(`${name}@${version}`);
    throw new Error(`preseeded replay attempted cache write for ${name}@${version}`);
  }
}

class LedgerRegistry extends RegistryClient {
  readonly #entries: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>;
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];
  #denyReads = false;

  constructor(entries: readonly RegistryEntry[]) {
    super({ baseUrl: '/contract-registry', fetch: async () => new Response('', { status: 599 }) });
    const grouped = new Map<string, Map<string, RegistryEntry>>();
    for (const candidate of entries) {
      const versions = grouped.get(candidate.manifest.name) ?? new Map();
      versions.set(candidate.manifest.version, candidate);
      grouped.set(candidate.manifest.name, versions);
    }
    this.#entries = grouped;
  }

  denyReads(): void {
    this.packumentReads.length = 0;
    this.tarballReads.length = 0;
    this.#denyReads = true;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    if (this.#denyReads) throw new Error(`replay read packument ${name}`);
    const entries = this.#entries.get(name);
    if (!entries) throw new Error(`contract registry has no packument for ${name}`);
    const versions: Record<string, VersionManifest> = {};
    for (const [version, candidate] of entries) versions[version] = candidate.manifest;
    return {
      name,
      'dist-tags': { latest: [...entries.keys()].sort().at(-1) ?? '0.0.0' },
      versions,
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads.push(url);
    if (this.#denyReads) throw new Error(`replay read tarball ${url}`);
    for (const versions of this.#entries.values()) {
      for (const candidate of versions.values()) {
        if (candidate.manifest.dist.tarball === url) return candidate.tarball.slice();
      }
    }
    throw new Error(`contract registry has no tarball for ${url}`);
  }
}

const lightningRecipe = builtinShadowSubstitutionCatalog.recipes.find(
  (recipe) => recipe.trigger.name === 'lightningcss',
);
if (!lightningRecipe || lightningRecipe.acquisition.kind !== 'registry') {
  throw new Error('builtin LightningCSS registry recipe is missing');
}
const checkedLightningRecipe: Readonly<BuiltinShadowSubstitutionRecipe> = lightningRecipe;
const lightningAcquisition = lightningRecipe.acquisition;
const lightningProjection = lightningAcquisition.dependencyProjection;
const lightningSourceUrl = `https://registry.test/${encodeURIComponent(
  lightningAcquisition.name,
)}-${lightningAcquisition.version}.tgz`;
const bundledNapiManifest = JSON.stringify({ name: 'napi-wasm', version: '1.1.3' });
const bundledNapiIndex = 'module.exports = "bundled napi-wasm";\n';

interface ProjectionFields {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  bundleDependencies: string[];
}

function expectedLightningFields(): ProjectionFields {
  return {
    dependencies: { 'napi-wasm': '^1.0.1' },
    optionalDependencies: {},
    peerDependencies: {},
    bundleDependencies: ['napi-wasm'],
  };
}

async function lightningEntry(fields = expectedLightningFields()): Promise<RegistryEntry> {
  return await entry(
    lightningAcquisition.name,
    lightningAcquisition.version,
    {
      ...fields,
      bin: {
        lightningcss: 'bin/acquired.js',
        'acquired-only': 'bin/acquired.js',
      },
    },
    {
      'bin/acquired.js': '#!/usr/bin/env node\nthrow new Error("acquired bin leaked");\n',
      'node_modules/napi-wasm/package.json': bundledNapiManifest,
      'node_modules/napi-wasm/index.js': bundledNapiIndex,
    },
  );
}

async function lightningRegistry(fields = expectedLightningFields()): Promise<LedgerRegistry> {
  return new LedgerRegistry([await lightningEntry(fields)]);
}

async function installFixture(
  vfs: MemoryVfs,
  registry: RegistryClient,
  dependencies: Readonly<Record<string, string>>,
  tarballCache?: TarballCache,
) {
  return await install(
    'fixture',
    '1.0.0',
    { ...dependencies },
    {
      vfs,
      cwd: '/project',
      registry,
      ...(tarballCache ? { tarballCache } : {}),
      onSubstitution: () => {},
    },
  );
}

type TreeEntry =
  | Readonly<{ kind: 'directory' }>
  | Readonly<{ kind: 'file'; bytes: readonly number[] }>;

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

type DesiredLockfile = Readonly<{
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: true;
  packages: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  rifty?: unknown;
}>;

function integrityOf(candidate: RegistryEntry): string {
  const integrity = candidate.manifest.dist.integrity;
  if (!integrity) throw new Error(`${candidate.manifest.name} fixture has no integrity`);
  return integrity;
}

async function writeReplaySeed(
  vfs: MemoryVfs,
  dependencies: Readonly<Record<string, string>>,
  lockfile: DesiredLockfile,
): Promise<void> {
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies }),
  );
  await vfs.writeFile('/project/package-lock.json', JSON.stringify(lockfile, null, 2));
}

function withMaterializedBin(
  recipe: BuiltinShadowSubstitutionRecipe,
  fact: ReturnType<typeof attestBuiltinShadowSubstitution>,
) {
  return {
    ...fact,
    materialization: {
      ...fact.materialization,
      bin: { ...recipe.materialization.bin },
    },
  };
}

function desiredShadowReplayLock(source: RegistryEntry): DesiredLockfile {
  const esbuildRecipe = builtinShadowSubstitutionCatalog.recipes.find(
    (recipe) => recipe.trigger.name === 'esbuild',
  );
  if (!esbuildRecipe) throw new Error('builtin esbuild recipe is missing');
  const sourceIntegrity = integrityOf(source);
  const esbuildFact = withMaterializedBin(
    esbuildRecipe,
    attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: { kind: 'synthetic' },
    }),
  );
  const lightningFact = withMaterializedBin(
    checkedLightningRecipe,
    attestBuiltinShadowSubstitution({
      trigger: { name: 'lightningcss', requestedRange: '1.32.0', version: '1.32.0' },
      installPath: 'node_modules/lightningcss',
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
        resolved: source.manifest.dist.tarball,
        integrity: sourceIntegrity,
      },
    }),
  );
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        version: '1.0.0',
        dependencies: { esbuild: '0.28.0', 'lightningcss-wasm': '1.32.0' },
      },
      'node_modules/esbuild': {
        version: '0.28.0',
        dependencies: {},
        bin: { esbuild: 'bin/esbuild' },
        resolved: `rifty:shadow-substitution/${esbuildRecipe.id}@${esbuildRecipe.digest}`,
        riftyShadowRecipe: esbuildRecipe.id,
      },
      'node_modules/lightningcss': {
        version: '1.32.0',
        riftyShadowRecipe: checkedLightningRecipe.id,
      },
      'node_modules/lightningcss-wasm': {
        version: '1.32.0',
        dependencies: { 'napi-wasm': '^1.0.1' },
        bundleDependencies: ['napi-wasm'],
        resolved: source.manifest.dist.tarball,
        integrity: sourceIntegrity,
      },
      'node_modules/lightningcss-wasm/node_modules/napi-wasm': {
        version: '1.1.3',
        inBundle: true,
      },
    },
    rifty: {
      shadowSubstitutions: {
        protocol: 'rifty.shadow-substitutions/v2',
        applied: [esbuildFact, lightningFact],
      },
    },
  };
}

function addExpectedFile(snapshot: Record<string, TreeEntry>, path: string, content: string): void {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    snapshot[parts.slice(0, index).join('/')] = { kind: 'directory' };
  }
  snapshot[path] = { kind: 'file', bytes: [...encoder.encode(content)] };
}

function expectedShadowReplayTree(source: RegistryEntry): Record<string, TreeEntry> {
  const expected: Record<string, TreeEntry> = {};
  for (const [path, content] of Object.entries(source.files)) {
    addExpectedFile(expected, `lightningcss-wasm/${path}`, content);
  }
  for (const file of checkedLightningRecipe.materialization.files) {
    addExpectedFile(expected, `lightningcss/${file.path}`, file.content);
  }
  const esbuildRecipe = builtinShadowSubstitutionCatalog.recipes.find(
    (recipe) => recipe.trigger.name === 'esbuild',
  );
  if (!esbuildRecipe) throw new Error('builtin esbuild recipe is missing');
  for (const file of esbuildRecipe.materialization.files) {
    addExpectedFile(expected, `esbuild/${file.path}`, file.content);
  }
  addExpectedFile(
    expected,
    '.bin/esbuild',
    "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n",
  );
  return expected;
}

const projectionDrifts = [
  {
    label: 'dependencies range',
    mutate(fields: ProjectionFields): void {
      fields.dependencies['napi-wasm'] = '9.9.9';
    },
  },
  {
    label: 'dependencies scoped member',
    mutate(fields: ProjectionFields): void {
      fields.dependencies['@drift/required'] = '1.0.0';
    },
  },
  {
    label: 'retained optional scoped member',
    mutate(fields: ProjectionFields): void {
      fields.optionalDependencies['@drift/retained'] = '1.0.0';
    },
  },
  {
    label: 'omitted optional scoped member',
    mutate(fields: ProjectionFields): void {
      fields.optionalDependencies['@drift/omitted'] = '1.0.0';
    },
  },
  {
    label: 'peer scoped member',
    mutate(fields: ProjectionFields): void {
      fields.peerDependencies['@drift/peer'] = '^1.0.0';
    },
  },
  {
    label: 'bundled member removal',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies = [];
    },
  },
  {
    label: 'bundled scoped member',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies.push('@drift/bundled');
    },
  },
] as const;

interface ExecutedDependencyProjection {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundledDependencies: readonly string[];
}

interface AcquisitionAuthorityModule {
  executeRegistryDependencyProjection(
    manifest: RegistryManifest,
    projection: ShadowRegistryDependencyProjection,
  ): ExecutedDependencyProjection;
}

const acquisitionModulePath = './acquisition.ts';

async function loadAcquisitionAuthority(): Promise<AcquisitionAuthorityModule> {
  const loaded: unknown = await import(/* @vite-ignore */ acquisitionModulePath);
  if (
    loaded === null ||
    typeof loaded !== 'object' ||
    !('executeRegistryDependencyProjection' in loaded) ||
    typeof loaded.executeRegistryDependencyProjection !== 'function'
  ) {
    throw new TypeError(
      'internal shadow acquisition module must export executeRegistryDependencyProjection',
    );
  }
  return loaded as AcquisitionAuthorityModule;
}

function projection(
  fields: Partial<Omit<ShadowRegistryDependencyProjection, 'unsupportedFeature'>>,
): ShadowRegistryDependencyProjection {
  return {
    dependencies: {},
    optionalDependencies: {},
    omittedOptionalDependencies: {},
    peerDependencies: {},
    bundledDependencies: [],
    ...fields,
    unsupportedFeature: 'contract.acquisition',
  };
}

function projectionManifest(
  fields: Partial<Omit<RegistryManifest, 'dist' | 'name' | 'version'>>,
): RegistryManifest {
  return {
    name: 'contract-acquisition',
    version: '1.0.0',
    ...fields,
    dist: { tarball: 'https://registry.test/contract-acquisition-1.0.0.tgz' },
  };
}

const genericProjectionCases = [
  {
    label: 'required dependency map',
    manifest: projectionManifest({ dependencies: { required: '1.0.0' } }),
    authority: projection({ dependencies: { required: '1.0.0' } }),
    expected: {
      dependencies: { required: '1.0.0' },
      optionalDependencies: {},
      peerDependencies: {},
      bundledDependencies: [],
    },
  },
  {
    label: 'retained optional dependency map',
    manifest: projectionManifest({ optionalDependencies: { retained: '^2.0.0' } }),
    authority: projection({ optionalDependencies: { retained: '^2.0.0' } }),
    expected: {
      dependencies: {},
      optionalDependencies: { retained: '^2.0.0' },
      peerDependencies: {},
      bundledDependencies: [],
    },
  },
  {
    label: 'omitted optional dependency map',
    manifest: projectionManifest({ optionalDependencies: { native: '3.0.0' } }),
    authority: projection({ omittedOptionalDependencies: { native: '3.0.0' } }),
    expected: {
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      bundledDependencies: [],
    },
  },
  {
    label: 'peer dependency map',
    manifest: projectionManifest({ peerDependencies: { peer: '^4.0.0' } }),
    authority: projection({ peerDependencies: { peer: '^4.0.0' } }),
    expected: {
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: { peer: '^4.0.0' },
      bundledDependencies: [],
    },
  },
  {
    label: 'bundled dependency map through bundledDependencies spelling',
    manifest: projectionManifest({
      dependencies: { bundled: '5.0.0' },
      bundledDependencies: ['bundled'],
    }),
    authority: projection({
      dependencies: { bundled: '5.0.0' },
      bundledDependencies: ['bundled'],
    }),
    expected: {
      dependencies: { bundled: '5.0.0' },
      optionalDependencies: {},
      peerDependencies: {},
      bundledDependencies: ['bundled'],
    },
  },
  {
    label: 'scoped keys in every projection collection',
    manifest: projectionManifest({
      dependencies: { '@scope/required': '1.0.0', '@scope/bundled': '5.0.0' },
      optionalDependencies: {
        '@scope/retained': '2.0.0',
        '@scope/omitted': '3.0.0',
      },
      peerDependencies: { '@scope/peer': '^4.0.0' },
      bundleDependencies: ['@scope/bundled'],
    }),
    authority: projection({
      dependencies: { '@scope/required': '1.0.0', '@scope/bundled': '5.0.0' },
      optionalDependencies: { '@scope/retained': '2.0.0' },
      omittedOptionalDependencies: { '@scope/omitted': '3.0.0' },
      peerDependencies: { '@scope/peer': '^4.0.0' },
      bundledDependencies: ['@scope/bundled'],
    }),
    expected: {
      dependencies: { '@scope/required': '1.0.0', '@scope/bundled': '5.0.0' },
      optionalDependencies: { '@scope/retained': '2.0.0' },
      peerDependencies: { '@scope/peer': '^4.0.0' },
      bundledDependencies: ['@scope/bundled'],
    },
  },
] as const;

async function peerEntries(): Promise<readonly RegistryEntry[]> {
  return [
    await entry('contract-source', '1.0.0', {
      peerDependencies: { 'contract-peer': '^2.0.0' },
    }),
    await entry('contract-peer', '1.0.0'),
    await entry('contract-peer', '2.0.0', {
      dependencies: { 'contract-leaf': '1.0.0' },
    }),
    await entry('contract-leaf', '1.0.0'),
    await entry('contract-host', '1.0.0', {
      dependencies: { 'contract-source': '1.0.0' },
    }),
  ];
}

async function peerRegistry(): Promise<LedgerRegistry> {
  return new LedgerRegistry(await peerEntries());
}

const peerSuccessCases = [
  {
    label: 'direct missing peer',
    oracleCase: 'direct-missing',
    dependencies: { 'contract-source': '1.0.0' },
  },
  {
    label: 'nested missing peer',
    oracleCase: 'nested-missing',
    dependencies: { 'contract-host': '1.0.0' },
  },
  {
    label: 'nested conflicting root peer',
    oracleCase: 'nested-conflict',
    dependencies: { 'contract-host': '1.0.0', 'contract-peer': '1.0.0' },
  },
] as const;

interface OracleLockEntry {
  readonly version?: string;
  readonly peer?: boolean;
}

interface PeerOracle {
  readonly cases: Readonly<
    Record<
      string,
      Readonly<{
        fresh: Readonly<{
          exit: number;
          files: Readonly<Record<string, string>>;
        }>;
        offlineReplay?: Readonly<{
          registryRequests: readonly string[];
          files: Readonly<Record<string, string>>;
        }>;
      }>
    >
  >;
}

const peerOracleUrl = new URL(
  '../../../../../docs/backlog/npm-client/reference/npm-11-peer-placement-probe-output.json',
  import.meta.url,
);
const PEER_ORACLE_SHA256 = 'edefe928491431545846ad63c3517863da1305d8acb7d3479df9c9d4ecb538c1';
let peerOracle: PeerOracle;

function oraclePackages(caseName: string): Readonly<Record<string, OracleLockEntry>> {
  const encoded = peerOracle.cases[caseName]?.fresh.files['package-lock.json'];
  if (!encoded) throw new Error(`committed npm oracle is missing ${caseName} package-lock.json`);
  const decoded = JSON.parse(encoded) as {
    packages?: Readonly<Record<string, OracleLockEntry>>;
  };
  if (!decoded.packages) throw new Error(`committed npm oracle ${caseName} lock has no packages`);
  return decoded.packages;
}

function packageNameAtInstallPath(installPath: string): string {
  const marker = 'node_modules/';
  const offset = installPath.lastIndexOf(marker);
  if (offset < 0) throw new Error(`oracle install path has no package name: ${installPath}`);
  return installPath.slice(offset + marker.length);
}

function peerEntryByIdentity(
  entries: readonly RegistryEntry[],
  name: string,
  version: string,
): RegistryEntry {
  const candidate = entries.find(
    (entry) => entry.manifest.name === name && entry.manifest.version === version,
  );
  if (!candidate) throw new Error(`peer fixture has no ${name}@${version}`);
  return candidate;
}

function desiredPeerReplayLock(
  caseName: string,
  entries: readonly RegistryEntry[],
): DesiredLockfile {
  const oracle = oraclePackages(caseName);
  const packages: Record<string, Record<string, unknown>> = {};
  const rootDependencies: Record<string, string> = {};
  for (const [installPath, pinned] of Object.entries(oracle)) {
    if (installPath === '') continue;
    if (!pinned.version) throw new Error(`oracle ${caseName} ${installPath} has no version`);
    const name = packageNameAtInstallPath(installPath);
    const candidate = peerEntryByIdentity(entries, name, pinned.version);
    const dependencies = { ...(candidate.manifest.dependencies ?? {}) };
    packages[installPath] = {
      version: pinned.version,
      dependencies,
      resolved: candidate.manifest.dist.tarball,
      integrity: integrityOf(candidate),
      ...(candidate.manifest.peerDependencies
        ? { peerDependencies: { ...candidate.manifest.peerDependencies } }
        : {}),
      ...(pinned.peer ? { peer: true } : {}),
    };
    if (!installPath.includes('/node_modules/')) rootDependencies[name] = pinned.version;
  }
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { version: '1.0.0', dependencies: rootDependencies },
      ...packages,
    },
  };
}

function expectedPeerReplayTree(
  caseName: string,
  entries: readonly RegistryEntry[],
): Record<string, TreeEntry> {
  const expected: Record<string, TreeEntry> = {};
  for (const [installPath, pinned] of Object.entries(oraclePackages(caseName))) {
    if (installPath === '' || !pinned.version) continue;
    const name = packageNameAtInstallPath(installPath);
    const candidate = peerEntryByIdentity(entries, name, pinned.version);
    for (const [path, content] of Object.entries(candidate.files)) {
      addExpectedFile(expected, `${installPath.slice('node_modules/'.length)}/${path}`, content);
    }
  }
  return expected;
}

beforeAll(async () => {
  const bytes = await readFile(peerOracleUrl);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== PEER_ORACLE_SHA256) {
    throw new Error(`committed npm peer oracle SHA drifted: ${actualSha256}`);
  }
  peerOracle = JSON.parse(bytes.toString('utf8')) as PeerOracle;
  for (const caseName of ['direct-missing', 'nested-missing', 'nested-conflict']) {
    const candidate = peerOracle.cases[caseName];
    if (
      candidate?.fresh.exit !== 0 ||
      candidate.offlineReplay?.registryRequests.length !== 0 ||
      candidate.fresh.files['package-lock.json'] !==
        candidate.offlineReplay.files['package-lock.json']
    ) {
      throw new Error(`committed npm peer oracle ${caseName} lost its replay proof`);
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 execution authority', () => {
  it.each(genericProjectionCases)(
    'executes the generic $label without a public recipe SPI',
    async ({ manifest, authority, expected }) => {
      const acquisition = await loadAcquisitionAuthority();

      expect(acquisition.executeRegistryDependencyProjection(manifest, authority)).toEqual(
        expected,
      );
    },
  );

  it.each(projectionDrifts)(
    '[fault: observable-order/provenance-lie] rejects builtin $label drift before tarball or VFS work',
    async ({ mutate }) => {
      const fields = expectedLightningFields();
      mutate(fields);
      const registry = await lightningRegistry(fields);
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const writers = [
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      await expect(installFixture(vfs, registry, { lightningcss: '1.32.0' })).rejects.toMatchObject(
        {
          name: 'NotImplementedError',
          feature: lightningProjection.unsupportedFeature,
        },
      );

      expect(registry.packumentReads).toContain(lightningAcquisition.name);
      expect(registry.tarballReads).not.toContain(lightningSourceUrl);
      for (const writer of writers) expect(writer).not.toHaveBeenCalled();
      await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
      await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
    },
  );

  it('traverses retained projection, suppresses acquired bins, and publishes recipe bins', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await lightningRegistry();
    const result = await installFixture(vfs, registry, {
      lightningcss: '1.32.0',
      esbuild: '0.28.0',
    });

    expect(result.lockfile.packages['node_modules/lightningcss-wasm']).toMatchObject({
      version: '1.32.0',
      dependencies: lightningProjection.dependencies,
      bundleDependencies: ['napi-wasm'],
    });
    expect(
      result.lockfile.packages['node_modules/lightningcss-wasm/node_modules/napi-wasm'],
    ).toMatchObject({
      version: '1.1.3',
      inBundle: true,
    });
    expect(result.lockfile.packages['node_modules/lightningcss-wasm']).not.toHaveProperty('bin');
    expect(result.lockfile.packages['node_modules/napi-wasm']).toBeUndefined();
    expect(
      await vfs.readFileText(
        '/project/node_modules/lightningcss-wasm/node_modules/napi-wasm/package.json',
      ),
    ).toBe(bundledNapiManifest);
    expect(
      await vfs.readFileText(
        '/project/node_modules/lightningcss-wasm/node_modules/napi-wasm/index.js',
      ),
    ).toBe(bundledNapiIndex);
    await expect(vfs.exists('/project/node_modules/napi-wasm')).resolves.toBe(false);
    expect(registry.packumentReads).toEqual([lightningAcquisition.name]);
    expect(registry.tarballReads).toEqual([lightningSourceUrl]);
    for (const file of lightningRecipe.materialization.files) {
      expect(await vfs.readFileText(`/project/node_modules/lightningcss/${file.path}`)).toBe(
        file.content,
      );
    }
    await expect(vfs.exists('/project/node_modules/.bin/lightningcss')).resolves.toBe(false);
    await expect(vfs.exists('/project/node_modules/.bin/acquired-only')).resolves.toBe(false);

    const esbuildRecipe = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'esbuild',
    );
    if (!esbuildRecipe) throw new Error('builtin esbuild recipe is missing');
    expect(result.lockfile.packages['node_modules/esbuild']).toMatchObject({
      bin: esbuildRecipe.materialization.bin,
      riftyShadowRecipe: esbuildRecipe.id,
    });
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n",
    );
  });

  it('replays a pre-seeded v2 LightningCSS + esbuild tree, bins, and lock with zero registry reads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    const dependencies = { lightningcss: '1.32.0', esbuild: '0.28.0' };
    const source = await lightningEntry();
    const lockfile = desiredShadowReplayLock(source);
    await writeReplaySeed(vfs, dependencies, lockfile);
    const lockBefore = await vfs.readFile('/project/package-lock.json');
    const registry = new LedgerRegistry([]);
    registry.denyReads();
    const cache = new PreseededTarballCache([source]);

    const result = await installFixture(vfs, registry, dependencies, cache);

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect(cache.gets).toEqual(['lightningcss-wasm@1.32.0']);
    expect(cache.puts).toEqual([]);
    expect(await snapshotTree(vfs, '/project/node_modules')).toEqual(
      expectedShadowReplayTree(source),
    );
    expect(result.lockfile).toEqual(lockfile);
    expect(JSON.parse(await vfs.readFileText('/project/package-lock.json'))).toEqual(lockfile);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });
});

describe('npm 11 peer placement oracle', () => {
  it.each(peerSuccessCases)(
    '$label traverses and places the SHA-pinned npm graph',
    async (testCase) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await peerRegistry();
      const first = await installFixture(vfs, registry, testCase.dependencies);
      const oracle = oraclePackages(testCase.oracleCase);

      expect
        .soft(Object.keys(first.lockfile.packages).sort(), `${testCase.label} lock paths`)
        .toEqual(Object.keys(oracle).sort());
      for (const [path, pinned] of Object.entries(oracle)) {
        if (path === '') continue;
        expect.soft(first.lockfile.packages[path], path).toMatchObject({
          version: pinned.version,
          ...(pinned.peer ? { peer: true } : {}),
        });
        expect.soft(await vfs.exists(`/project/${path}/package.json`), path).toBe(true);
      }
    },
  );

  it.each(peerSuccessCases)(
    '$label replays its pre-seeded exact tree and lock without registry reads',
    async (testCase) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const entries = await peerEntries();
      const lockfile = desiredPeerReplayLock(testCase.oracleCase, entries);
      const vfs = new MemoryVfs();
      await writeReplaySeed(vfs, testCase.dependencies, lockfile);
      const lockBefore = await vfs.readFile('/project/package-lock.json');
      const registry = new LedgerRegistry([]);
      registry.denyReads();
      const cache = new PreseededTarballCache(entries);

      const result = await installFixture(vfs, registry, testCase.dependencies, cache);

      expect(registry.packumentReads).toEqual([]);
      expect(registry.tarballReads).toEqual([]);
      expect(cache.puts).toEqual([]);
      expect(await snapshotTree(vfs, '/project/node_modules')).toEqual(
        expectedPeerReplayTree(testCase.oracleCase, entries),
      );
      expect(result.lockfile).toEqual(lockfile);
      expect(JSON.parse(await vfs.readFileText('/project/package-lock.json'))).toEqual(lockfile);
      expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
    },
  );

  it('rejects a direct conflicting root peer with ERESOLVE before writes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await peerRegistry();

    const outcome = await installFixture(vfs, registry, {
      'contract-source': '1.0.0',
      'contract-peer': '1.0.0',
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect
      .soft('error' in outcome ? outcome.error : outcome.value, 'direct peer conflict')
      .toMatchObject({ code: 'ERESOLVE' });
    expect.soft(registry.tarballReads, 'direct conflict tarballs').toEqual([]);
    expect.soft(await vfs.exists('/project/node_modules'), 'direct conflict tree').toBe(false);
    expect.soft(await vfs.exists('/project/package-lock.json'), 'direct conflict lock').toBe(false);
  });
});
