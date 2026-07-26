import { bakedOverrides } from '@riftydev/shadow-registry';
import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
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
import * as npmClient from './index.ts';
import type { InstallOptions, ShadowInstallAuthority } from './installer.ts';
import { installWithShadowAuthority } from './installer.ts';
import * as npmClientInternal from './internal/index.ts';
import type { Lockfile } from './linker.ts';
import type { Packument } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { computeIntegrity } from './tarball-cache.ts';

// @ts-expect-error Package-private authority must not cross the package root.
import type { ShadowInstallAuthority as RootShadowInstallAuthority } from './index.ts';
// @ts-expect-error Package-private authority must not cross the published internal root.
import type { ShadowInstallAuthority as InternalShadowInstallAuthority } from './internal/index.ts';

const PROBE = 'public-authority-probe';
const PRIVATE_TARGET = 'private-authority-target';
const FORGED_AUTHORITY: ShadowInstallAuthority = {
  catalog: builtinShadowSubstitutionCatalog,
  builtinOverrides: { [PROBE]: `${PRIVATE_TARGET}@1.0.0` },
};

function compileOnlyPublicBoundary(opts: InstallOptions, authority: ShadowInstallAuthority): void {
  // @ts-expect-error Public resolveOverride is three-argument and builtin-only.
  npmClient.resolveOverride(PROBE, undefined, {}, authority.builtinOverrides);
  // @ts-expect-error Public install has no injected-authority argument.
  void npmClient.install('fixture', '1.0.0', { [PROBE]: '1.0.0' }, opts, authority);
  const forbiddenOptions: InstallOptions = {
    ...opts,
    // @ts-expect-error Public InstallOptions cannot carry executable policy.
    shadowAuthority: authority,
  };
  void forbiddenOptions;
}
void compileOnlyPublicBoundary;
void (0 as unknown as RootShadowInstallAuthority);
void (0 as unknown as InternalShadowInstallAuthority);

class BoundaryRegistry extends RegistryClient {
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];

  constructor() {
    super({ baseUrl: '/registry', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    const version = '1.0.0';
    return {
      name,
      'dist-tags': { latest: version },
      versions: {
        [version]: {
          name,
          version,
          dist: { tarball: `/registry/${encodeURIComponent(name)}-${version}.tgz` },
        },
      },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads.push(url);
    throw new Error(`boundary halt: ${url}`);
  }
}

const MATRIX_HOST = 'shadow-authority-host';
const LIGHTNINGCSS = 'lightningcss';
const LIGHTNINGCSS_WASM = 'lightningcss-wasm';
const NAPI_WASM = 'napi-wasm';
const SUPPORTED_LIGHTNINGCSS_RANGE = '^1.32.0';
const UNSUPPORTED_LIGHTNINGCSS_RANGE = '^2.0.0';

interface MatrixRegistryEntry {
  readonly manifest: Packument['versions'][string];
  readonly tarball: Uint8Array;
}

class MatrixRegistry extends RegistryClient {
  readonly events: string[];
  readonly entries: ReadonlyMap<string, MatrixRegistryEntry>;

  constructor(entries: ReadonlyMap<string, MatrixRegistryEntry>, events: string[]) {
    super({ baseUrl: '/registry', fetch: async () => new Response('', { status: 599 }) });
    this.entries = entries;
    this.events = events;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.events.push(`packument:${name}`);
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`matrix registry missing ${name}`);
    return {
      name,
      'dist-tags': { latest: entry.manifest.version },
      versions: { [entry.manifest.version]: entry.manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const found = [...this.entries.entries()].find(
      ([, entry]) => entry.manifest.dist.tarball === url,
    );
    if (!found) throw new Error(`matrix registry missing ${url}`);
    this.events.push(`tarball:${found[0]}`);
    return found[1].tarball.slice();
  }
}

async function matrixRegistryEntry(
  name: string,
  version: string,
  dependencies: Readonly<Record<string, string>> = {},
): Promise<MatrixRegistryEntry> {
  const packageJson = new TextEncoder().encode(JSON.stringify({ name, version, dependencies }));
  const tarball = await gzip(
    concat(
      buildHeader('package/package.json', packageJson.length),
      padToBlock(packageJson),
      TAR_TRAILER,
    ),
  );
  return {
    manifest: {
      name,
      version,
      dependencies,
      dist: {
        tarball: `https://registry.test/${encodeURIComponent(name)}-${version}.tgz`,
        integrity: await computeIntegrity(tarball),
      },
    },
    tarball,
  };
}

async function matrixRegistry(
  hostLightningcssRange: string,
  events: string[],
): Promise<MatrixRegistry> {
  return new MatrixRegistry(
    new Map([
      [
        MATRIX_HOST,
        await matrixRegistryEntry(MATRIX_HOST, '1.0.0', {
          [LIGHTNINGCSS]: hostLightningcssRange,
        }),
      ],
      [
        LIGHTNINGCSS_WASM,
        await matrixRegistryEntry(LIGHTNINGCSS_WASM, '1.32.0', {
          [NAPI_WASM]: '^1.0.1',
        }),
      ],
      [NAPI_WASM, await matrixRegistryEntry(NAPI_WASM, '1.1.3')],
    ]),
    events,
  );
}

const CLONED_BUILTIN_AUTHORITY = structuredClone({
  catalog: builtinShadowSubstitutionCatalog,
  builtinOverrides: bakedOverrides,
}) as ShadowInstallAuthority;

type MatrixAuthority = 'builtin' | 'injected';
type MatrixShape = 'direct' | 'transitive';
type MatrixSource = 'fresh' | 'replay' | 'eddy';

const AUTHORITY_MATRIX_CASES: readonly [
  shape: MatrixShape,
  source: MatrixSource,
  expectedOrder: readonly string[],
  expectedErrorName: string,
][] = [
  ['direct', 'fresh', [], 'NotImplementedError'],
  ['direct', 'replay', [], 'NotImplementedError'],
  ['direct', 'eddy', [], 'NotImplementedError'],
  [
    'transitive',
    'fresh',
    [`packument:${MATRIX_HOST}`, `tarball:${MATRIX_HOST}`],
    'NotImplementedError',
  ],
  ['transitive', 'replay', [], 'NotImplementedError'],
  [
    'transitive',
    'eddy',
    ['eddy:POST', `packument:${MATRIX_HOST}`, `tarball:${MATRIX_HOST}`],
    'AggregateError',
  ],
];

function matrixDependencies(shape: MatrixShape, lightningcssRange: string): Record<string, string> {
  return shape === 'direct' ? { [LIGHTNINGCSS]: lightningcssRange } : { [MATRIX_HOST]: '1.0.0' };
}

async function invokeMatrixInstall(
  authority: MatrixAuthority,
  dependencies: Record<string, string>,
  opts: InstallOptions,
): Promise<void> {
  if (authority === 'builtin') {
    await npmClient.install('fixture', '1.0.0', dependencies, opts);
    return;
  }
  await installWithShadowAuthority(
    { rootName: 'fixture', rootVersion: '1.0.0', dependencies, opts },
    CLONED_BUILTIN_AUTHORITY,
  );
}

async function seedSupportedLockfile(
  authority: MatrixAuthority,
  shape: MatrixShape,
): Promise<{ readonly lockfile: Lockfile; readonly vfs: MemoryVfs }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  await invokeMatrixInstall(authority, matrixDependencies(shape, SUPPORTED_LIGHTNINGCSS_RANGE), {
    vfs,
    cwd: '/project',
    registry: await matrixRegistry(SUPPORTED_LIGHTNINGCSS_RANGE, []),
    onSubstitution: () => {},
  });
  return {
    lockfile: JSON.parse(await vfs.readFileText('/project/package-lock.json')) as Lockfile,
    vfs,
  };
}

async function withUnsupportedTransitiveRange(
  lockfile: Lockfile,
  registry: MatrixRegistry,
  replaceAcquisition: boolean,
): Promise<void> {
  const host = lockfile.packages[`node_modules/${MATRIX_HOST}`];
  const registryHost = registry.entries.get(MATRIX_HOST);
  if (!host || !registryHost) throw new Error('matrix host setup missing');
  host.dependencies = { [LIGHTNINGCSS]: UNSUPPORTED_LIGHTNINGCSS_RANGE };
  if (replaceAcquisition) {
    host.resolved = registryHost.manifest.dist.tarball;
    host.integrity = registryHost.manifest.dist.integrity;
  }
}

async function matrixEddyBundle(lockfile: Lockfile, registry: MatrixRegistry): Promise<Uint8Array> {
  const resolved = new Set(
    Object.values(lockfile.packages)
      .map((entry) => entry.resolved)
      .filter((value): value is string => value !== undefined),
  );
  const tarballs = [...registry.entries.entries()]
    .filter(([, entry]) => resolved.has(entry.manifest.dist.tarball))
    .map(([name, entry]) => {
      const descriptor = {
        file: `tarballs/${encodeURIComponent(name)}-${entry.manifest.version}.tgz`,
        name,
        version: entry.manifest.version,
        integrity: entry.manifest.dist.integrity!,
      };
      return { entry: descriptor, bytes: entry.tarball };
    });
  return packEddyBundle({
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.1.0-test',
      asOf: {
        resolvedAt: '2026-07-26T00:00:00.000Z',
        registry: 'https://registry.test',
        closureHash: await closureHashOf(lockfile),
      },
      tarballs: tarballs.map(({ entry }) => entry),
    },
    lockfileText: JSON.stringify(lockfile),
    tarballs,
  });
}

interface MatrixObservation {
  readonly outcome: 'error' | 'resolved';
  readonly error?: {
    readonly name: string;
    readonly feature?: string;
    readonly message: string;
  };
  readonly events: readonly string[];
}

function admissionFeature(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const feature = (error as Error & { feature?: unknown }).feature;
  if (typeof feature === 'string') return feature;
  if (error instanceof AggregateError) {
    for (const cause of error.errors) {
      const nested = admissionFeature(cause);
      if (nested !== undefined) return nested;
    }
  }
  return admissionFeature(error.cause);
}

async function observeMatrixCase(
  authority: MatrixAuthority,
  shape: MatrixShape,
  source: MatrixSource,
): Promise<MatrixObservation> {
  const events: string[] = [];
  const registry = await matrixRegistry(
    shape === 'transitive' ? UNSUPPORTED_LIGHTNINGCSS_RANGE : SUPPORTED_LIGHTNINGCSS_RANGE,
    events,
  );
  let vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  let eddyBundle: Uint8Array | undefined;

  if (source !== 'fresh' && (source === 'replay' || shape === 'transitive')) {
    const seeded = await seedSupportedLockfile(authority, shape);
    if (shape === 'transitive') {
      await withUnsupportedTransitiveRange(seeded.lockfile, registry, source === 'eddy');
    }
    if (source === 'replay') {
      vfs = seeded.vfs;
      await vfs.writeFile('/project/package-lock.json', JSON.stringify(seeded.lockfile));
    } else {
      eddyBundle = await matrixEddyBundle(seeded.lockfile, registry);
    }
  }

  const fetchSpy =
    source === 'eddy'
      ? vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
          events.push(`eddy:${init?.method ?? 'GET'}`);
          return eddyBundle
            ? new Response(eddyBundle as unknown as BodyInit)
            : new Response('', { status: 599 });
        })
      : undefined;
  const warnSpy = source === 'eddy' ? vi.spyOn(console, 'warn').mockImplementation(() => {}) : null;
  try {
    await invokeMatrixInstall(
      authority,
      matrixDependencies(
        shape,
        shape === 'direct' ? UNSUPPORTED_LIGHTNINGCSS_RANGE : SUPPORTED_LIGHTNINGCSS_RANGE,
      ),
      {
        vfs,
        cwd: '/project',
        registry,
        ...(source === 'eddy' ? { resolverUrl: 'https://eddy.test/resolve' } : {}),
        onSubstitution: () => {},
      },
    );
    return { outcome: 'resolved', events };
  } catch (error) {
    const thrown = error as Error;
    const feature = admissionFeature(error);
    return {
      outcome: 'error',
      error: {
        name: thrown.name,
        ...(feature === undefined ? {} : { feature }),
        message: thrown.message,
      },
      events,
    };
  } finally {
    fetchSpy?.mockRestore();
    warnSpy?.mockRestore();
  }
}

async function publicInstallWithRuntimeExtraAuthority(opts: InstallOptions): Promise<never> {
  const unsafeInstall = npmClient.install as unknown as (
    rootName: string,
    rootVersion: string,
    dependencies: Record<string, string>,
    options: InstallOptions,
    authority: ShadowInstallAuthority,
  ) => Promise<never>;
  return await unsafeInstall('fixture', '1.0.0', { [PROBE]: '1.0.0' }, opts, FORGED_AUTHORITY);
}

const PUBLIC_INSTALL_INJECTION_CASES: readonly [
  label: string,
  invoke: (opts: InstallOptions) => Promise<unknown>,
][] = [
  ['extra argument', publicInstallWithRuntimeExtraAuthority],
  [
    'options property',
    async (opts) =>
      await npmClient.install('fixture', '1.0.0', { [PROBE]: '1.0.0' }, {
        ...opts,
        shadowAuthority: FORGED_AUTHORITY,
      } as InstallOptions),
  ],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('public shadow authority boundary', () => {
  it('[fault: provenance-lie] ignores a runtime fourth override argument', () => {
    const unsafeResolve = npmClient.resolveOverride as unknown as (
      name: string,
      parent: string | undefined,
      userOverrides: Record<string, string>,
      builtinOverrides: Record<string, string>,
    ) => ReturnType<typeof npmClient.resolveOverride>;

    expect(unsafeResolve(PROBE, undefined, {}, FORGED_AUTHORITY.builtinOverrides)).toBeNull();
    expect(
      unsafeResolve(
        PROBE,
        undefined,
        { [PROBE]: 'user-authority-target@1.0.0' },
        FORGED_AUTHORITY.builtinOverrides,
      ),
    ).toEqual({
      name: 'user-authority-target',
      range: '1.0.0',
      source: 'user',
    });
  });

  it('[fault: provenance-lie] exports no injected-policy entry point', () => {
    for (const entry of ['installWithShadowAuthority', 'resolveOverrideWithBuiltinAuthority']) {
      expect(npmClient, entry).not.toHaveProperty(entry);
      expect(npmClientInternal, entry).not.toHaveProperty(entry);
    }
  });

  it.each(PUBLIC_INSTALL_INJECTION_CASES)(
    '[fault: provenance-lie] ignores a runtime $label on public install',
    async (_label, invoke) => {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = new BoundaryRegistry();
      const lines: string[] = [];

      await expect(
        invoke({
          vfs,
          cwd: '/project',
          registry,
          onSubstitution: (line) => lines.push(line),
        }),
      ).rejects.toThrow(`boundary halt: /registry/${PROBE}-1.0.0.tgz`);
      expect(registry.packumentReads).toEqual([PROBE]);
      expect(registry.tarballReads).toEqual([`/registry/${PROBE}-1.0.0.tgz`]);
      expect(lines).toEqual([]);
    },
  );

  it('[fault: provenance-lie] keeps the injected authority on the package-private seam', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = new BoundaryRegistry();
    const lines: string[] = [];

    await expect(
      installWithShadowAuthority(
        {
          rootName: 'fixture',
          rootVersion: '1.0.0',
          dependencies: { [PROBE]: '1.0.0' },
          opts: {
            vfs,
            cwd: '/project',
            registry,
            onSubstitution: (line) => lines.push(line),
          },
        },
        FORGED_AUTHORITY,
      ),
    ).rejects.toThrow(`boundary halt: /registry/${PRIVATE_TARGET}-1.0.0.tgz`);
    expect(registry.packumentReads).toEqual([PRIVATE_TARGET]);
    expect(registry.tarballReads).toEqual([`/registry/${PRIVATE_TARGET}-1.0.0.tgz`]);
    expect(lines).toEqual([
      `npm: ${PROBE}@1.0.0 → ${PRIVATE_TARGET}@1.0.0 (substituted from shadow registry, ADR-0051)`,
    ]);
  });

  it.each(AUTHORITY_MATRIX_CASES)(
    '[fault: frozen-assumption/observable-order] cloned builtin authority matches builtin for %s %s admission',
    async (shape, source, expectedOrder, expectedErrorName) => {
      const builtin = await observeMatrixCase('builtin', shape, source);
      const injected = await observeMatrixCase('injected', shape, source);

      expect(injected).toEqual(builtin);
      expect(builtin).toMatchObject({
        outcome: 'error',
        error: {
          name: expectedErrorName,
          feature: `shadow-registry.${LIGHTNINGCSS}@${UNSUPPORTED_LIGHTNINGCSS_RANGE}`,
        },
        events: expectedOrder,
      });
    },
  );
});
