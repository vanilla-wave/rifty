import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import {
  type ShadowAssetPlan,
  attestBuiltinShadowSubstitution,
  planTrustedAppliedShadowSubstitutions,
} from './internal/shadow/planner.ts';
import * as linker from './linker.ts';
import type { Lockfile, ResolvedPackage } from './linker.ts';

const encoder = new TextEncoder();

interface PreparedInstallPackage {
  readonly package: ResolvedPackage;
  readonly relativePath: string;
  readonly nodeModulesDir: string;
}

interface InstallPathContractApi {
  preflightPackageInstallPaths(
    packages: readonly ResolvedPackage[],
  ): readonly PreparedInstallPackage[];
  linkPreparedInstallTree(
    vfs: Vfs,
    root: string,
    packages: readonly PreparedInstallPackage[],
    checkpoint: () => void,
  ): Promise<void>;
  buildPreparedInstallLockfile(
    rootName: string,
    rootVersion: string,
    packages: readonly PreparedInstallPackage[],
    plan: ShadowAssetPlan,
  ): Lockfile;
}

const contractApi = linker as unknown as Partial<InstallPathContractApi>;
const emptyShadowPlan = Object.freeze({
  requiredSetDigest: '0'.repeat(64),
  substitutions: Object.freeze([]),
  assets: Object.freeze([]),
  bindings: Object.freeze([]),
}) satisfies ShadowAssetPlan;
const nonEmptyShadowPlan = planTrustedAppliedShadowSubstitutions([
  attestBuiltinShadowSubstitution({
    trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
    installPath: 'node_modules/esbuild',
    acquisition: { kind: 'synthetic' },
  }),
]);

function requirePreflight(): InstallPathContractApi['preflightPackageInstallPaths'] {
  const candidate = contractApi.preflightPackageInstallPaths;
  expect(candidate, 'package-private resolved-package install-path seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing preflightPackageInstallPaths');
  }
  return candidate;
}

function requirePreparedLink(): InstallPathContractApi['linkPreparedInstallTree'] {
  const candidate = contractApi.linkPreparedInstallTree;
  expect(candidate, 'package-private prepared linker seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing linkPreparedInstallTree');
  }
  return candidate;
}

function requirePreparedInstallLockfile(): InstallPathContractApi['buildPreparedInstallLockfile'] {
  const candidate = contractApi.buildPreparedInstallLockfile;
  expect(candidate, 'package-private prepared install-lock seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing buildPreparedInstallLockfile');
  }
  return candidate;
}

function pkg(name: string, installPath: string | undefined, withBin: boolean): ResolvedPackage {
  const binTarget = 'bin/cli.js';
  const command = name.replace('@', '').replace('/', '-');
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    ...(withBin ? { bin: { [command]: binTarget } } : {}),
    files: {
      'package.json': encoder.encode(JSON.stringify({ name, version: '1.0.0' })),
      ...(withBin
        ? { [binTarget]: encoder.encode(`console.log(${JSON.stringify(name)});\n`) }
        : {}),
    },
  };
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return vfs;
}

function recordingVfs(vfs: MemoryVfs, calls: string[]): Vfs {
  return new Proxy(vfs, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => {
        calls.push(String(property));
        return Reflect.apply(value, target, args);
      };
    },
  });
}

const validPaths = [
  {
    name: 'omitted-cli',
    installPath: undefined,
    relativePath: 'node_modules/omitted-cli',
    nodeModulesDir: 'node_modules',
  },
  {
    name: 'flat-cli',
    installPath: 'node_modules/flat-cli',
    relativePath: 'node_modules/flat-cli',
    nodeModulesDir: 'node_modules',
  },
  {
    name: 'nested-cli',
    installPath: 'node_modules/host/node_modules/nested-cli',
    relativePath: 'node_modules/host/node_modules/nested-cli',
    nodeModulesDir: 'node_modules/host/node_modules',
  },
  {
    name: '@tools/nested-cli',
    installPath: 'node_modules/@scope/host/node_modules/@tools/nested-cli',
    relativePath: 'node_modules/@scope/host/node_modules/@tools/nested-cli',
    nodeModulesDir: 'node_modules/@scope/host/node_modules',
  },
] as const;

function validReadOncePackages(): {
  packages: ResolvedPackage[];
  reads: readonly (() => number)[];
} {
  const packages: ResolvedPackage[] = [];
  const reads: Array<() => number> = [];
  for (const value of validPaths) {
    const candidate = pkg(value.name, value.installPath, false);
    let count = 0;
    Object.defineProperty(candidate, 'installPath', {
      configurable: true,
      enumerable: true,
      get: () => {
        count += 1;
        if (count > 1) throw new Error(`poisoned second installPath read for ${value.name}`);
        return value.installPath;
      },
    });
    packages.push(candidate);
    reads.push(() => count);
  }
  return { packages, reads };
}

const binfulPaths = [
  {
    name: 'root-cli',
    installPath: 'node_modules/root-cli',
    relativePath: 'node_modules/root-cli',
    nodeModulesDir: 'node_modules',
  },
  {
    name: 'nested-cli',
    installPath: 'node_modules/host/node_modules/nested-cli',
    relativePath: 'node_modules/host/node_modules/nested-cli',
    nodeModulesDir: 'node_modules/host/node_modules',
  },
] as const;

function binfulReadOncePackages(): {
  packages: ResolvedPackage[];
  reads: readonly (() => number)[];
} {
  const packages: ResolvedPackage[] = [];
  const reads: Array<() => number> = [];
  for (const value of binfulPaths) {
    const candidate = pkg(value.name, value.installPath, true);
    let count = 0;
    Object.defineProperty(candidate, 'installPath', {
      configurable: true,
      enumerable: true,
      get: () => {
        count += 1;
        if (count > 1) throw new Error(`poisoned second installPath read for ${value.name}`);
        return value.installPath;
      },
    });
    packages.push(candidate);
    reads.push(() => count);
  }
  return { packages, reads };
}

async function expectBinfulLinkBytes(vfs: MemoryVfs): Promise<void> {
  for (const value of binfulPaths) {
    expect
      .soft(await vfs.readFileText(`/project/${value.relativePath}/package.json`))
      .toBe(JSON.stringify({ name: value.name, version: '1.0.0' }));
    const command = value.name.replace('@', '').replace('/', '-');
    expect
      .soft(await vfs.readFileText(`/project/${value.nodeModulesDir}/.bin/${command}`))
      .toBe(`#!/usr/bin/env node\nimport('../${value.name}/bin/cli.js');\n`);
  }
}

function expectedBinfulLockfile(): Lockfile {
  return {
    name: 'root',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        version: '1.0.0',
        dependencies: {
          'root-cli': '1.0.0',
        },
      },
      'node_modules/root-cli': {
        version: '1.0.0',
        dependencies: {},
        bin: { 'root-cli': 'bin/cli.js' },
      },
      'node_modules/host/node_modules/nested-cli': {
        version: '1.0.0',
        dependencies: {},
        bin: { 'nested-cli': 'bin/cli.js' },
      },
    },
  };
}

describe('resolved-package linker path authority', () => {
  it('prepares exact omitted, flat, nested, and nested-scoped identities with one raw read', () => {
    const { packages, reads } = validReadOncePackages();
    const prepared = requirePreflight()(packages);

    expect(
      prepared.map(({ relativePath, nodeModulesDir }) => ({ relativePath, nodeModulesDir })),
    ).toEqual(
      validPaths.map(({ relativePath, nodeModulesDir }) => ({ relativePath, nodeModulesDir })),
    );
    for (const [index, entry] of prepared.entries()) {
      expect(entry.package).toBe(packages[index]);
      expect(Object.keys(entry).sort()).toEqual(['nodeModulesDir', 'package', 'relativePath']);
    }
    expect(reads.map((read) => read())).toEqual([1, 1, 1, 1]);
    expect(npmClientRoot).not.toHaveProperty('preflightPackageInstallPaths');
    expect(npmClientRoot).not.toHaveProperty('linkPreparedInstallTree');
    expect(npmClientRoot).not.toHaveProperty('buildPreparedInstallLockfile');
  });

  it('keeps prepared-only link and install-lock cores package-private', () => {
    expect(contractApi.linkPreparedInstallTree).toBeTypeOf('function');
    expect(contractApi.buildPreparedInstallLockfile).toBeTypeOf('function');
    expect(npmClientRoot).not.toHaveProperty('linkPreparedInstallTree');
    expect(npmClientRoot).not.toHaveProperty('buildPreparedInstallLockfile');
  });

  const invalidPaths = [
    {
      label: 'relative traversal retaining the package suffix (binless)',
      installPath: '../outside/node_modules/bad-cli',
      withBin: false,
    },
    {
      label: 'absolute path retaining the package suffix (binful)',
      installPath: '/outside/node_modules/bad-cli',
      withBin: true,
    },
    {
      label: 'safe-relative wrong root (binless)',
      installPath: 'packages/bad-cli',
      withBin: false,
    },
    {
      label: 'safe-relative wrong root (binful)',
      installPath: 'packages/bad-cli',
      withBin: true,
    },
    {
      label: 'safe-relative wrong owner suffix (binful)',
      installPath: 'node_modules/other-cli',
      withBin: true,
    },
    {
      label: 'textual but not segment-exact node_modules suffix (binless)',
      installPath: 'node_modules/xnode_modules/bad-cli',
      withBin: false,
    },
    {
      label: 'dot-segment non-canonical path (binless)',
      installPath: 'node_modules/./bad-cli',
      withBin: false,
    },
    {
      label: 'double-separator non-canonical path (binful)',
      installPath: 'node_modules//bad-cli',
      withBin: true,
    },
  ] as const;

  it.each(invalidPaths)(
    '[fault: corrupt-input] preflight rejects $label with the exact raw path',
    ({ installPath, withBin }) => {
      let caught: unknown;
      try {
        requirePreflight()([pkg('bad-cli', installPath, withBin)]);
      } catch (error) {
        caught = error;
      }

      expect.soft(caught).toBeInstanceOf(Error);
      expect(caught).toMatchObject({
        code: 'EINVALIDPACKAGETAR',
        path: installPath,
      });
    },
  );

  describe.each(['public link', 'install tree', 'lockfile', 'install lockfile'] as const)(
    '%s malformed-path sibling',
    (entrypoint) => {
      it.each(invalidPaths)(
        '[fault: corrupt-input] rejects $label before VFS or lock mutation',
        async ({ installPath, withBin }) => {
          const invalid = pkg('bad-cli', installPath, withBin);
          const vfs = await project();
          const vfsCalls: string[] = [];
          const observedVfs = recordingVfs(vfs, vfsCalls);
          let caught: unknown;

          try {
            if (entrypoint === 'public link') {
              await linker.link(observedVfs, '/project', [invalid]);
            } else if (entrypoint === 'install tree') {
              await linker.linkInstallTree(observedVfs, '/project', [invalid], () => {});
            } else if (entrypoint === 'lockfile') {
              linker.buildLockfile('root', '1.0.0', [invalid]);
            } else {
              linker.buildInstallLockfile('root', '1.0.0', [invalid], emptyShadowPlan);
            }
          } catch (error) {
            caught = error;
          }

          expect.soft(caught).toBeInstanceOf(Error);
          expect.soft(caught).toMatchObject({
            code: 'EINVALIDPACKAGETAR',
            path: installPath,
          });
          expect.soft(vfsCalls).toEqual([]);
          expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
          expect(await vfs.exists('/project/packages/bad-cli')).toBe(false);
        },
      );
    },
  );

  it.each(['public link', 'install tree'] as const)(
    '[fault: observable-order] %s prepares the complete package set before every VFS method',
    async (entrypoint) => {
      const vfs = await project();
      const vfsCalls: string[] = [];
      const observedVfs = recordingVfs(vfs, vfsCalls);
      const packages = [
        pkg('valid-cli', 'node_modules/valid-cli', true),
        pkg('bad-cli', 'packages/bad-cli', false),
      ];

      if (entrypoint === 'public link') {
        await expect(linker.link(observedVfs, '/project', packages)).rejects.toMatchObject({
          code: 'EINVALIDPACKAGETAR',
          path: 'packages/bad-cli',
        });
      } else {
        await expect(
          linker.linkInstallTree(observedVfs, '/project', packages, () => {}),
        ).rejects.toMatchObject({
          code: 'EINVALIDPACKAGETAR',
          path: 'packages/bad-cli',
        });
      }

      expect.soft(vfsCalls).toEqual([]);
      expect(await vfs.exists('/project/node_modules')).toBe(false);
    },
  );

  it('[fault: observable-order] validates every package before a non-empty shadow overlay error', () => {
    const conflicting = pkg('esbuild', 'node_modules/esbuild', false);
    conflicting.version = '0.27.0';
    const invalid = pkg('bad-cli', 'packages/bad-cli', false);
    let caught: unknown;

    try {
      linker.buildInstallLockfile('root', '1.0.0', [conflicting, invalid], nonEmptyShadowPlan);
    } catch (error) {
      caught = error;
    }

    expect.soft(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({
      code: 'EINVALIDPACKAGETAR',
      path: 'packages/bad-cli',
    });
  });

  it.each(['public link', 'install tree', 'lockfile', 'install lockfile'] as const)(
    '[fault: sibling-drift] %s rejects after one poisoned raw-path read',
    async (entrypoint) => {
      const invalid = pkg('bad-cli', 'node_modules/xnode_modules/bad-cli', true);
      let reads = 0;
      Object.defineProperty(invalid, 'installPath', {
        configurable: true,
        enumerable: true,
        get: () => {
          reads += 1;
          if (reads > 1) throw new Error('poisoned second installPath read');
          return 'node_modules/xnode_modules/bad-cli';
        },
      });
      const vfs = await project();
      const vfsCalls: string[] = [];
      const observedVfs = recordingVfs(vfs, vfsCalls);
      let caught: unknown;

      try {
        if (entrypoint === 'public link') {
          await linker.link(observedVfs, '/project', [invalid]);
        } else if (entrypoint === 'install tree') {
          await linker.linkInstallTree(observedVfs, '/project', [invalid], () => {});
        } else if (entrypoint === 'lockfile') {
          linker.buildLockfile('root', '1.0.0', [invalid]);
        } else {
          linker.buildInstallLockfile('root', '1.0.0', [invalid], nonEmptyShadowPlan);
        }
      } catch (error) {
        caught = error;
      }

      expect.soft(caught).toBeInstanceOf(Error);
      expect.soft(caught).toMatchObject({
        code: 'EINVALIDPACKAGETAR',
        path: 'node_modules/xnode_modules/bad-cli',
      });
      expect.soft(reads).toBe(1);
      expect(vfsCalls).toEqual([]);
    },
  );

  it.each(['public link', 'install tree', 'lockfile', 'install lockfile'] as const)(
    '[fault: sibling-drift] %s carries binful root and nested packages after one raw read',
    async (entrypoint) => {
      const { packages, reads } = binfulReadOncePackages();
      const vfs = await project();
      let lockfile: Lockfile | undefined;

      if (entrypoint === 'public link') {
        await linker.link(vfs, '/project', packages);
      } else if (entrypoint === 'install tree') {
        await linker.linkInstallTree(vfs, '/project', packages, () => {});
      } else if (entrypoint === 'lockfile') {
        lockfile = linker.buildLockfile('root', '1.0.0', packages);
      } else if (entrypoint === 'install lockfile') {
        lockfile = linker.buildInstallLockfile('root', '1.0.0', packages, emptyShadowPlan);
      }

      expect.soft(reads.map((read) => read())).toEqual([1, 1]);
      if (entrypoint === 'public link' || entrypoint === 'install tree') {
        await expectBinfulLinkBytes(vfs);
      } else if (lockfile) {
        expect.soft(lockfile).toEqual(expectedBinfulLockfile());
      }
    },
  );

  it('[fault: sibling-drift] one prepared array drives file, bin, and install-lock cores', async () => {
    const { packages, reads } = binfulReadOncePackages();
    const prepared = requirePreflight()(packages);
    const vfs = await project();

    await requirePreparedLink()(vfs, '/project', prepared, () => {});
    const lockfile = requirePreparedInstallLockfile()('root', '1.0.0', prepared, emptyShadowPlan);

    expect.soft(reads.map((read) => read())).toEqual([1, 1]);
    await expectBinfulLinkBytes(vfs);
    expect(lockfile).toEqual(expectedBinfulLockfile());
  });
});
