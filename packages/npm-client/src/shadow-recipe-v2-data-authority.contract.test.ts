import { NotImplementedError } from '@riftydev/io';
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
import * as npmClientRoot from './index.ts';
import { type InstallOptions, type InstallResult, install } from './installer.ts';
import * as npmClientInternal from './internal/index.ts';
import type { Lockfile } from './linker.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { type TarballCache, computeIntegrity } from './tarball-cache.ts';

const HOST = 'shadow-authority-host';

const RECIPES = [
  {
    name: 'esbuild',
    version: '0.28.0',
    supportedRange: '^0.28.0',
    unsupportedRange: '0.21.5',
    feature: 'esbuild.version',
  },
  {
    name: 'lightningcss',
    version: '1.32.0',
    supportedRange: '^1.32.0',
    unsupportedRange: '^2.0.0',
    feature: 'lightningcss.version',
  },
] as const;

type RecipeCase = (typeof RECIPES)[number];
type Shape = 'direct' | 'transitive';
type Source = 'fresh' | 'replay' | 'eddy';
type Outcome = 'supported' | 'unsupported';

interface MatrixCase {
  readonly recipe: RecipeCase;
  readonly shape: Shape;
  readonly source: Source;
  readonly outcome: Outcome;
  readonly title: string;
}

const CASES: MatrixCase[] = RECIPES.flatMap((recipe) =>
  (['direct', 'transitive'] as const).flatMap((shape) =>
    (['fresh', 'replay', 'eddy'] as const).flatMap((source) =>
      (['supported', 'unsupported'] as const).map((outcome) => ({
        recipe,
        shape,
        source,
        outcome,
        title: `${recipe.name} ${shape} ${source} ${outcome}`,
      })),
    ),
  ),
);

type FixtureManifest = VersionManifest & {
  readonly bundleDependencies?: readonly string[];
};

interface RegistryEntry {
  readonly manifest: FixtureManifest;
  readonly tarball: Uint8Array;
}

interface RegistryEntryOptions {
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly bundleDependencies?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
}

class InMemoryTarballCache implements TarballCache {
  readonly #entries = new Map<string, Uint8Array>();
  #events: string[];

  constructor(events: string[]) {
    this.#events = events;
  }

  recordTo(events: string[]): void {
    this.#events = events;
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.#events.push(`cache:get:${name}@${version}`);
    return this.#entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    this.#events.push(`cache:put:${name}@${version}`);
    this.#entries.set(`${name}\0${version}\0${integrity}`, bytes.slice());
    return `memory:${name}@${version}`;
  }
}

class LedgerRegistry extends RegistryClient {
  readonly #byName: ReadonlyMap<string, RegistryEntry>;
  readonly #byUrl: ReadonlyMap<string, RegistryEntry>;
  readonly #events: string[];

  constructor(entries: readonly RegistryEntry[], events: string[]) {
    super({ baseUrl: '/matrix-registry', fetch: async () => new Response('', { status: 599 }) });
    this.#byName = new Map(entries.map((entry) => [entry.manifest.name, entry]));
    this.#byUrl = new Map(entries.map((entry) => [entry.manifest.dist.tarball, entry]));
    this.#events = events;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.#events.push(`packument:${name}`);
    const entry = this.#byName.get(name);
    if (!entry) throw new Error(`matrix registry has no packument for ${name}`);
    return {
      name,
      'dist-tags': { latest: entry.manifest.version },
      versions: { [entry.manifest.version]: entry.manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const entry = this.#byUrl.get(url);
    if (!entry) throw new Error(`matrix registry has no tarball for ${url}`);
    this.#events.push(`tarball:${entry.manifest.name}`);
    return entry.tarball.slice();
  }
}

async function registryEntry(
  name: string,
  version: string,
  dependencies: Readonly<Record<string, string>> = {},
  options: RegistryEntryOptions = {},
): Promise<RegistryEntry> {
  const manifestFields = {
    name,
    version,
    dependencies: { ...dependencies },
    ...(options.optionalDependencies === undefined
      ? {}
      : { optionalDependencies: { ...options.optionalDependencies } }),
    ...(options.peerDependencies === undefined
      ? {}
      : { peerDependencies: { ...options.peerDependencies } }),
    ...(options.bundleDependencies === undefined
      ? {}
      : { bundleDependencies: [...options.bundleDependencies] }),
  };
  const chunks: Uint8Array[] = [];
  for (const [path, text] of Object.entries({
    'package.json': JSON.stringify(manifestFields),
    ...(options.files ?? {}),
  })) {
    const bytes = new TextEncoder().encode(text);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  const tarball = await gzip(concat(...chunks, TAR_TRAILER));
  return {
    manifest: {
      ...manifestFields,
      dist: {
        tarball: `https://registry.test/${name}-${version}.tgz`,
        integrity: await computeIntegrity(tarball),
      },
    },
    tarball,
  };
}

async function registryEntries(
  recipe: RecipeCase,
  shape: Shape,
  requestedRange: string,
): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  if (shape === 'transitive') {
    entries.push(await registryEntry(HOST, '1.0.0', { [recipe.name]: requestedRange }));
  }
  if (recipe.name === 'lightningcss') {
    entries.push(
      await registryEntry(
        'lightningcss-wasm',
        '1.32.0',
        { 'napi-wasm': '^1.0.1' },
        {
          optionalDependencies: {},
          peerDependencies: {},
          bundleDependencies: ['napi-wasm'],
          files: {
            'node_modules/napi-wasm/package.json': JSON.stringify({
              name: 'napi-wasm',
              version: '1.1.3',
            }),
            'node_modules/napi-wasm/index.js': 'module.exports = "bundled napi-wasm";\n',
          },
        },
      ),
      await registryEntry('napi-wasm', '1.1.3'),
    );
  }
  return entries;
}

function rootDependencies(
  recipe: RecipeCase,
  shape: Shape,
  requestedRange: string,
): Record<string, string> {
  return shape === 'direct' ? { [recipe.name]: requestedRange } : { [HOST]: '1.0.0' };
}

async function writeRootManifest(
  vfs: MemoryVfs,
  recipe: RecipeCase,
  shape: Shape,
  requestedRange: string,
): Promise<void> {
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      dependencies: rootDependencies(recipe, shape, requestedRange),
    }),
  );
}

async function seedSupported(
  recipe: RecipeCase,
  shape: Shape,
): Promise<{
  readonly vfs: MemoryVfs;
  readonly cache: InMemoryTarballCache;
  readonly result: InstallResult;
  readonly entries: readonly RegistryEntry[];
}> {
  const vfs = new MemoryVfs();
  const cache = new InMemoryTarballCache([]);
  const entries = await registryEntries(recipe, shape, recipe.supportedRange);
  await writeRootManifest(vfs, recipe, shape, recipe.supportedRange);
  const result = await install({
    vfs,
    cwd: '/project',
    registry: new LedgerRegistry(entries, []),
    tarballCache: cache,
    onSubstitution: () => {},
  });
  return { vfs, cache, result, entries };
}

function setTransitiveRange(lockfile: Lockfile, recipe: RecipeCase, range: string): void {
  const host = lockfile.packages[`node_modules/${HOST}`];
  if (!host) throw new Error('supported seed is missing the transitive host');
  host.dependencies = { ...(host.dependencies ?? {}), [recipe.name]: range };
}

async function bundleFor(
  lockfile: Lockfile,
  entries: readonly RegistryEntry[],
): Promise<Uint8Array> {
  const byUrl = new Map(entries.map((entry) => [entry.manifest.dist.tarball, entry]));
  const tarballs: Array<{
    entry: { file: string; name: string; version: string; integrity: string };
    bytes: Uint8Array;
  }> = [];
  const seen = new Set<string>();
  for (const [installPath, pinned] of Object.entries(lockfile.packages)) {
    if (installPath === '' || !pinned.resolved || !pinned.integrity) continue;
    const entry = byUrl.get(pinned.resolved);
    if (!entry) throw new Error(`bundle seed has no bytes for ${pinned.resolved}`);
    const name = entry.manifest.name;
    const key = `${name}@${pinned.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tarballs.push({
      entry: {
        file: `tarballs/${name}-${pinned.version}.tgz`,
        name,
        version: pinned.version,
        integrity: pinned.integrity,
      },
      bytes: entry.tarball,
    });
  }
  const manifestTarballs = tarballs.map(({ entry }) => entry);
  return packEddyBundle({
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.1.0-contract',
      asOf: {
        resolvedAt: '2026-07-26T00:00:00.000Z',
        registry: 'https://registry.test',
        closureHash: await closureHashOf(lockfile),
      },
      tarballs: manifestTarballs,
    },
    lockfileText: JSON.stringify(lockfile),
    tarballs,
  });
}

// TODO(backlog: npm-client/shadow-cache-ledger-independent-completion-order)
function supportedFreshEvents(recipe: RecipeCase, shape: Shape): string[] {
  if (recipe.name === 'esbuild') {
    return shape === 'transitive'
      ? [
          `packument:${HOST}`,
          `cache:get:${HOST}@1.0.0`,
          `tarball:${HOST}`,
          `cache:put:${HOST}@1.0.0`,
        ]
      : [];
  }
  return shape === 'direct'
    ? [
        'packument:lightningcss-wasm',
        'cache:get:lightningcss-wasm@1.32.0',
        'packument:napi-wasm',
        'tarball:lightningcss-wasm',
        'cache:get:napi-wasm@1.1.3',
        'tarball:napi-wasm',
        'cache:put:lightningcss-wasm@1.32.0',
        'cache:put:napi-wasm@1.1.3',
      ]
    : [
        `packument:${HOST}`,
        `cache:get:${HOST}@1.0.0`,
        'packument:lightningcss-wasm',
        `tarball:${HOST}`,
        'cache:get:lightningcss-wasm@1.32.0',
        'packument:napi-wasm',
        'tarball:lightningcss-wasm',
        'cache:get:napi-wasm@1.1.3',
        'tarball:napi-wasm',
        `cache:put:${HOST}@1.0.0`,
        'cache:put:lightningcss-wasm@1.32.0',
        'cache:put:napi-wasm@1.1.3',
      ];
}

function replayCacheEvents(recipe: RecipeCase, shape: Shape): string[] {
  return [
    ...(shape === 'transitive' ? [`cache:get:${HOST}@1.0.0`] : []),
    ...(recipe.name === 'lightningcss'
      ? ['cache:get:lightningcss-wasm@1.32.0', 'cache:get:napi-wasm@1.1.3']
      : []),
  ];
}

function supportedEddyEvents(recipe: RecipeCase, shape: Shape): string[] {
  if (recipe.name === 'esbuild') {
    return shape === 'transitive'
      ? ['eddy:POST', ...supportedFreshEvents(recipe, shape)]
      : ['eddy:POST'];
  }
  const names = [
    ...(shape === 'transitive' ? [`${HOST}@1.0.0`] : []),
    'lightningcss-wasm@1.32.0',
    'napi-wasm@1.1.3',
  ];
  return [
    'eddy:POST',
    ...names.map((name) => `cache:put:${name}`),
    ...names.map((name) => `cache:get:${name}`),
    ...names.map((name) => `cache:get:${name}`),
  ];
}

function expectedEvents(testCase: MatrixCase): string[] {
  if (testCase.outcome === 'supported') {
    if (testCase.source === 'replay') return replayCacheEvents(testCase.recipe, testCase.shape);
    if (testCase.source === 'eddy') return supportedEddyEvents(testCase.recipe, testCase.shape);
    return supportedFreshEvents(testCase.recipe, testCase.shape);
  }
  if (testCase.shape === 'direct') return [];
  if (testCase.source === 'replay') return [`cache:get:${HOST}@1.0.0`];
  const host = [
    `packument:${HOST}`,
    `cache:get:${HOST}@1.0.0`,
    `tarball:${HOST}`,
    `cache:put:${HOST}@1.0.0`,
  ];
  return testCase.source === 'eddy' ? ['eddy:POST', ...host] : host;
}

function admissionFeature(error: unknown, seen = new Set<unknown>()): string | undefined {
  if (error === null || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);
  if (error instanceof NotImplementedError) return error.feature;
  if (error instanceof AggregateError) {
    for (const child of error.errors) {
      const feature = admissionFeature(child, seen);
      if (feature) return feature;
    }
  }
  return admissionFeature((error as Error).cause, seen);
}

type ForbiddenPolicyOption = Extract<
  keyof InstallOptions,
  `${string}${
    | 'admission'
    | 'Admission'
    | 'authorit'
    | 'Authorit'
    | 'catalog'
    | 'Catalog'
    | 'policy'
    | 'Policy'
    | 'recipe'
    | 'Recipe'}${string}`
>;
const NO_POLICY_INJECTION_OPTIONS: [ForbiddenPolicyOption] extends [never] ? true : false = true;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 data authority — ordinary install', () => {
  it('keeps namespaces and InstallOptions free of policy injection entry points', () => {
    const policyEntryPoint = /admission|authorit|catalog|policy|recipe/i;
    expect(Object.keys(npmClientRoot).filter((name) => policyEntryPoint.test(name))).toEqual([]);
    expect(Object.keys(npmClientInternal).filter((name) => policyEntryPoint.test(name))).toEqual(
      [],
    );
    expect(NO_POLICY_INJECTION_OPTIONS).toBe(true);
  });

  it.each(CASES)('$title', async (testCase) => {
    const requestedRange =
      testCase.outcome === 'supported'
        ? testCase.recipe.supportedRange
        : testCase.recipe.unsupportedRange;
    const events: string[] = [];
    let vfs: MemoryVfs;
    let cache: InMemoryTarballCache;
    let bundle: Uint8Array | undefined;

    if (testCase.source === 'replay') {
      const seeded = await seedSupported(testCase.recipe, testCase.shape);
      vfs = seeded.vfs;
      cache = seeded.cache;
      cache.recordTo(events);
      await writeRootManifest(vfs, testCase.recipe, testCase.shape, requestedRange);
      if (testCase.outcome === 'unsupported' && testCase.shape === 'transitive') {
        const lockfile = structuredClone(seeded.result.lockfile);
        setTransitiveRange(lockfile, testCase.recipe, requestedRange);
        await vfs.writeFile('/project/package-lock.json', JSON.stringify(lockfile, null, 2));
      }
    } else {
      vfs = new MemoryVfs();
      cache = new InMemoryTarballCache(events);
      await writeRootManifest(vfs, testCase.recipe, testCase.shape, requestedRange);
      if (
        testCase.source === 'eddy' &&
        !(testCase.outcome === 'unsupported' && testCase.shape === 'direct')
      ) {
        const seeded = await seedSupported(testCase.recipe, testCase.shape);
        const lockfile = structuredClone(seeded.result.lockfile);
        if (testCase.outcome === 'unsupported') {
          setTransitiveRange(lockfile, testCase.recipe, requestedRange);
        }
        bundle = await bundleFor(lockfile, seeded.entries);
      }
    }

    const entries = await registryEntries(testCase.recipe, testCase.shape, requestedRange);
    const registry = new LedgerRegistry(entries, events);
    const reports: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      events.push(`eddy:${init?.method ?? 'GET'}`);
      return bundle
        ? new Response(bundle as unknown as BodyInit)
        : new Response('', { status: 599 });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writers =
      testCase.outcome === 'unsupported'
        ? [
            vi.spyOn(vfs, 'writeFile'),
            vi.spyOn(vfs, 'mkdir'),
            vi.spyOn(vfs, 'rm'),
            vi.spyOn(vfs, 'utimes'),
          ]
        : [];

    let result: InstallResult | undefined;
    let caught: unknown;
    try {
      result = await install({
        vfs,
        cwd: '/project',
        registry,
        tarballCache: cache,
        ...(testCase.source === 'eddy' ? { resolverUrl: 'https://eddy.test/resolve' } : {}),
        onSubstitution: (line) => reports.push(line),
      });
    } catch (error) {
      caught = error;
    }

    expect(events).toEqual(expectedEvents(testCase));
    if (testCase.outcome === 'supported') {
      expect(caught).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(testCase.source === 'eddy' ? 1 : 0);
      const manifest = JSON.parse(
        await vfs.readFileText(`/project/node_modules/${testCase.recipe.name}/package.json`),
      ) as { name?: unknown; version?: unknown };
      expect(manifest).toMatchObject({
        name: testCase.recipe.name,
        version: testCase.recipe.version,
      });
      const recipeId = `rifty.shadow-substitution.${testCase.recipe.name}.v2`;
      expect(
        result?.lockfile.rifty?.shadowSubstitutions.applied.find(
          ({ trigger }) => trigger.name === testCase.recipe.name,
        )?.substitutionId,
      ).toBe(recipeId);
      expect(reports).toContainEqual(
        expect.stringContaining(`materialized from shadow registry (${recipeId})`),
      );
      return;
    }

    expect(caught).toBeInstanceOf(
      testCase.source === 'eddy' && testCase.shape === 'transitive'
        ? AggregateError
        : NotImplementedError,
    );
    for (const writer of writers) expect(writer).not.toHaveBeenCalled();
    expect(admissionFeature(caught)).toBe(testCase.recipe.feature);
  });
});
