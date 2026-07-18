import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { readyShadowAssetInstaller } from './_test-fixtures/shadow-assets.ts';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { EMPTY_SHADOW_ASSET_PLAN, shadowAssetPlanFromLockfileBytes } from './index.ts';
import { install } from './installer.ts';
import type { Lockfile } from './linker.ts';
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

async function installEsbuild(
  overrides?: Readonly<Record<string, string>>,
): Promise<{
  readonly lockfileBytes: Uint8Array;
  readonly lockfile: Lockfile;
  readonly plan: unknown;
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
  it('reproduces the exact fresh-install applied-substitution plan', async () => {
    const installed = await installEsbuild();

    expect(shadowAssetPlanFromLockfileBytes(installed.lockfileBytes)).toEqual(installed.plan);
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
