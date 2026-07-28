import { readFileSync } from 'node:fs';
import { MemoryVfs } from '@riftydev/vfs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as npmClientRoot from './index.ts';
import type { ShadowAssetPlan } from './internal/shadow/planner.ts';
import * as linker from './linker.ts';
import type { ResolvedPackage } from './linker.ts';

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
}

const contractApi = linker as unknown as Partial<InstallPathContractApi>;
const emptyShadowPlan = Object.freeze({
  requiredSetDigest: '0'.repeat(64),
  substitutions: Object.freeze([]),
  assets: Object.freeze([]),
  bindings: Object.freeze([]),
}) satisfies ShadowAssetPlan;

afterEach(() => {
  vi.restoreAllMocks();
});

function requirePreflight(): InstallPathContractApi['preflightPackageInstallPaths'] {
  const candidate = contractApi.preflightPackageInstallPaths;
  expect(candidate, 'package-private resolved-package install-path seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing preflightPackageInstallPaths');
  }
  return candidate;
}

function pkg(name: string, installPath: string | undefined, withBin: boolean): ResolvedPackage {
  const binTarget = 'bin/cli.js';
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    ...(withBin ? { bin: { cli: binTarget } } : {}),
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

type IndexedFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

function topLevelFunctions(source: ts.SourceFile): ReadonlyMap<string, IndexedFunction> {
  const functions = new Map<string, IndexedFunction>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        (ts.isFunctionExpression(declaration.initializer) ||
          ts.isArrowFunction(declaration.initializer))
      ) {
        functions.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return functions;
}

function identifierCallNames(node: ts.Node): readonly string[] {
  const calls: string[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)) {
      calls.push(candidate.expression.text);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return calls;
}

function propertyAccessNames(node: ts.Node): readonly string[] {
  const names: string[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isPropertyAccessExpression(candidate)) names.push(candidate.name.text);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return names;
}

function callersOf(
  functions: ReadonlyMap<string, IndexedFunction>,
  callee: string,
): readonly string[] {
  return [...functions]
    .filter(([, declaration]) => identifierCallNames(declaration).includes(callee))
    .map(([name]) => name);
}

describe('resolved-package install-path authority', () => {
  it('prepares exact omitted, root, nested, and scoped identities with one raw read', () => {
    const preflight = requirePreflight();
    const omitted = pkg('flat-cli', undefined, false);
    const root = pkg('@scope/root-cli', 'node_modules/@scope/root-cli', false);
    const nested = pkg(
      '@tools/nested-cli',
      'node_modules/@scope/host/node_modules/@tools/nested-cli',
      false,
    );
    let nestedReads = 0;
    Object.defineProperty(nested, 'installPath', {
      configurable: true,
      enumerable: true,
      get: () => {
        nestedReads += 1;
        return 'node_modules/@scope/host/node_modules/@tools/nested-cli';
      },
    });

    const prepared = preflight([omitted, root, nested]);

    expect(
      prepared.map(({ relativePath, nodeModulesDir }) => [relativePath, nodeModulesDir]),
    ).toEqual([
      ['node_modules/flat-cli', 'node_modules'],
      ['node_modules/@scope/root-cli', 'node_modules'],
      [
        'node_modules/@scope/host/node_modules/@tools/nested-cli',
        'node_modules/@scope/host/node_modules',
      ],
    ]);
    expect(prepared[0]?.package).toBe(omitted);
    expect(prepared[1]?.package).toBe(root);
    expect(prepared[2]?.package).toBe(nested);
    for (const entry of prepared) {
      expect(Object.keys(entry).sort()).toEqual(['nodeModulesDir', 'package', 'relativePath']);
    }
    expect(nestedReads).toBe(1);
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

  const wrongRootPaths = invalidPaths.filter(
    ({ installPath }) => installPath === 'packages/bad-cli',
  );

  describe.each(['public link', 'install tree', 'lockfile', 'install lockfile'] as const)(
    '%s wrong-root sibling',
    (entrypoint) => {
      it.each(wrongRootPaths)(
        '[fault: corrupt-input] rejects $label before VFS or lock mutation',
        async ({ installPath, withBin }) => {
          const invalid = pkg('bad-cli', installPath, withBin);
          const vfs = await project();
          const mkdir = vi.spyOn(vfs, 'mkdir');
          const writeFile = vi.spyOn(vfs, 'writeFile');
          let caught: unknown;

          try {
            if (entrypoint === 'public link') {
              await linker.link(vfs, '/project', [invalid]);
            } else if (entrypoint === 'install tree') {
              await linker.linkInstallTree(vfs, '/project', [invalid], () => {});
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
          expect.soft(mkdir).not.toHaveBeenCalled();
          expect(writeFile).not.toHaveBeenCalled();
          expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
          expect(await vfs.exists('/project/packages/bad-cli')).toBe(false);
        },
      );
    },
  );

  it.each(['public link', 'install tree'] as const)(
    '[fault: observable-order] %s prepares the complete package set before the first VFS call',
    async (entrypoint) => {
      const vfs = await project();
      const mkdir = vi.spyOn(vfs, 'mkdir');
      const writeFile = vi.spyOn(vfs, 'writeFile');
      const packages = [
        pkg('valid-cli', 'node_modules/valid-cli', true),
        pkg('bad-cli', 'packages/bad-cli', false),
      ];

      if (entrypoint === 'public link') {
        await expect(linker.link(vfs, '/project', packages)).rejects.toMatchObject({
          code: 'EINVALIDPACKAGETAR',
          path: 'packages/bad-cli',
        });
      } else {
        await expect(
          linker.linkInstallTree(vfs, '/project', packages, () => {}),
        ).rejects.toMatchObject({
          code: 'EINVALIDPACKAGETAR',
          path: 'packages/bad-cli',
        });
      }

      expect.soft(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(await vfs.exists('/project/node_modules')).toBe(false);
    },
  );

  it('[fault: sibling-drift] keeps one raw path owner across linker, lockfile, and installer ingress', () => {
    const linkerText = readFileSync(new URL('./linker.ts', import.meta.url), 'utf8');
    const installerText = readFileSync(new URL('./installer.ts', import.meta.url), 'utf8');
    const linkerSource = ts.createSourceFile(
      'linker.ts',
      linkerText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const installerSource = ts.createSourceFile(
      'installer.ts',
      installerText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const linkerFunctions = topLevelFunctions(linkerSource);
    const installerFunctions = topLevelFunctions(installerSource);
    const packageLinkTargets = installerFunctions.get('packageLinkTargets');
    expect.soft(linkerFunctions.has('preflightPackageInstallPaths')).toBe(true);
    expect.soft(packageLinkTargets).toBeDefined();
    if (!packageLinkTargets) throw new Error('installer packageLinkTargets seam missing');

    expect
      .soft([...callersOf(linkerFunctions, 'preflightPackageInstallPaths')].sort())
      .toEqual(['buildLockfile', 'linkTree'].sort());
    expect.soft(callersOf(linkerFunctions, 'buildLockfile')).toContain('buildInstallLockfile');
    expect.soft(identifierCallNames(packageLinkTargets)).toContain('preflightPackageInstallPaths');
    expect.soft(propertyAccessNames(packageLinkTargets)).not.toContain('installPath');
    const pathBoundaryNames = new Set([
      'preflightPackageInstallPaths',
      'linkTree',
      'linkBins',
      'buildLockfile',
      'packageNodeModulesDir',
    ]);
    const rawPathOwners = [...linkerFunctions]
      .filter(
        ([name, declaration]) =>
          pathBoundaryNames.has(name) && propertyAccessNames(declaration).includes('installPath'),
      )
      .map(([name]) => name);
    expect.soft(rawPathOwners).toEqual(['preflightPackageInstallPaths']);
    expect.soft(linkerFunctions.has('packageNodeModulesDir')).toBe(false);
    expect(npmClientRoot).not.toHaveProperty('preflightPackageInstallPaths');
  });
});
