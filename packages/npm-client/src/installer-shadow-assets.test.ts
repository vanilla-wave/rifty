import { createHash } from 'node:crypto';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { type InstallOptions, install } from './installer.ts';
import { type Packument, RegistryClient } from './registry.ts';
import {
  type ShadowAssetEnsureResult,
  ShadowAssetError,
  ShadowAssetInstallError,
  type ShadowAssetInstaller,
  type ShadowAssetPlan,
} from './shadow-assets.ts';

class InstallRegistry extends RegistryClient {
  readonly tarball: Uint8Array;
  constructor() {
    super({ baseUrl: '/unused', fetch: async () => new Response(null, { status: 500 }) });
    this.tarball = new Uint8Array();
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
    return await makePackageTarball(decodeURIComponent(match[1]!), match[2]!);
  }
}

class FailingOptionalEsbuildRegistry extends InstallRegistry {
  override async getTarball(url: string): Promise<Uint8Array> {
    if (url.includes(encodeURIComponent('@esbuild/wasi-preview1'))) {
      throw new Error('optional esbuild target tarball unavailable');
    }
    return await super.getTarball(url);
  }
}

function ready(plan: ShadowAssetPlan): Extract<ShadowAssetEnsureResult, { kind: 'ready' }> {
  const catalog = plan.substitutions[0]?.catalog;
  if (!catalog) throw new Error('expected non-empty plan');
  return {
    kind: 'ready',
    plan,
    receipt: {
      schema: 1,
      receiptSha256: createHash('sha256').update(plan.requiredSetDigest).digest('hex'),
      requiredSetDigest: plan.requiredSetDigest,
      catalog,
      storageClass: 'memory-session',
      substitutions: plan.substitutions,
      assets: plan.assets.map((asset) => ({
        id: asset.id,
        source: asset.source,
        member: asset.member,
        memberSha256: asset.memberSha256,
        memberSize: asset.memberSize,
        fillTransport: 'standard',
        fillCache: 'network',
      })),
    },
  };
}

function installer(
  implementation: (plan: ShadowAssetPlan) => Promise<ShadowAssetEnsureResult> = async (plan) =>
    ready(plan),
): ShadowAssetInstaller & { ensure: ReturnType<typeof vi.fn> } {
  return {
    ensure: vi.fn(implementation),
    inspectReceipt: vi.fn(async () => null),
  };
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return vfs;
}

async function optionalEsbuildProject(): Promise<MemoryVfs> {
  const vfs = await project();
  await vfs.writeFile(
    '/project/package.json',
    new TextEncoder().encode(
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        optionalDependencies: { esbuild: '^0.28.0' },
      }),
    ),
  );
  return vfs;
}

describe('install shadow-asset authority boundary', () => {
  it.each(['metadata', 'lockfile'] as const)(
    'does not plan a fresh %s optional builtin substitution whose target never enters the tree',
    async (resolution) => {
      const vfs = await optionalEsbuildProject();
      if (resolution === 'lockfile') {
        await vfs.writeFile(
          '/project/package-lock.json',
          new TextEncoder().encode(
            JSON.stringify({
              name: 'root',
              version: '1.0.0',
              lockfileVersion: 3,
              requires: true,
              packages: {
                '': { version: '1.0.0' },
                'node_modules/@esbuild/wasi-preview1': {
                  version: '0.28.0',
                  resolved: `fake://${encodeURIComponent('@esbuild/wasi-preview1')}/0.28.0`,
                  integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
                },
              },
            }),
          ),
        );
      }
      const assets = installer();

      const result = await install({
        vfs,
        cwd: '/project',
        registry: new FailingOptionalEsbuildRegistry(),
        shadowAssets: { installer: assets },
      });

      expect(result.packages).toEqual([]);
      expect('shadowAssets' in result).toBe(false);
      expect(assets.ensure).not.toHaveBeenCalled();
      expect(result.provenance.resolution).toBe(resolution);
    },
  );

  it.each([
    ['null options', null],
    ['extra option', { extra: true }],
    ['fake signal', { signal: {} }],
    ['fake progress callback', { onProgress: 1 }],
  ])(
    'rejects malformed shadow-asset %s before the tree mutation barrier',
    async (_label, value) => {
      const vfs = await project();
      const barrier = vi.fn();
      const assets = installer();
      const shadowAssets = {
        installer: assets,
        options: value,
      } as unknown as NonNullable<InstallOptions['shadowAssets']>;

      await expect(
        install(
          'root',
          '1.0.0',
          { esbuild: '^0.28.0' },
          {
            vfs,
            cwd: '/project',
            registry: new InstallRegistry(),
            shadowAssets,
            onTreeMutationStart: barrier,
          },
        ),
      ).rejects.toBeInstanceOf(TypeError);
      expect(barrier).not.toHaveBeenCalled();
      expect(await vfs.exists('/project/node_modules')).toBe(false);
      expect(await vfs.exists('/project/package-lock.json')).toBe(false);
    },
  );

  it.each(['plan', 'receipt', 'receipt-hash'] as const)(
    'rejects a same-digest ready result with drifted %s evidence',
    async (fault) => {
      const vfs = await project();
      const assets = installer(async (plan) => {
        const result = ready(plan);
        if (fault === 'plan') {
          return { ...result, plan: { ...plan, assets: [] } };
        }
        if (fault === 'receipt') {
          return { ...result, receipt: { ...result.receipt, assets: [] } };
        }
        return {
          ...result,
          receipt: { ...result.receipt, receiptSha256: 'f'.repeat(64) },
        };
      });

      let thrown: unknown;
      try {
        await install(
          'root',
          '1.0.0',
          { esbuild: '^0.28.0' },
          {
            vfs,
            cwd: '/project',
            registry: new InstallRegistry(),
            shadowAssets: { installer: assets },
          },
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ShadowAssetInstallError);
      expect(thrown).toMatchObject({ code: 'ESHADOWASSET', phase: 'ready' });
      expect(await vfs.exists('/project/package-lock.json')).toBe(true);
    },
  );

  it('loud-throws a non-empty plan without an installer before tree mutation', async () => {
    const vfs = await project();
    const barrier = vi.fn();
    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: new InstallRegistry(),
          onTreeMutationStart: barrier,
        },
      ),
    ).rejects.toMatchObject({
      feature: 'npm.install.shadowAssets',
    });
    expect(barrier).not.toHaveBeenCalled();
    expect(await vfs.exists('/project/node_modules')).toBe(false);
    expect(await vfs.exists('/project/package-lock.json')).toBe(false);
  });

  it('publishes byte-identical fresh/replay plans independent of reporter text', async () => {
    const vfs = await project();
    const firstInstaller = installer();
    const first = await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: new InstallRegistry(),
        shadowAssets: { installer: firstInstaller },
        onSubstitution: () => undefined,
      },
    );
    const secondInstaller = installer();
    const second = await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: new InstallRegistry(),
        shadowAssets: { installer: secondInstaller },
        onSubstitution: (line) => void `presentation changed: ${line}`,
      },
    );
    expect(first.shadowAssets?.plan).toEqual(second.shadowAssets?.plan);
    expect(firstInstaller.ensure).toHaveBeenCalledTimes(1);
    expect(secondInstaller.ensure).toHaveBeenCalledTimes(1);
  });

  it('calls the mutation barrier exactly once immediately before link and scopes ensure options', async () => {
    const vfs = await project();
    const events: string[] = [];
    const mkdir = vfs.mkdir.bind(vfs);
    vi.spyOn(vfs, 'mkdir').mockImplementation(async (...args) => {
      if (args[0].startsWith('/project')) events.push('mkdir');
      await mkdir(...args);
    });
    const assets = installer();
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: new InstallRegistry(),
        shadowAssets: { installer: assets, options: { signal, onProgress } },
        onTreeMutationStart: () => events.push('barrier'),
      },
    );
    expect(events[0]).toBe('barrier');
    expect(events.filter((event) => event === 'barrier')).toHaveLength(1);
    expect(assets.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ assets: expect.any(Array) }),
      { signal, onProgress },
    );
  });

  it('a barrier throw leaves the project tree unchanged', async () => {
    const vfs = await project();
    await expect(
      install(
        'root',
        '1.0.0',
        { plain: '1.0.0' },
        {
          vfs,
          cwd: '/project',
          registry: new InstallRegistry(),
          onTreeMutationStart: () => {
            throw new Error('authority fenced');
          },
        },
      ),
    ).rejects.toThrow('authority fenced');
    expect(await vfs.readdir('/project')).toEqual([]);
  });

  it('fences the first link write after a successful mutation barrier', async () => {
    const vfs = await project();
    const events: string[] = [];
    const mkdir = vfs.mkdir.bind(vfs);
    vi.spyOn(vfs, 'mkdir').mockImplementation(async (...args) => {
      if (args[0].startsWith('/project/node_modules')) {
        events.push('first-link-write');
        throw new Error('first link write failed');
      }
      await mkdir(...args);
    });

    await expect(
      install(
        'root',
        '1.0.0',
        { plain: '1.0.0' },
        {
          vfs,
          cwd: '/project',
          registry: new InstallRegistry(),
          onTreeMutationStart: () => events.push('barrier'),
        },
      ),
    ).rejects.toThrow('first link write failed');
    expect(events).toEqual(['barrier', 'first-link-write']);
    expect(await vfs.exists('/project/node_modules')).toBe(false);
  });

  it('preserves the exact empty result shape and performs zero installer calls', async () => {
    const vfs = await project();
    const assets = installer();
    const result = await install(
      'root',
      '1.0.0',
      { plain: '1.0.0' },
      {
        vfs,
        cwd: '/project',
        registry: new InstallRegistry(),
        shadowAssets: { installer: assets },
      },
    );
    expect('shadowAssets' in result).toBe(false);
    expect(assets.ensure).not.toHaveBeenCalled();
  });

  it('returns a typed post-tree failure carrying the exact tree result and plan', async () => {
    const vfs = await project();
    const assets = installer(async (plan) => {
      throw new ShadowAssetError({
        message: 'persistence failed',
        requiredSetDigest: plan.requiredSetDigest,
        assetId: plan.assets[0]?.id,
        phase: 'persist',
        transports: [],
        recovery: 'clear-and-retry',
      });
    });
    let thrown: unknown;
    try {
      await install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: new InstallRegistry(),
          shadowAssets: { installer: assets },
        },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ShadowAssetInstallError);
    expect(thrown).toMatchObject({ code: 'ESHADOWASSET', phase: 'persist' });
    expect((thrown as ShadowAssetInstallError).treeResult.packages).not.toHaveLength(0);
    expect(await vfs.exists('/project/node_modules/@esbuild/wasi-preview1/package.json')).toBe(
      true,
    );
    expect(await vfs.exists('/project/package-lock.json')).toBe(true);
  });

  it('re-stamps forged installer failure evidence to the exact operation plan', async () => {
    const vfs = await project();
    const assets = installer(async () => {
      throw new ShadowAssetError({
        message: 'foreign failure evidence',
        requiredSetDigest: 'f'.repeat(64),
        assetId: 'foreign-runtime',
        phase: 'persist',
        transports: [],
        recovery: 'clear-and-retry',
      });
    });

    let thrown: unknown;
    try {
      await install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: new InstallRegistry(),
          shadowAssets: { installer: assets },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShadowAssetInstallError);
    const failure = thrown as ShadowAssetInstallError;
    expect(failure.requiredSetDigest).toBe(failure.plan.requiredSetDigest);
    expect(failure.assetId).toBeUndefined();
    expect(failure.cause).toBeInstanceOf(ShadowAssetError);
  });
});
