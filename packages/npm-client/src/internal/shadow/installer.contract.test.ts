import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotImplementedError } from '@riftydev/io';
import {
  builtinShadowSubstitutionCatalog,
  shadowDigest,
  shadowSha256,
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
import {
  type InstallOptions,
  type ShadowInstallAuthority,
  install,
  installWithShadowAuthority,
} from '../../installer.ts';
import type { Lockfile, LockfileEntry } from '../../linker.ts';
import type { Packument, VersionManifest } from '../../registry.ts';
import { RegistryClient } from '../../registry.ts';
import { shadowAssetPlanForInstallResult } from './install-result.ts';
import { planShadowSubstitutionsFromLockfile } from './planner.ts';

class RejectingRegistry extends RegistryClient {
  reads = 0;

  constructor() {
    super({ baseUrl: '/must-not-read', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(_name: string): Promise<Packument> {
    this.reads += 1;
    throw new Error('synthetic esbuild must not read registry metadata');
  }

  override async getTarball(_url: string): Promise<Uint8Array> {
    this.reads += 1;
    throw new Error('synthetic esbuild must not read a registry tarball');
  }
}

class LightningRegistry extends RegistryClient {
  readonly #tarball: Uint8Array;
  readonly #fields: Readonly<
    Pick<VersionManifest, 'dependencies' | 'optionalDependencies' | 'peerDependencies'>
  >;
  tarballReads = 0;

  constructor(
    tarball: Uint8Array,
    fields: Readonly<
      Pick<VersionManifest, 'dependencies' | 'optionalDependencies' | 'peerDependencies'>
    >,
  ) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.#tarball = tarball;
    this.#fields = fields;
  }

  override async getPackument(name: string): Promise<Packument> {
    if (name !== 'lightningcss-wasm') throw new Error(`unexpected registry package ${name}`);
    const manifest: VersionManifest = {
      name,
      version: '1.32.0',
      ...this.#fields,
      dist: { tarball: 'https://registry.test/lightningcss-wasm-1.32.0.tgz' },
    };
    return {
      name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads += 1;
    if (url !== 'https://registry.test/lightningcss-wasm-1.32.0.tgz') {
      throw new Error(`unexpected registry tarball ${url}`);
    }
    return this.#tarball.slice();
  }
}

async function lightningRegistry(
  fields: Readonly<
    Pick<VersionManifest, 'dependencies' | 'optionalDependencies' | 'peerDependencies'>
  > = {},
): Promise<LightningRegistry> {
  const packageJson = new TextEncoder().encode(
    JSON.stringify({ name: 'lightningcss-wasm', version: '1.32.0' }),
  );
  return new LightningRegistry(
    await gzip(
      concat(
        buildHeader('package/package.json', packageJson.length),
        padToBlock(packageJson),
        TAR_TRAILER,
      ),
    ),
    fields,
  );
}

const CONTRACT_TRIGGER = 'contract-package';
const CONTRACT_SOURCE = 'contract-source';
const CONTRACT_ORDINARY_HOST = 'contract-ordinary-host';
const CONTRACT_VERSION = '1.100.0';
const CONTRACT_REQUIRED = '@scope/required';
const CONTRACT_RETAINED = '@scope/retained';
const CONTRACT_OMITTED = '@scope/omitted';
const CONTRACT_PEER = '@scope/peer';
const CONTRACT_DEPENDENCIES = { [CONTRACT_REQUIRED]: '1.0.0' };
const CONTRACT_OPTIONAL_DEPENDENCIES = {
  [CONTRACT_RETAINED]: '1.0.0',
  [CONTRACT_OMITTED]: '1.0.0',
};
const CONTRACT_PEER_DEPENDENCIES = { [CONTRACT_PEER]: '^1.0.0' };
const CONTRACT_BIN = { contract: 'bin/contract.js' };
const CONTRACT_MATERIALIZATION_PATHS = ['bin/contract.js', 'index.js', 'package.json'] as const;
const CONTRACT_TRAVERSED_PACKAGES = [CONTRACT_REQUIRED, CONTRACT_RETAINED, CONTRACT_PEER] as const;
const CONTRACT_PROJECTION_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const CONTRACT_PARTIAL_WRITE_CASES = [
  ['registry alias', 'permission'],
  ['registry alias', 'quota'],
  ['shared bin', 'permission'],
  ['shared bin', 'quota'],
] as const;
const CONTRACT_LAUNCHER = "#!/usr/bin/env node\nimport('../contract-package/bin/contract.js');\n";

const CONTRACT_PLACEMENTS = [
  {
    label: 'root',
    dependencies: { [CONTRACT_TRIGGER]: CONTRACT_VERSION },
    acquisitionPath: 'node_modules/contract-source',
    materializationRoot: '/project/node_modules/contract-package',
    launcherPath: '/project/node_modules/.bin/contract',
  },
  {
    label: 'nested',
    dependencies: {
      [CONTRACT_SOURCE]: '1.99.0',
      'contract-host': '1.0.0',
    },
    acquisitionPath: 'node_modules/contract-host/node_modules/contract-source',
    materializationRoot: '/project/node_modules/contract-host/node_modules/contract-package',
    launcherPath: '/project/node_modules/contract-host/node_modules/.bin/contract',
  },
] as const;

const CONTRACT_COLLISION_PLACEMENTS = [
  {
    label: 'root recipe and nested ordinary package',
    dependencies: {
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
      [CONTRACT_ORDINARY_HOST]: '1.0.0',
    },
    acquisitionPath: 'node_modules/contract-source',
    materializationRoot: '/project/node_modules/contract-package',
    materializationLockPath: 'node_modules/contract-package',
    materializationLauncherDir: '/project/node_modules/.bin',
    ordinaryRoot: '/project/node_modules/contract-ordinary-host/node_modules/contract-package',
    ordinaryLockPath: 'node_modules/contract-ordinary-host/node_modules/contract-package',
    ordinaryLauncherDir: '/project/node_modules/contract-ordinary-host/node_modules/.bin',
  },
  {
    label: 'root recipe declared after its ordinary host',
    dependencies: {
      [CONTRACT_ORDINARY_HOST]: '1.0.0',
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
    },
    acquisitionPath: 'node_modules/contract-source',
    materializationRoot: '/project/node_modules/contract-package',
    materializationLockPath: 'node_modules/contract-package',
    materializationLauncherDir: '/project/node_modules/.bin',
    ordinaryRoot: '/project/node_modules/contract-ordinary-host/node_modules/contract-package',
    ordinaryLockPath: 'node_modules/contract-ordinary-host/node_modules/contract-package',
    ordinaryLauncherDir: '/project/node_modules/contract-ordinary-host/node_modules/.bin',
  },
  {
    label: 'root ordinary package and nested recipe',
    dependencies: {
      [CONTRACT_ORDINARY_HOST]: '1.0.0',
      'contract-host': '1.0.0',
    },
    acquisitionPath: 'node_modules/contract-host/node_modules/contract-source',
    materializationRoot: '/project/node_modules/contract-host/node_modules/contract-package',
    materializationLockPath: 'node_modules/contract-host/node_modules/contract-package',
    materializationLauncherDir: '/project/node_modules/contract-host/node_modules/.bin',
    ordinaryRoot: '/project/node_modules/contract-package',
    ordinaryLockPath: 'node_modules/contract-package',
    ordinaryLauncherDir: '/project/node_modules/.bin',
  },
] as const;

const CONTRACT_MATERIALIZATION_BIN_CASES = [
  ['non-empty bin map', CONTRACT_BIN],
  ['empty bin map', {}],
] as const;

const CONTRACT_FLAT_HOST = 'contract-flat-host';
const CONTRACT_ORDINARY_ALIAS = 'contract-ordinary-alias';
const CONTRACT_SAME_PARENT_COLLISIONS = [
  {
    label: 'recipe first',
    host: 'contract-collision-recipe-first',
    dependencies: {
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
      [CONTRACT_ORDINARY_ALIAS]: '1.0.0',
    },
  },
  {
    label: 'ordinary first',
    host: 'contract-collision-ordinary-first',
    dependencies: {
      [CONTRACT_ORDINARY_ALIAS]: '1.0.0',
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
    },
  },
] as const;

const LIGHTNING_ORDINARY_HOST = 'lightning-ordinary-host';
const LIGHTNING_RECIPE_HOST = 'lightning-recipe-host';
const LIGHTNING_COLLISION_PLACEMENTS = [
  {
    label: 'root',
    dependencies: {
      lightningcss: '1.32.0',
      [LIGHTNING_ORDINARY_HOST]: '1.0.0',
    },
    acquisitionPath: 'node_modules/lightningcss-wasm',
    materializationRoot: '/project/node_modules/lightningcss',
    materializationLockPath: 'node_modules/lightningcss',
    materializationLauncherDir: '/project/node_modules/.bin',
    ordinaryRoot: '/project/node_modules/lightning-ordinary-host/node_modules/lightningcss',
    ordinaryLockPath: 'node_modules/lightning-ordinary-host/node_modules/lightningcss',
    ordinaryLauncherDir: '/project/node_modules/lightning-ordinary-host/node_modules/.bin',
  },
  {
    label: 'root declared after its ordinary host',
    dependencies: {
      [LIGHTNING_ORDINARY_HOST]: '1.0.0',
      lightningcss: '1.32.0',
    },
    acquisitionPath: 'node_modules/lightningcss-wasm',
    materializationRoot: '/project/node_modules/lightningcss',
    materializationLockPath: 'node_modules/lightningcss',
    materializationLauncherDir: '/project/node_modules/.bin',
    ordinaryRoot: '/project/node_modules/lightning-ordinary-host/node_modules/lightningcss',
    ordinaryLockPath: 'node_modules/lightning-ordinary-host/node_modules/lightningcss',
    ordinaryLauncherDir: '/project/node_modules/lightning-ordinary-host/node_modules/.bin',
  },
  {
    label: 'nested',
    dependencies: {
      [LIGHTNING_ORDINARY_HOST]: '1.0.0',
      [LIGHTNING_RECIPE_HOST]: '1.0.0',
    },
    acquisitionPath: 'node_modules/lightning-recipe-host/node_modules/lightningcss-wasm',
    materializationRoot: '/project/node_modules/lightning-recipe-host/node_modules/lightningcss',
    materializationLockPath: 'node_modules/lightning-recipe-host/node_modules/lightningcss',
    materializationLauncherDir: '/project/node_modules/lightning-recipe-host/node_modules/.bin',
    ordinaryRoot: '/project/node_modules/lightningcss',
    ordinaryLockPath: 'node_modules/lightningcss',
    ordinaryLauncherDir: '/project/node_modules/.bin',
  },
] as const;

function freezeFixture<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeFixture(child);
    Object.freeze(value);
  }
  return value;
}

function contractFile(path: string, content: string) {
  return {
    path,
    content,
    sha256: shadowSha256(content),
    bytes: new TextEncoder().encode(content).byteLength,
  };
}

function contractAuthority(
  admissionKind: 'exact-only' | 'semver-admits' = 'exact-only',
  materializationBin: Readonly<Record<string, string>> = CONTRACT_BIN,
): ShadowInstallAuthority {
  const packageJson = JSON.stringify({
    name: CONTRACT_TRIGGER,
    version: CONTRACT_VERSION,
    ...(Object.keys(materializationBin).length === 0 ? {} : { bin: materializationBin }),
  });
  const recipePayload = {
    schema: 2 as const,
    id: 'rifty.shadow-substitution.contract-package.v2',
    admission: {
      kind: admissionKind,
      unsupportedFeature: 'contract-package.version',
    },
    trigger: { name: CONTRACT_TRIGGER, version: CONTRACT_VERSION },
    acquisition: {
      kind: 'registry' as const,
      name: CONTRACT_SOURCE,
      version: CONTRACT_VERSION,
      dependencyProjection: {
        dependencies: CONTRACT_DEPENDENCIES,
        optionalDependencies: { [CONTRACT_RETAINED]: '1.0.0' },
        omittedOptionalDependencies: { [CONTRACT_OMITTED]: '1.0.0' },
        peerDependencies: CONTRACT_PEER_DEPENDENCIES,
        unsupportedFeature: 'contract-package.acquisitionDependencies',
      },
    },
    materialization: {
      name: CONTRACT_TRIGGER,
      version: CONTRACT_VERSION,
      bin: { ...materializationBin },
      files: [
        contractFile(
          'bin/contract.js',
          '#!/usr/bin/env node\nthrow new Error("contract materialized bin");\n',
        ),
        contractFile('index.js', 'module.exports = "contract";\n'),
        contractFile('package.json', packageJson),
      ],
    },
  };
  const recipe = { ...recipePayload, digest: shadowDigest(recipePayload) };
  const catalogPayload = {
    schema: 2 as const,
    id: 'rifty.shadow-substitutions.contract.v2',
    recipes: [recipe],
    assets: [],
  };
  const catalog = { ...catalogPayload, digest: shadowDigest(catalogPayload) };
  return freezeFixture({
    catalog,
    builtinOverrides: { [CONTRACT_TRIGGER]: `${CONTRACT_SOURCE}@${CONTRACT_VERSION}` },
  }) as unknown as ShadowInstallAuthority;
}

interface ContractRegistryEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

type ContractManifestFields = Readonly<
  Pick<VersionManifest, 'dependencies' | 'optionalDependencies' | 'peerDependencies' | 'bin'>
>;

async function contractRegistryEntry(
  name: string,
  version: string,
  fields: Partial<ContractManifestFields> = {},
  files: Readonly<Record<string, string>> = {},
): Promise<ContractRegistryEntry> {
  const chunks: Uint8Array[] = [];
  const packageJson = JSON.stringify({ name, version, ...fields });
  for (const [path, content] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = new TextEncoder().encode(content);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return {
    manifest: {
      name,
      version,
      ...fields,
      dist: { tarball: `https://registry.test/${encodeURIComponent(name)}-${version}.tgz` },
    },
    tarball: await gzip(concat(...chunks, TAR_TRAILER)),
  };
}

class ContractRegistry extends RegistryClient {
  readonly #entries: ReadonlyMap<string, ReadonlyMap<string, ContractRegistryEntry>>;
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];

  constructor(entries: ReadonlyMap<string, ReadonlyMap<string, ContractRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.#entries = entries;
  }

  resetReads(): void {
    this.packumentReads.length = 0;
    this.tarballReads.length = 0;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    const entries = this.#entries.get(name);
    if (!entries) throw new Error(`contract registry: no packument for ${name}`);
    const versions: Record<string, VersionManifest> = {};
    for (const [version, entry] of entries) versions[version] = entry.manifest;
    return {
      name,
      'dist-tags': { latest: [...entries.keys()].sort().at(-1) ?? '0.0.0' },
      versions,
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads.push(url);
    for (const versions of this.#entries.values()) {
      for (const entry of versions.values()) {
        if (entry.manifest.dist.tarball === url) return entry.tarball.slice();
      }
    }
    throw new Error(`contract registry: no tarball for ${url}`);
  }
}

async function contractRegistry(
  sourceFields: Partial<ContractManifestFields> = {},
): Promise<ContractRegistry> {
  const entries = new Map<string, Map<string, ContractRegistryEntry>>();
  const add = (entry: ContractRegistryEntry): void => {
    const versions = entries.get(entry.manifest.name) ?? new Map();
    versions.set(entry.manifest.version, entry);
    entries.set(entry.manifest.name, versions);
  };
  add(
    await contractRegistryEntry(
      CONTRACT_SOURCE,
      CONTRACT_VERSION,
      {
        dependencies: CONTRACT_DEPENDENCIES,
        optionalDependencies: CONTRACT_OPTIONAL_DEPENDENCIES,
        peerDependencies: CONTRACT_PEER_DEPENDENCIES,
        bin: { contract: 'bin/source.js' },
        ...sourceFields,
      },
      { 'bin/source.js': '#!/usr/bin/env node\nthrow new Error("acquired bin");\n' },
    ),
  );
  add(await contractRegistryEntry(CONTRACT_SOURCE, '1.99.0'));
  add(
    await contractRegistryEntry(
      'contract-host',
      '1.0.0',
      { dependencies: { [CONTRACT_TRIGGER]: CONTRACT_VERSION } },
      { 'index.js': 'module.exports = "host";\n' },
    ),
  );
  add(
    await contractRegistryEntry(
      CONTRACT_ORDINARY_HOST,
      '1.0.0',
      { dependencies: { [CONTRACT_TRIGGER]: CONTRACT_VERSION } },
      { 'index.js': 'module.exports = "ordinary-host";\n' },
    ),
  );
  for (const version of ['1.98.0', '1.99.0', CONTRACT_VERSION]) {
    add(
      await contractRegistryEntry(
        CONTRACT_TRIGGER,
        version,
        { bin: { ordinary: 'bin/ordinary.js' } },
        {
          'bin/ordinary.js': '#!/usr/bin/env node\nthrow new Error("ordinary bin");\n',
          'sentinel.txt': `ordinary package ${version} bytes\n`,
        },
      ),
    );
  }
  add(
    await contractRegistryEntry(CONTRACT_FLAT_HOST, '1.0.0', {
      dependencies: { [CONTRACT_TRIGGER]: '1.99.0' },
    }),
  );
  for (const collision of CONTRACT_SAME_PARENT_COLLISIONS) {
    add(
      await contractRegistryEntry(collision.host, '1.0.0', {
        dependencies: collision.dependencies,
      }),
    );
  }
  for (const name of [CONTRACT_REQUIRED, CONTRACT_RETAINED, CONTRACT_OMITTED, CONTRACT_PEER]) {
    add(await contractRegistryEntry(name, '1.0.0'));
  }
  return new ContractRegistry(entries);
}

async function lightningCollisionRegistry(): Promise<ContractRegistry> {
  const entries = new Map<string, Map<string, ContractRegistryEntry>>();
  const add = (entry: ContractRegistryEntry): void => {
    const versions = entries.get(entry.manifest.name) ?? new Map();
    versions.set(entry.manifest.version, entry);
    entries.set(entry.manifest.name, versions);
  };
  add(
    await contractRegistryEntry('lightningcss-wasm', '1.32.0', {
      dependencies: { 'napi-wasm': '^1.0.1' },
    }),
  );
  add(await contractRegistryEntry('napi-wasm', '1.1.3'));
  add(
    await contractRegistryEntry(
      'lightningcss',
      '1.32.0',
      { bin: { realcss: 'bin/real.js' } },
      {
        'bin/real.js': '#!/usr/bin/env node\nthrow new Error("real lightningcss bin");\n',
        'sentinel.txt': 'ordinary lightningcss bytes\n',
      },
    ),
  );
  for (const host of [LIGHTNING_ORDINARY_HOST, LIGHTNING_RECIPE_HOST]) {
    add(
      await contractRegistryEntry(
        host,
        '1.0.0',
        { dependencies: { lightningcss: '1.32.0' } },
        { 'index.js': `module.exports = ${JSON.stringify(host)};\n` },
      ),
    );
  }
  return new ContractRegistry(entries);
}

async function installContract(
  vfs: MemoryVfs,
  registry: ContractRegistry,
  dependencies: Readonly<Record<string, string>>,
  transport: Partial<
    Pick<
      InstallOptions,
      | 'onSubstitution'
      | 'overrides'
      | 'resolverUrl'
      | 'resolverClosureHash'
      | 'resolverBundleBaseUrl'
    >
  > = {},
  authority: ShadowInstallAuthority = contractAuthority(),
) {
  return await installWithShadowAuthority(
    {
      rootName: 'fixture',
      rootVersion: '1.0.0',
      dependencies: { ...dependencies },
      opts: {
        vfs,
        cwd: '/project',
        registry,
        onSubstitution: () => {},
        ...transport,
      },
    },
    authority,
  );
}

async function snapshotContractMaterialization(
  vfs: MemoryVfs,
  root: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
  return new Map(
    await Promise.all(
      CONTRACT_MATERIALIZATION_PATHS.map(
        async (path) => [path, await vfs.readFile(`${root}/${path}`)] as const,
      ),
    ),
  );
}

async function damageContractMaterialization(vfs: MemoryVfs, root: string): Promise<void> {
  const [corrupt, ...missing] = CONTRACT_MATERIALIZATION_PATHS;
  await vfs.writeFile(`${root}/${corrupt}`, 'corrupt');
  for (const path of missing) await vfs.rm(`${root}/${path}`);
}

async function expectContractMaterialization(
  vfs: MemoryVfs,
  root: string,
  expected: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  for (const path of CONTRACT_MATERIALIZATION_PATHS) {
    const restored = await vfs.readFile(`${root}/${path}`);
    const before = expected.get(path);
    if (!before) throw new Error(`missing contract materialization snapshot ${path}`);
    expect(restored, path).toEqual(before);
    expect(shadowSha256(restored), path).toBe(shadowSha256(before));
  }
}

async function expectContractRecipeMaterialization(vfs: MemoryVfs, root: string): Promise<void> {
  const recipe = contractAuthority().catalog.recipes.find(
    (candidate) => candidate.trigger.name === CONTRACT_TRIGGER,
  );
  if (!recipe) throw new Error('contract authority recipe missing');
  for (const file of recipe.materialization.files) {
    const restored = await vfs.readFile(`${root}/${file.path}`);
    expect(restored.byteLength, file.path).toBe(file.bytes);
    expect(shadowSha256(restored), file.path).toBe(file.sha256);
  }
}

function partialWriteData(data: Uint8Array | string): Uint8Array | string {
  const length = typeof data === 'string' ? data.length : data.byteLength;
  const end = Math.max(1, Math.floor(length / 2));
  return data.slice(0, end);
}

function storageWriteFault(kind: 'permission' | 'quota'): Error {
  return Object.assign(new Error(`${kind} partial write`), {
    name: kind === 'quota' ? 'QuotaExceededError' : 'NotAllowedError',
    code: kind === 'quota' ? 'EDQUOT' : 'EACCES',
  });
}

interface PeerTraversalEvidence {
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly freshPeerInstalled: boolean;
  readonly freshPeerLocked: boolean;
  readonly replayPeerRestored: boolean;
  readonly replayLockStable: boolean;
}

const PEER_ORACLE_NODE_VERSION = 'v24.16.0';
const PEER_ORACLE_NPM_VERSION = '11.17.0';

function runNativeNpm(cwd: string, cache: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'npm',
      [...args],
      {
        cwd,
        env: { ...process.env, npm_config_cache: cache },
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`native npm failed: ${String(stderr).trim() || error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

// Live differential pinned 2026-07-26; version drift must re-probe, never silently bless.
async function nativePeerTraversalEvidence(): Promise<PeerTraversalEvidence> {
  const root = mkdtempSync(join(tmpdir(), 'rifty-shadow-peer-oracle-'));
  const source = join(root, 'packages/source');
  const cache = join(root, '.npm-cache');
  const peerPackageJson = new TextEncoder().encode(
    `${JSON.stringify({ name: CONTRACT_PEER, version: '1.0.0' })}\n`,
  );
  const peerTarball = await gzip(
    concat(
      buildHeader('package/package.json', peerPackageJson.length),
      padToBlock(peerPackageJson),
      TAR_TRAILER,
    ),
  );
  let registryOrigin = '';
  const registry = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', registryOrigin).pathname);
    if (pathname === `/${CONTRACT_PEER}`) {
      const body = JSON.stringify({
        name: CONTRACT_PEER,
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: CONTRACT_PEER,
            version: '1.0.0',
            dist: {
              tarball: `${registryOrigin}/${CONTRACT_PEER}/-/peer-1.0.0.tgz`,
            },
          },
        },
      });
      response.writeHead(200, {
        'content-length': String(Buffer.byteLength(body)),
        'content-type': 'application/json',
      });
      response.end(body);
      return;
    }
    if (pathname === `/${CONTRACT_PEER}/-/peer-1.0.0.tgz`) {
      response.writeHead(200, {
        'content-length': String(peerTarball.byteLength),
        'content-type': 'application/octet-stream',
      });
      response.end(peerTarball);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    registry.once('error', reject);
    registry.listen(0, '127.0.0.1', resolve);
  });
  const address = registry.address();
  if (address === null || typeof address === 'string') {
    throw new Error('native peer oracle registry did not bind a TCP address');
  }
  registryOrigin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  let registryOpen = true;
  const closeRegistry = async (): Promise<void> => {
    if (!registryOpen) return;
    registryOpen = false;
    await new Promise<void>((resolve, reject) => {
      registry.close((error) => (error ? reject(error) : resolve()));
    });
  };
  try {
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({
        name: 'shadow-peer-oracle',
        version: '1.0.0',
        private: true,
        dependencies: { [CONTRACT_TRIGGER]: 'file:packages/source' },
      })}\n`,
    );
    writeFileSync(
      join(source, 'package.json'),
      `${JSON.stringify({
        name: CONTRACT_TRIGGER,
        version: CONTRACT_VERSION,
        peerDependencies: CONTRACT_PEER_DEPENDENCIES,
      })}\n`,
    );
    const npmVersion = (await runNativeNpm(root, cache, ['--version'])).trim();
    const installArgs = [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `--registry=${registryOrigin}`,
    ] as const;

    await runNativeNpm(root, cache, installArgs);
    const lockPath = join(root, 'package-lock.json');
    const lockBefore = readFileSync(lockPath);
    const lock = JSON.parse(lockBefore.toString('utf8')) as {
      packages?: Readonly<
        Record<string, Readonly<{ version?: string; resolved?: string; link?: boolean }>>
      >;
    };
    const peerPath = join(root, 'node_modules/@scope/peer');
    const freshPeerInstalled = existsSync(join(peerPath, 'package.json'));
    const peerLock = lock.packages?.['node_modules/@scope/peer'];
    const freshPeerLocked =
      peerLock !== undefined &&
      (peerLock.version === '1.0.0' ||
        (peerLock.link === true &&
          peerLock.resolved !== undefined &&
          lock.packages?.[peerLock.resolved]?.version === '1.0.0'));

    rmSync(peerPath, { recursive: true, force: true });
    await closeRegistry();
    await runNativeNpm(root, cache, [...installArgs, '--offline']);

    return {
      nodeVersion: process.version,
      npmVersion,
      freshPeerInstalled,
      freshPeerLocked,
      replayPeerRestored: existsSync(join(peerPath, 'package.json')),
      replayLockStable: readFileSync(lockPath).equals(lockBefore),
    };
  } finally {
    await closeRegistry();
    rmSync(root, { recursive: true, force: true });
  }
}

async function freshLockfile(
  dependency: Readonly<Record<string, string>>,
  registry: RegistryClient,
): Promise<Lockfile> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return (
    await install('fixture', '1.0.0', dependency, {
      vfs,
      cwd: '/project',
      registry,
      onSubstitution: () => {},
    })
  ).lockfile;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function observeVfsReads(vfs: MemoryVfs): () => void {
  const reads = [
    vi.spyOn(vfs, 'readFile'),
    vi.spyOn(vfs, 'readFileText'),
    vi.spyOn(vfs, 'exists'),
    vi.spyOn(vfs, 'stat'),
    vi.spyOn(vfs, 'readdir'),
    vi.spyOn(vfs, 'openReadable'),
  ];
  return () => {
    for (const read of reads) {
      expect(read).not.toHaveBeenCalled();
      read.mockRestore();
    }
  };
}

function expectShadowTraceDrift(lockfile: Lockfile): void {
  let caught: unknown;
  try {
    planShadowSubstitutionsFromLockfile(lockfile);
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    code: 'EBROKENLOCK',
    reason: 'shadow-trace-drift',
  });
}

describe('shadow substitution installer boundary', () => {
  it('[fault: frozen-assumption] matches npm peer traversal and lock replay', async () => {
    const oracle = await nativePeerTraversalEvidence();
    const { nodeVersion, npmVersion, ...nativeBehavior } = oracle;
    expect({ nodeVersion, npmVersion }).toEqual({
      nodeVersion: PEER_ORACLE_NODE_VERSION,
      npmVersion: PEER_ORACLE_NPM_VERSION,
    });
    expect(nativeBehavior).toEqual({
      freshPeerInstalled: true,
      freshPeerLocked: true,
      replayPeerRestored: true,
      replayLockStable: true,
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const first = await installContract(vfs, registry, {
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
    });
    const lockPath = '/project/package-lock.json';
    const lockBefore = await vfs.readFile(lockPath);
    const peerPath = `/project/node_modules/${CONTRACT_PEER}`;
    const freshPeerInstalled = await vfs.exists(`${peerPath}/package.json`);
    const freshPeerLocked =
      first.lockfile.packages[`node_modules/${CONTRACT_PEER}`]?.version === '1.0.0';

    await vfs.rm(peerPath, { recursive: true, force: true });
    registry.resetReads();
    await installContract(vfs, registry, { [CONTRACT_TRIGGER]: CONTRACT_VERSION });
    const lockAfter = await vfs.readFile(lockPath);

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect({
      freshPeerInstalled,
      freshPeerLocked,
      replayPeerRestored: await vfs.exists(`${peerPath}/package.json`),
      replayLockStable:
        lockAfter.byteLength === lockBefore.byteLength &&
        lockAfter.every((byte, index) => byte === lockBefore[index]),
    }).toEqual(nativeBehavior);
  });

  it('preserves semver-admits policy through fresh and replay authority paths', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const authority = contractAuthority('semver-admits');

    const first = await installContract(
      vfs,
      registry,
      { [CONTRACT_TRIGGER]: '^1.100.0' },
      {},
      authority,
    );

    expect(first.lockfile.packages['node_modules/contract-package']).toMatchObject({
      version: CONTRACT_VERSION,
      riftyShadowRecipe: 'rifty.shadow-substitution.contract-package.v2',
    });
    expect(await vfs.readFileText('/project/node_modules/contract-package/index.js')).toBe(
      'module.exports = "contract";\n',
    );

    registry.resetReads();
    const replay = await installContract(
      vfs,
      registry,
      { [CONTRACT_TRIGGER]: '^1.100.0' },
      {},
      authority,
    );

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect(replay.lockfile.packages['node_modules/contract-package']).toMatchObject({
      version: CONTRACT_VERSION,
      riftyShadowRecipe: 'rifty.shadow-substitution.contract-package.v2',
    });
    expect(await vfs.readFileText('/project/node_modules/contract-package/index.js')).toBe(
      'module.exports = "contract";\n',
    );
  });

  it.each([null, 'latest', '*', '^1.100.0', '~1.100.0', '>=1.100.0'] as const)(
    '[fault: observable-order] exact-only %s rejects before acquisition or mutation',
    async (range) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await contractRegistry();
      const mkdir = vi.spyOn(vfs, 'mkdir');
      const writeFile = vi.spyOn(vfs, 'writeFile');
      const rm = vi.spyOn(vfs, 'rm');
      const assertNoVfsReads = observeVfsReads(vfs);

      await expect(
        installContract(vfs, registry, {
          [CONTRACT_TRIGGER]: range,
        } as unknown as Readonly<Record<string, string>>),
      ).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'contract-package.version',
      });

      expect(registry.packumentReads).toEqual([]);
      expect(registry.tarballReads).toEqual([]);
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      assertNoVfsReads();
      await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
      await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
    },
  );

  it('[fault: observable-order] exact-only rejects before Eddy pinned GET or POST', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolverFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Eddy must not start before exact admission'));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const mkdir = vi.spyOn(vfs, 'mkdir');
    const writeFile = vi.spyOn(vfs, 'writeFile');
    const rm = vi.spyOn(vfs, 'rm');
    const assertNoVfsReads = observeVfsReads(vfs);

    await expect(
      installContract(
        vfs,
        registry,
        { [CONTRACT_TRIGGER]: '^1.100.0' },
        {
          resolverUrl: 'https://eddy.test/resolve',
          resolverClosureHash: '0'.repeat(64),
          resolverBundleBaseUrl: 'https://eddy-cdn.test',
        },
      ),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'contract-package.version',
    });

    expect(resolverFetch).not.toHaveBeenCalled();
    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    assertNoVfsReads();
    await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
    await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
  });

  it.each([null, 'latest', '*', '^1.100.0', '~1.100.0', '>=1.100.0'] as const)(
    '[fault: observable-order] exact-only replay rejects %s without reads or mutation',
    async (range) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await contractRegistry();
      await installContract(vfs, registry, { [CONTRACT_TRIGGER]: CONTRACT_VERSION });
      const lockBefore = await vfs.readFile('/project/package-lock.json');
      const packageBefore = await vfs.readFile(
        '/project/node_modules/contract-package/package.json',
      );
      const launcherBefore = await vfs.readFile('/project/node_modules/.bin/contract');

      registry.resetReads();
      const resolverFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Eddy must not start during exact replay rejection'));
      const mkdir = vi.spyOn(vfs, 'mkdir');
      const writeFile = vi.spyOn(vfs, 'writeFile');
      const rm = vi.spyOn(vfs, 'rm');
      const assertNoVfsReads = observeVfsReads(vfs);
      await expect(
        installContract(
          vfs,
          registry,
          {
            [CONTRACT_TRIGGER]: range,
          } as unknown as Readonly<Record<string, string>>,
          {
            resolverUrl: 'https://eddy.test/resolve',
            resolverClosureHash: '0'.repeat(64),
            resolverBundleBaseUrl: 'https://eddy-cdn.test',
          },
        ),
      ).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'contract-package.version',
      });

      expect(resolverFetch).not.toHaveBeenCalled();
      expect(registry.packumentReads).toEqual([]);
      expect(registry.tarballReads).toEqual([]);
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      assertNoVfsReads();
      expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
      expect(await vfs.readFile('/project/node_modules/contract-package/package.json')).toEqual(
        packageBefore,
      );
      expect(await vfs.readFile('/project/node_modules/.bin/contract')).toEqual(launcherBefore);
    },
  );

  it.each([
    ['required', { dependencies: { [CONTRACT_REQUIRED]: '2.0.0' } }],
    [
      'retained optional',
      {
        optionalDependencies: {
          [CONTRACT_RETAINED]: '2.0.0',
          [CONTRACT_OMITTED]: '1.0.0',
        },
      },
    ],
    ['omitted optional', { optionalDependencies: { [CONTRACT_RETAINED]: '1.0.0' } }],
    ['peer', { peerDependencies: { [CONTRACT_PEER]: '^2.0.0' } }],
  ] as const)(
    '[fault: observable-order] rejects %s projection drift before tarball work',
    async (_label, fields) => {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await contractRegistry(fields);
      const mkdir = vi.spyOn(vfs, 'mkdir');
      const writeFile = vi.spyOn(vfs, 'writeFile');
      const rm = vi.spyOn(vfs, 'rm');

      await expect(
        installContract(vfs, registry, { [CONTRACT_TRIGGER]: CONTRACT_VERSION }),
      ).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'contract-package.acquisitionDependencies',
      });

      expect(registry.packumentReads).toEqual([CONTRACT_SOURCE]);
      expect(registry.tarballReads).toEqual([]);
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
      await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
    },
  );

  it('[fault: provenance-lie] traverses and replays the complete retained root projection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const writeFile = vi.spyOn(vfs, 'writeFile');

    const first = await installContract(vfs, registry, {
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
    });
    const launcherPath = '/project/node_modules/.bin/contract';
    const launcher = await vfs.readFileText(launcherPath);
    const lockBefore = await vfs.readFile('/project/package-lock.json');
    const installedNames = first.packages.map(({ name }) => name);

    expect(installedNames).toContain(CONTRACT_SOURCE);
    for (const name of CONTRACT_TRAVERSED_PACKAGES) expect(installedNames).toContain(name);
    expect(installedNames).not.toContain(CONTRACT_OMITTED);
    expect(registry.packumentReads).not.toContain(CONTRACT_OMITTED);
    expect(registry.tarballReads).toHaveLength(4);
    expect(first.lockfile.packages['node_modules/contract-source']).toMatchObject({
      dependencies: CONTRACT_DEPENDENCIES,
      optionalDependencies: { [CONTRACT_RETAINED]: '1.0.0' },
      peerDependencies: CONTRACT_PEER_DEPENDENCIES,
    });
    expect(first.lockfile.packages['node_modules/contract-source']).not.toHaveProperty('bin');
    expect(first.lockfile.packages['node_modules/contract-package']).toMatchObject({
      version: CONTRACT_VERSION,
      bin: CONTRACT_BIN,
      riftyShadowRecipe: 'rifty.shadow-substitution.contract-package.v2',
    });
    for (const name of CONTRACT_TRAVERSED_PACKAGES) {
      expect(first.lockfile.packages[`node_modules/${name}`], name).toBeDefined();
    }
    expect(first.lockfile.packages[`node_modules/${CONTRACT_OMITTED}`]).toBeUndefined();
    expect(launcher).toBe(CONTRACT_LAUNCHER);
    expect(writeFile.mock.calls.filter(([path]) => path === launcherPath)).toHaveLength(1);

    for (const name of CONTRACT_TRAVERSED_PACKAGES) {
      await vfs.rm(`/project/node_modules/${name}`, { recursive: true, force: true });
    }
    await vfs.rm(launcherPath);
    registry.resetReads();
    writeFile.mockClear();

    const replay = await installContract(vfs, registry, {
      [CONTRACT_TRIGGER]: CONTRACT_VERSION,
    });
    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    const replayedNames = replay.packages.map(({ name }) => name);
    for (const name of CONTRACT_TRAVERSED_PACKAGES) {
      expect(replayedNames, name).toContain(name);
      await expect(vfs.exists(`/project/node_modules/${name}/package.json`), name).resolves.toBe(
        true,
      );
    }
    await expect(vfs.exists(`/project/node_modules/${CONTRACT_OMITTED}`)).resolves.toBe(false);
    expect(await vfs.readFileText(launcherPath)).toBe(launcher);
    expect(writeFile.mock.calls.filter(([path]) => path === launcherPath)).toHaveLength(1);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });

  it('[fault: sibling-drift] traverses and replays the complete retained nested projection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const writeFile = vi.spyOn(vfs, 'writeFile');
    const dependencies = {
      [CONTRACT_SOURCE]: '1.99.0',
      'contract-host': '1.0.0',
    };

    const first = await installContract(vfs, registry, dependencies);
    const nestedSource = 'node_modules/contract-host/node_modules/contract-source';
    const nestedAlias = 'node_modules/contract-host/node_modules/contract-package';
    const launcherPath = '/project/node_modules/contract-host/node_modules/.bin/contract';
    const launcher = await vfs.readFileText(launcherPath);
    const lockBefore = await vfs.readFile('/project/package-lock.json');
    const installedNames = first.packages.map(({ name }) => name);

    for (const name of CONTRACT_TRAVERSED_PACKAGES) {
      expect(installedNames, name).toContain(name);
      expect(first.lockfile.packages[`node_modules/${name}`], name).toBeDefined();
    }
    expect(installedNames).not.toContain(CONTRACT_OMITTED);
    expect(registry.packumentReads).not.toContain(CONTRACT_OMITTED);
    expect(first.lockfile.packages[nestedSource]).toMatchObject({
      dependencies: CONTRACT_DEPENDENCIES,
      optionalDependencies: { [CONTRACT_RETAINED]: '1.0.0' },
      peerDependencies: CONTRACT_PEER_DEPENDENCIES,
    });
    expect(first.lockfile.packages[nestedSource]).not.toHaveProperty('bin');
    expect(first.lockfile.packages[nestedAlias]).toMatchObject({
      version: CONTRACT_VERSION,
      bin: CONTRACT_BIN,
      riftyShadowRecipe: 'rifty.shadow-substitution.contract-package.v2',
    });
    expect(first.lockfile.packages[`node_modules/${CONTRACT_OMITTED}`]).toBeUndefined();
    expect(launcher).toBe(CONTRACT_LAUNCHER);
    expect(writeFile.mock.calls.filter(([path]) => path === launcherPath)).toHaveLength(1);

    for (const name of CONTRACT_TRAVERSED_PACKAGES) {
      await vfs.rm(`/project/node_modules/${name}`, { recursive: true, force: true });
    }
    await vfs.rm(launcherPath);
    registry.resetReads();
    writeFile.mockClear();
    const replay = await installContract(vfs, registry, dependencies);

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect(replay.lockfile.packages[nestedSource]).not.toHaveProperty('bin');
    const replayedNames = replay.packages.map(({ name }) => name);
    for (const name of CONTRACT_TRAVERSED_PACKAGES) {
      expect(replayedNames, name).toContain(name);
      await expect(vfs.exists(`/project/node_modules/${name}/package.json`), name).resolves.toBe(
        true,
      );
    }
    await expect(vfs.exists(`/project/node_modules/${CONTRACT_OMITTED}`)).resolves.toBe(false);
    expect(await vfs.readFileText(launcherPath)).toBe(launcher);
    expect(writeFile.mock.calls.filter(([path]) => path === launcherPath)).toHaveLength(1);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });

  describe.each(CONTRACT_COLLISION_PLACEMENTS)(
    '[fault: provenance-lie] $label placement ownership',
    (placement) => {
      it.each(CONTRACT_MATERIALIZATION_BIN_CASES)(
        'keeps recipe and ordinary bytes, provenance, and %s disjoint through replay',
        async (_binLabel, materializationBin) => {
          vi.spyOn(console, 'warn').mockImplementation(() => {});
          const vfs = new MemoryVfs();
          await vfs.mkdir('/project', { recursive: true });
          const registry = await contractRegistry();
          const authority = contractAuthority('exact-only', materializationBin);
          const overrides = {
            [`${CONTRACT_ORDINARY_HOST}>${CONTRACT_TRIGGER}`]: `${CONTRACT_TRIGGER}@${CONTRACT_VERSION}`,
          };

          const first = await installContract(
            vfs,
            registry,
            placement.dependencies,
            { overrides },
            authority,
          );
          const recipeEntry = first.lockfile.packages[placement.materializationLockPath];
          const acquisitionEntry = first.lockfile.packages[placement.acquisitionPath];
          const ordinaryEntry = first.lockfile.packages[placement.ordinaryLockPath];
          if (!recipeEntry || !acquisitionEntry || !ordinaryEntry) {
            throw new Error(`collision fixture did not publish ${placement.label}`);
          }

          expect(await vfs.readFileText(`${placement.materializationRoot}/index.js`)).toBe(
            'module.exports = "contract";\n',
          );
          await expect(vfs.exists(`${placement.materializationRoot}/sentinel.txt`)).resolves.toBe(
            false,
          );
          expect(await vfs.readFileText(`${placement.ordinaryRoot}/sentinel.txt`)).toBe(
            'ordinary package 1.100.0 bytes\n',
          );
          expect(recipeEntry).toMatchObject({
            version: CONTRACT_VERSION,
            riftyShadowRecipe: 'rifty.shadow-substitution.contract-package.v2',
          });
          expect(recipeEntry).not.toHaveProperty('resolved');
          expect(recipeEntry).not.toHaveProperty('integrity');
          if (Object.keys(materializationBin).length === 0) {
            expect(recipeEntry).not.toHaveProperty('bin');
            await expect(
              vfs.exists(`${placement.materializationLauncherDir}/contract`),
            ).resolves.toBe(false);
          } else {
            expect(recipeEntry.bin).toEqual(CONTRACT_BIN);
            expect(await vfs.readFileText(`${placement.materializationLauncherDir}/contract`)).toBe(
              CONTRACT_LAUNCHER,
            );
          }
          expect(acquisitionEntry).not.toHaveProperty('bin');
          expect(ordinaryEntry).toMatchObject({
            version: CONTRACT_VERSION,
            bin: { ordinary: 'bin/ordinary.js' },
          });
          expect(ordinaryEntry).not.toHaveProperty('riftyShadowRecipe');
          expect(await vfs.readFileText(`${placement.ordinaryLauncherDir}/ordinary`)).toContain(
            '../contract-package/bin/ordinary.js',
          );
          await expect(
            vfs.exists(`${placement.materializationLauncherDir}/ordinary`),
          ).resolves.toBe(false);

          const lockBefore = await vfs.readFile('/project/package-lock.json');
          await vfs.rm(placement.materializationRoot, { recursive: true, force: true });
          await vfs.rm(placement.ordinaryRoot, { recursive: true, force: true });
          if (await vfs.exists(`${placement.materializationLauncherDir}/contract`)) {
            await vfs.rm(`${placement.materializationLauncherDir}/contract`);
          }
          await vfs.rm(`${placement.ordinaryLauncherDir}/ordinary`);
          registry.resetReads();

          await installContract(vfs, registry, placement.dependencies, { overrides }, authority);

          expect(registry.packumentReads).toEqual([]);
          expect(registry.tarballReads).toEqual([]);
          expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
          expect(await vfs.readFileText(`${placement.materializationRoot}/index.js`)).toBe(
            'module.exports = "contract";\n',
          );
          await expect(vfs.exists(`${placement.materializationRoot}/sentinel.txt`)).resolves.toBe(
            false,
          );
          expect(await vfs.readFileText(`${placement.ordinaryRoot}/sentinel.txt`)).toBe(
            'ordinary package 1.100.0 bytes\n',
          );
        },
      );
    },
  );

  describe.each(CONTRACT_SAME_PARENT_COLLISIONS)(
    '[fault: provenance-lie] same-parent $label materialization collision',
    (collision) => {
      it.each(CONTRACT_MATERIALIZATION_BIN_CASES)(
        'rejects distinct ordinary and recipe claims with %s before writes',
        async (_binLabel, materializationBin) => {
          vi.spyOn(console, 'warn').mockImplementation(() => {});
          const vfs = new MemoryVfs();
          await vfs.mkdir('/project', { recursive: true });
          const report: string[] = [];
          const registry = await contractRegistry();
          const installPath = `node_modules/${collision.host}/node_modules/${CONTRACT_TRIGGER}`;

          await expect(
            installContract(
              vfs,
              registry,
              {
                [CONTRACT_FLAT_HOST]: '1.0.0',
                [collision.host]: '1.0.0',
              },
              {
                overrides: {
                  [`${CONTRACT_FLAT_HOST}>${CONTRACT_TRIGGER}`]: `${CONTRACT_TRIGGER}@1.99.0`,
                  [`${collision.host}>${CONTRACT_ORDINARY_ALIAS}`]: `${CONTRACT_TRIGGER}@1.98.0`,
                },
                onSubstitution: (line) => report.push(line),
              },
              contractAuthority('exact-only', materializationBin),
            ),
          ).rejects.toMatchObject({
            code: 'EINSTALLPATHCONFLICT',
            installPath,
          });

          await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
          await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
          expect(
            report.filter((line) => line.includes('materialized from shadow registry')),
          ).toEqual([]);
        },
      );
    },
  );

  describe.each(CONTRACT_PLACEMENTS)(
    '[fault: provenance-lie] $label registry acquisition replay',
    (placement) => {
      it.each(CONTRACT_PROJECTION_FIELDS)(
        'rejects tampered %s before registry or VFS repair',
        async (field) => {
          vi.spyOn(console, 'warn').mockImplementation(() => {});
          const vfs = new MemoryVfs();
          await vfs.mkdir('/project', { recursive: true });
          const registry = await contractRegistry();
          const first = await installContract(vfs, registry, placement.dependencies);
          const lockfile = structuredClone(first.lockfile);
          const acquisition = lockfile.packages[placement.acquisitionPath];
          if (!acquisition) {
            throw new Error(`contract acquisition missing at ${placement.acquisitionPath}`);
          }
          const drift =
            field === 'dependencies'
              ? { [CONTRACT_REQUIRED]: '2.0.0' }
              : field === 'optionalDependencies'
                ? { [CONTRACT_RETAINED]: '2.0.0' }
                : { [CONTRACT_PEER]: '^2.0.0' };
          Reflect.set(acquisition, field, drift);
          await vfs.writeFile('/project/package-lock.json', JSON.stringify(lockfile));
          registry.resetReads();
          const writeFile = vi.spyOn(vfs, 'writeFile');

          await expect(
            installContract(vfs, registry, placement.dependencies),
          ).rejects.toMatchObject({
            code: 'EBROKENLOCK',
            reason: 'shadow-trace-drift',
          });

          expect(registry.packumentReads).toEqual([]);
          expect(registry.tarballReads).toEqual([]);
          expect(writeFile).not.toHaveBeenCalled();
        },
      );
    },
  );

  describe.each(CONTRACT_PLACEMENTS)(
    '[fault: quota-perm-fail/torn-state] $label materialization',
    (placement) => {
      it.each(CONTRACT_PARTIAL_WRITE_CASES)(
        'recovers exact bytes after %s %s partial write',
        async (writer, faultKind) => {
          vi.spyOn(console, 'warn').mockImplementation(() => {});
          const vfs = new MemoryVfs();
          await vfs.mkdir('/project', { recursive: true });
          const registry = await contractRegistry();
          const report: string[] = [];
          const faultPath =
            writer === 'registry alias'
              ? `${placement.materializationRoot}/index.js`
              : placement.launcherPath;
          const expectedLength =
            writer === 'registry alias'
              ? new TextEncoder().encode('module.exports = "contract";\n').byteLength
              : new TextEncoder().encode(CONTRACT_LAUNCHER).byteLength;
          const fault = storageWriteFault(faultKind);
          const writeFile = vfs.writeFile.bind(vfs);
          let injected = false;
          const writeSpy = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
            if (!injected && path === faultPath) {
              injected = true;
              await writeFile(path, partialWriteData(data));
              throw fault;
            }
            await writeFile(path, data);
          });

          await expect(
            installContract(vfs, registry, placement.dependencies, {
              onSubstitution: (line) => report.push(line),
            }),
          ).rejects.toBe(fault);

          expect(injected).toBe(true);
          const partial = await vfs.readFile(faultPath);
          expect(partial.byteLength).toBeGreaterThan(0);
          expect(partial.byteLength).toBeLessThan(expectedLength);
          expect(
            report.filter((line) => line.includes('materialized from shadow registry')),
          ).toEqual([]);
          await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);

          writeSpy.mockRestore();
          const retry = await installContract(vfs, registry, placement.dependencies);

          await expectContractRecipeMaterialization(vfs, placement.materializationRoot);
          expect(await vfs.readFileText(placement.launcherPath)).toBe(CONTRACT_LAUNCHER);
          expect(
            retry.lockfile.packages[placement.materializationRoot.slice('/project/'.length)],
          ).toMatchObject({
            version: CONTRACT_VERSION,
            bin: CONTRACT_BIN,
            riftyShadowRecipe: 'rifty.shadow-substitution.contract-package.v2',
          });
        },
      );
    },
  );

  it('[fault: poisoned-cache/provenance-lie] regenerates destroyed root registry materialization', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const writeFile = vi.spyOn(vfs, 'writeFile');
    await installContract(vfs, registry, { [CONTRACT_TRIGGER]: CONTRACT_VERSION });

    const materializationRoot = '/project/node_modules/contract-package';
    const materializationBefore = await snapshotContractMaterialization(vfs, materializationRoot);
    const launcherPath = '/project/node_modules/.bin/contract';
    const lockBefore = await vfs.readFile('/project/package-lock.json');
    await damageContractMaterialization(vfs, materializationRoot);
    await vfs.rm(launcherPath);
    registry.resetReads();
    writeFile.mockClear();

    await installContract(vfs, registry, { [CONTRACT_TRIGGER]: CONTRACT_VERSION });

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    await expectContractMaterialization(vfs, materializationRoot, materializationBefore);
    expect(await vfs.readFileText(launcherPath)).toBe(
      "#!/usr/bin/env node\nimport('../contract-package/bin/contract.js');\n",
    );
    expect(writeFile.mock.calls.filter(([path]) => path === launcherPath)).toHaveLength(1);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });

  it('[fault: poisoned-cache/provenance-lie] regenerates destroyed nested registry materialization', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await contractRegistry();
    const writeFile = vi.spyOn(vfs, 'writeFile');
    const dependencies = {
      [CONTRACT_SOURCE]: '1.99.0',
      'contract-host': '1.0.0',
    };
    await installContract(vfs, registry, dependencies);

    const materializationRoot = '/project/node_modules/contract-host/node_modules/contract-package';
    const materializationBefore = await snapshotContractMaterialization(vfs, materializationRoot);
    const launcherPath = '/project/node_modules/contract-host/node_modules/.bin/contract';
    const lockBefore = await vfs.readFile('/project/package-lock.json');
    await damageContractMaterialization(vfs, materializationRoot);
    await vfs.rm(launcherPath);
    registry.resetReads();
    writeFile.mockClear();

    await installContract(vfs, registry, dependencies);

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    await expectContractMaterialization(vfs, materializationRoot, materializationBefore);
    expect(await vfs.readFileText(launcherPath)).toBe(
      "#!/usr/bin/env node\nimport('../contract-package/bin/contract.js');\n",
    );
    expect(writeFile.mock.calls.filter(([path]) => path === launcherPath)).toHaveLength(1);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });

  it('materializes and lockfile-replays esbuild without registry acquisition', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const firstRegistry = new RejectingRegistry();

    const first = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      { vfs, cwd: '/project', registry: firstRegistry, onSubstitution: () => {} },
    );
    const firstMain = await vfs.readFile('/project/node_modules/esbuild/lib/main.cjs');
    const firstBin = await vfs.readFile('/project/node_modules/esbuild/bin/esbuild');
    const firstPackage = await vfs.readFile('/project/node_modules/esbuild/package.json');
    const plan = shadowAssetPlanForInstallResult(first);

    expect(firstRegistry.reads).toBe(0);
    expect(first.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });
    expect(first.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);
    expect(plan.bindings).toEqual([
      {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    ]);

    const replayRegistry = new RejectingRegistry();
    const replay = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      { vfs, cwd: '/project', registry: replayRegistry, onSubstitution: () => {} },
    );

    expect(replayRegistry.reads).toBe(0);
    expect(await vfs.readFile('/project/node_modules/esbuild/lib/main.cjs')).toEqual(firstMain);
    expect(await vfs.readFile('/project/node_modules/esbuild/bin/esbuild')).toEqual(firstBin);
    expect(await vfs.readFile('/project/node_modules/esbuild/package.json')).toEqual(firstPackage);
    expect(shadowAssetPlanForInstallResult(replay)).toEqual(plan);
  });

  it('rejects registry dependency drift before tarball acquisition', async () => {
    const registry = await lightningRegistry({ dependencies: { unexpected: '1.0.0' } });

    await expect(freshLockfile({ lightningcss: '1.32.0' }, registry)).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'lightningcss.acquisitionDependencies',
    });
    expect(registry.tarballReads).toBe(0);
  });

  it.each(LIGHTNING_COLLISION_PLACEMENTS)(
    '[fault: sibling-drift/provenance-lie] keeps LightningCSS $label recipe placement disjoint from an ordinary override',
    async (placement) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await lightningCollisionRegistry();
      const overrides = {
        [`${LIGHTNING_ORDINARY_HOST}>lightningcss`]: 'lightningcss@1.32.0',
      };
      const options = {
        vfs,
        cwd: '/project',
        registry,
        overrides,
        onSubstitution: () => {},
      } as const;

      const first = await install('fixture', '1.0.0', placement.dependencies, options);
      const recipeEntry = first.lockfile.packages[placement.materializationLockPath];
      const acquisitionEntry = first.lockfile.packages[placement.acquisitionPath];
      const ordinaryEntry = first.lockfile.packages[placement.ordinaryLockPath];
      if (!recipeEntry || !acquisitionEntry || !ordinaryEntry) {
        throw new Error(`LightningCSS collision fixture did not publish ${placement.label}`);
      }

      expect(await vfs.readFileText(`${placement.materializationRoot}/index.cjs`)).toBe(
        "module.exports = require('lightningcss-wasm');\n",
      );
      await expect(vfs.exists(`${placement.materializationRoot}/sentinel.txt`)).resolves.toBe(
        false,
      );
      expect(await vfs.readFileText(`${placement.ordinaryRoot}/sentinel.txt`)).toBe(
        'ordinary lightningcss bytes\n',
      );
      expect(recipeEntry).toMatchObject({
        version: '1.32.0',
        riftyShadowRecipe: 'rifty.shadow-substitution.lightningcss.v2',
      });
      expect(recipeEntry).not.toHaveProperty('resolved');
      expect(recipeEntry).not.toHaveProperty('integrity');
      expect(recipeEntry).not.toHaveProperty('bin');
      expect(acquisitionEntry).not.toHaveProperty('bin');
      expect(ordinaryEntry).toMatchObject({
        version: '1.32.0',
        bin: { realcss: 'bin/real.js' },
      });
      expect(ordinaryEntry).not.toHaveProperty('riftyShadowRecipe');
      await expect(vfs.exists(`${placement.materializationLauncherDir}/realcss`)).resolves.toBe(
        false,
      );
      expect(await vfs.readFileText(`${placement.ordinaryLauncherDir}/realcss`)).toContain(
        '../lightningcss/bin/real.js',
      );

      const lockBefore = await vfs.readFile('/project/package-lock.json');
      await vfs.rm(placement.materializationRoot, { recursive: true, force: true });
      await vfs.rm(placement.ordinaryRoot, { recursive: true, force: true });
      await vfs.rm(`${placement.ordinaryLauncherDir}/realcss`);
      registry.resetReads();

      await install('fixture', '1.0.0', placement.dependencies, options);

      expect(registry.packumentReads).toEqual([]);
      expect(registry.tarballReads).toEqual([]);
      expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
      expect(await vfs.readFileText(`${placement.materializationRoot}/index.cjs`)).toBe(
        "module.exports = require('lightningcss-wasm');\n",
      );
      await expect(vfs.exists(`${placement.materializationRoot}/sentinel.txt`)).resolves.toBe(
        false,
      );
      expect(await vfs.readFileText(`${placement.ordinaryRoot}/sentinel.txt`)).toBe(
        'ordinary lightningcss bytes\n',
      );
    },
  );

  it('[fault: torn-state] stops registry alias writes before success and retry reconciles exact bytes', async () => {
    const recipe = builtinShadowSubstitutionCatalog.recipes.find(
      (candidate) => candidate.trigger.name === 'lightningcss',
    );
    if (!recipe || recipe.acquisition.kind !== 'registry') {
      throw new Error('test fixture lacks the LightningCSS registry recipe');
    }
    const [first, ...remaining] = recipe.materialization.files;
    if (!first || remaining.length === 0) {
      throw new Error('test fixture needs multiple registry alias files');
    }

    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const controller = new AbortController();
    const abortReason = new Error('abort after first registry alias write');
    const report: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    const firstPath = `/project/node_modules/lightningcss/${first.path}`;
    const writeSpy = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      await writeFile(path, data);
      if (path === firstPath) controller.abort(abortReason);
    });

    await expect(
      install(
        'fixture',
        '1.0.0',
        { lightningcss: '^1.32.0' },
        {
          vfs,
          cwd: '/project',
          registry: await lightningCollisionRegistry(),
          signal: controller.signal,
          onSubstitution: (line) => report.push(line),
        },
      ),
    ).rejects.toBe(abortReason);

    for (const file of remaining) {
      await expect(
        vfs.exists(`/project/node_modules/lightningcss/${file.path}`),
        file.path,
      ).resolves.toBe(false);
    }
    await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
    expect(report.filter((line) => line.includes('materialized from shadow registry'))).toEqual([]);

    writeSpy.mockRestore();
    await vfs.writeFile(firstPath, 'torn');
    const retry = await install(
      'fixture',
      '1.0.0',
      { lightningcss: '^1.32.0' },
      {
        vfs,
        cwd: '/project',
        registry: await lightningCollisionRegistry(),
        onSubstitution: () => {},
      },
    );

    for (const file of recipe.materialization.files) {
      const bytes = await vfs.readFile(`/project/node_modules/lightningcss/${file.path}`);
      expect(bytes.byteLength, file.path).toBe(file.bytes);
      expect(shadowSha256(bytes), file.path).toBe(file.sha256);
    }
    expect(retry.lockfile.packages['node_modules/lightningcss']).toMatchObject({
      version: '1.32.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.lightningcss.v2',
    });
    expect(retry.lockfile.rifty?.shadowSubstitutions.protocol).toBe(
      'rifty.shadow-substitutions/v2',
    );
  });
});

describe('shadow substitution lockfile provenance', () => {
  let synthetic: Lockfile;
  let registry: Lockfile;

  beforeAll(async () => {
    synthetic = await freshLockfile({ esbuild: '^0.28.0' }, new RejectingRegistry());
    registry = await freshLockfile({ lightningcss: '^1.32.0' }, await lightningCollisionRegistry());
  });

  it.each([
    ['per-entry marker', false],
    ['reserved resolved identity', true],
  ] as const)('loudly names the missing trace when only a %s survives', (_label, removeMarker) => {
    const { rifty: _trace, ...withoutTrace } = structuredClone(synthetic);
    const entry = withoutTrace.packages['node_modules/esbuild'];
    if (!entry) throw new Error('fresh synthetic lockfile entry missing');
    // biome-ignore lint/performance/noDelete: corruption fixture must remove the field.
    if (removeMarker) delete entry.riftyShadowRecipe;

    let caught: unknown;
    try {
      planShadowSubstitutionsFromLockfile(withoutTrace);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toMatchObject({
      feature: 'npm-client.lockfile.shadowSubstitutionTrace',
    });
  });

  it.each([
    // biome-ignore lint/performance/noDelete: corruption fixture must remove the field.
    ['missing resolved sentinel', (entry: LockfileEntry) => delete entry.resolved],
    [
      'missing rifty scheme',
      (entry: LockfileEntry) => {
        entry.resolved = 'shadow-substitution/rifty.shadow-substitution.esbuild.v2';
      },
    ],
    [
      'forged URL',
      (entry: LockfileEntry) => {
        entry.resolved = 'https://registry.test/esbuild-0.28.0.tgz';
      },
    ],
    [
      'wrong recipe id',
      (entry: LockfileEntry) => {
        entry.resolved = `rifty:shadow-substitution/forged@${'0'.repeat(64)}`;
      },
    ],
    [
      'wrong recipe digest',
      (entry: LockfileEntry) => {
        entry.resolved = `rifty:shadow-substitution/rifty.shadow-substitution.esbuild.v2@${'0'.repeat(64)}`;
      },
    ],
    [
      'registry integrity',
      (entry: LockfileEntry) => {
        entry.integrity = `sha512-${btoa(String.fromCharCode(...new Uint8Array(64)))}`;
      },
    ],
  ] as const)('rejects synthetic entry provenance drift: %s', (_label, tamper) => {
    const lockfile = structuredClone(synthetic);
    const entry = lockfile.packages['node_modules/esbuild'];
    if (!entry) throw new Error('fresh synthetic lockfile entry missing');
    tamper(entry);

    expectShadowTraceDrift(lockfile);
  });

  it.each([
    [
      'missing materialized bin',
      (entry: LockfileEntry) => {
        // biome-ignore lint/performance/noDelete: corruption fixture removes recipe-owned data.
        delete entry.bin;
      },
    ],
    [
      'changed materialized bin',
      (entry: LockfileEntry) => {
        entry.bin = { esbuild: 'lib/main.cjs' };
      },
    ],
  ] as const)('rejects synthetic %s', (_label, tamper) => {
    const lockfile = structuredClone(synthetic);
    const entry = lockfile.packages['node_modules/esbuild'];
    if (!entry) throw new Error('fresh synthetic lockfile entry missing');
    tamper(entry);

    expectShadowTraceDrift(lockfile);
  });

  it('rejects a v1 shadow trace instead of reinterpreting it as v2', () => {
    const lockfile = structuredClone(synthetic);
    Reflect.set(
      lockfile.rifty?.shadowSubstitutions ?? {},
      'protocol',
      'rifty.shadow-substitutions/v1',
    );

    expectShadowTraceDrift(lockfile);
  });

  it.each([
    [
      'missing acquisition entry',
      (lockfile: Lockfile) => {
        // biome-ignore lint/performance/noDelete: corruption fixture must remove the entry.
        delete lockfile.packages['node_modules/lightningcss-wasm'];
      },
    ],
    [
      'wrong acquisition version',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/lightningcss-wasm'];
        if (entry) entry.version = '0.0.0';
      },
    ],
    [
      'wrong acquisition resolved URL',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/lightningcss-wasm'];
        if (entry) entry.resolved = 'https://registry.test/forged.tgz';
      },
    ],
    [
      'wrong acquisition integrity',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/lightningcss-wasm'];
        if (entry) entry.integrity = 'sha512-forged';
      },
    ],
  ] as const)('rejects registry acquisition provenance drift: %s', (_label, tamper) => {
    const lockfile = structuredClone(registry);
    tamper(lockfile);

    expectShadowTraceDrift(lockfile);
  });

  it.each([
    [
      'source bin',
      (entry: LockfileEntry) => {
        entry.bin = { leaked: 'bin/leaked' };
      },
    ],
    [
      'dependency projection',
      (entry: LockfileEntry) => {
        entry.dependencies = { unexpected: '1.0.0' };
      },
    ],
  ] as const)('rejects registry acquisition %s drift', (_label, tamper) => {
    const lockfile = structuredClone(registry);
    const acquisition = lockfile.packages['node_modules/lightningcss-wasm'];
    if (!acquisition) throw new Error('fresh registry acquisition entry missing');
    tamper(acquisition);

    expectShadowTraceDrift(lockfile);
  });

  it.each(['resolved', 'integrity'] as const)(
    'rejects forged %s provenance on the registry materialization alias',
    (field) => {
      const lockfile = structuredClone(registry);
      const alias = lockfile.packages['node_modules/lightningcss'];
      const acquisition = lockfile.packages['node_modules/lightningcss-wasm'];
      if (!alias || !acquisition) throw new Error('fresh registry lockfile entries missing');
      alias[field] = acquisition[field];

      expectShadowTraceDrift(lockfile);
    },
  );
});
