import { NotImplementedError } from '@riftydev/io';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { readyShadowAssetInstaller } from './_test-fixtures/shadow-assets.ts';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import {
  EMPTY_SHADOW_ASSET_PLAN,
  type ShadowAssetPlan,
  shadowAssetPlanFromLockfileBytes,
} from './index.ts';
import { install } from './installer.ts';
import { type Lockfile, buildLockfile } from './linker.ts';
import { type Packument, RegistryClient } from './registry.ts';

const enc = new TextEncoder();

class AliasRegistry extends RegistryClient {
  constructor() {
    super({ baseUrl: '/unused', fetch: async () => new Response(null, { status: 500 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    const version = name === '@esbuild/wasi-preview1' ? '0.28.0' : '1.0.0';
    return {
      name,
      'dist-tags': { latest: version },
      versions: {
        [version]: {
          name,
          version,
          dist: { tarball: `fake://${encodeURIComponent(name)}/${version}` },
        },
      },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(url);
    if (!match) throw new Error(`bad fake URL ${url}`);
    return makePackageTarball(decodeURIComponent(match[1]!), match[2]!);
  }
}

async function installEsbuild(overrides?: Readonly<Record<string, string>>): Promise<{
  readonly lockfileBytes: Uint8Array;
  readonly lockfile: Lockfile;
  readonly plan: ShadowAssetPlan;
}> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  const result = await install(
    'root',
    '1.0.0',
    { esbuild: '^0.28.0' },
    {
      vfs,
      cwd: '/project',
      registry: new AliasRegistry(),
      ...(overrides === undefined
        ? { shadowAssets: { installer: readyShadowAssetInstaller } }
        : {}),
      ...(overrides === undefined ? {} : { overrides }),
      onSubstitution: () => undefined,
    },
  );
  return {
    lockfileBytes: await vfs.readFile('/project/package-lock.json'),
    lockfile: result.lockfile,
    plan: result.shadowAssets?.plan ?? EMPTY_SHADOW_ASSET_PLAN,
  };
}

function standardOnlyLockfile(lockfile: Lockfile): Uint8Array {
  return enc.encode(
    JSON.stringify({
      name: lockfile.name,
      version: lockfile.version,
      lockfileVersion: lockfile.lockfileVersion,
      requires: lockfile.requires,
      packages: lockfile.packages,
    }),
  );
}

describe('shadow-asset facts from exact stored npm-client lockfile bytes', () => {
  it('does not let the public lockfile builder mint an npm-client-owned applied trace', async () => {
    const installed = await installEsbuild();
    const callWithForgedOptions = buildLockfile as unknown as (
      name: string,
      version: string,
      packages: readonly [],
      options: Readonly<{ appliedShadowSubstitutions: ShadowAssetPlan['substitutions'] }>,
    ) => Lockfile;

    expect(
      callWithForgedOptions('root', '1.0.0', [], {
        appliedShadowSubstitutions: installed.plan.substitutions,
      }).rifty,
    ).toBeUndefined();
  });

  it('reproduces the exact fresh-install applied-substitution plan', async () => {
    const installed = await installEsbuild();

    expect(installed.lockfile.rifty?.shadowSubstitutions.applied).toEqual([
      {
        publicName: 'esbuild',
        requestedRange: '^0.28.0',
        resolvedPublicVersion: '0.28.0',
        substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
      },
    ]);
    expect(shadowAssetPlanFromLockfileBytes(installed.lockfileBytes)).toEqual(installed.plan);
  });

  it('rebuilds current asset facts from stable persisted recipe evidence', () => {
    const evidence = {
      publicName: 'esbuild',
      requestedRange: '^0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
    };
    const bytes = enc.encode(
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { version: '1.0.0', dependencies: { esbuild: '0.28.0' } },
          'node_modules/@esbuild/wasi-preview1': {
            version: '0.28.0',
            dependencies: {},
          },
        },
        rifty: {
          shadowSubstitutions: {
            protocol: 'rifty.lockfile-shadow-substitutions/v1',
            applied: [evidence],
          },
        },
      }),
    );

    const plan = shadowAssetPlanFromLockfileBytes(bytes);
    expect(plan.substitutions).toEqual([
      {
        ...evidence,
        catalog: {
          id: builtinShadowAssetCatalog.id,
          digest: builtinShadowAssetCatalog.digest,
        },
        runtimeAdapterId: builtinShadowAssetCatalog.substitutions[0]?.runtimeAdapterId,
        builtin: true,
      },
    ]);
    expect(plan.assets).toEqual(builtinShadowAssetCatalog.assets);
  });

  it('does not invent builtin provenance for a byte-shape-equivalent user override', async () => {
    const installed = await installEsbuild({
      esbuild: 'npm:@esbuild/wasi-preview1@0.28.0',
    });

    expect(shadowAssetPlanFromLockfileBytes(installed.lockfileBytes)).toEqual(
      EMPTY_SHADOW_ASSET_PLAN,
    );
  });

  it('rejects trace/tree drift instead of trusting an unattested target coincidence', async () => {
    const installed = await installEsbuild();
    const parsed = JSON.parse(new TextDecoder().decode(installed.lockfileBytes)) as Lockfile;
    const target = parsed.packages['node_modules/@esbuild/wasi-preview1'];
    if (target === undefined) throw new Error('fixture expected the esbuild alias target');
    target.version = '0.28.1';

    expect(() => shadowAssetPlanFromLockfileBytes(enc.encode(JSON.stringify(parsed)))).toThrow(
      /shadow substitution.*lockfile/i,
    );
  });

  it('loud-throws when a legacy lockfile can name a builtin substitution but has no exact trace', async () => {
    const installed = await installEsbuild();

    let thrown: unknown;
    try {
      shadowAssetPlanFromLockfileBytes(standardOnlyLockfile(installed.lockfile));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as NotImplementedError).feature).toBe(
      'npm-client.lockfile.shadowSubstitutionFacts',
    );
  });

  it.each([
    [
      'public package key',
      {
        '': { version: '1.0.0', dependencies: {} },
        'node_modules/esbuild': { version: '0.28.0', dependencies: {} },
      },
    ],
    [
      'baked-target package key',
      {
        '': { version: '1.0.0', dependencies: {} },
        'node_modules/@esbuild/wasi-preview1': { version: '0.28.0', dependencies: {} },
      },
    ],
    [
      'public dependency edge',
      { '': { version: '1.0.0', dependencies: { esbuild: '0.28.0' } } },
    ],
    [
      'baked-target dependency edge',
      {
        '': {
          version: '1.0.0',
          dependencies: { '@esbuild/wasi-preview1': '0.28.0' },
        },
      },
    ],
  ])('treats a legacy %s as provenance-ambiguous', (_label, packages) => {
    const bytes = enc.encode(
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages,
      }),
    );

    let thrown: unknown;
    try {
      shadowAssetPlanFromLockfileBytes(bytes);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as NotImplementedError).feature).toBe(
      'npm-client.lockfile.shadowSubstitutionFacts',
    );
  });

  it('rejects a non-canonical applied trace instead of silently deduplicating it', async () => {
    const installed = await installEsbuild();
    const trace = installed.lockfile.rifty?.shadowSubstitutions;
    const first = trace?.applied[0];
    if (trace === undefined || first === undefined) {
      throw new Error('fixture expected one applied shadow substitution');
    }
    const lockfile = {
      ...installed.lockfile,
      rifty: {
        shadowSubstitutions: {
          ...trace,
          applied: [first, first],
        },
      },
    };

    expect(() => shadowAssetPlanFromLockfileBytes(enc.encode(JSON.stringify(lockfile)))).toThrow(
      /canonical/i,
    );
  });

  it.each([
    [
      'missing top-level identity',
      {
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { version: '1.0.0', dependencies: {} } },
      },
    ],
    [
      'missing root package entry',
      {
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { 'node_modules/vite': { version: '8.0.16', dependencies: {} } },
      },
    ],
    [
      'malformed unrelated package entry',
      {
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { version: '1.0.0', dependencies: {} },
          'node_modules/vite': { dependencies: {} },
        },
      },
    ],
  ])('rejects a structurally invalid v3 lockfile: %s', (_label, lockfile) => {
    expect(() => shadowAssetPlanFromLockfileBytes(enc.encode(JSON.stringify(lockfile)))).toThrow(
      /v3 lockfile/i,
    );
  });

  it('accepts bin metadata that the lockfile writer deliberately preserves', () => {
    const lockfile = buildLockfile('root', '1.0.0', [
      {
        name: 'vite',
        version: '8.0.16',
        dependencies: {},
        files: {},
        bin: { '': 'ignored.js', vite: 'bin/vite.js' },
      },
    ]);

    expect(shadowAssetPlanFromLockfileBytes(enc.encode(JSON.stringify(lockfile)))).toBe(
      EMPTY_SHADOW_ASSET_PLAN,
    );
  });

  it('does not impose non-empty identity strings that the lockfile writer does not require', () => {
    const lockfile = buildLockfile('', '', [
      {
        name: 'vite',
        version: '',
        dependencies: {},
        files: {},
      },
    ]);

    expect(shadowAssetPlanFromLockfileBytes(enc.encode(JSON.stringify(lockfile)))).toBe(
      EMPTY_SHADOW_ASSET_PLAN,
    );
  });

  it('returns the canonical empty plan for an asset-free v3 lockfile', () => {
    const bytes = enc.encode(
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { version: '1.0.0', dependencies: { vite: '8.0.16' } },
          'node_modules/vite': { version: '8.0.16', dependencies: {} },
        },
      }),
    );

    expect(shadowAssetPlanFromLockfileBytes(bytes)).toBe(EMPTY_SHADOW_ASSET_PLAN);
  });
});
