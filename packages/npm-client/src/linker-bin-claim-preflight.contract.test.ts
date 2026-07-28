import { readFile } from 'node:fs/promises';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import {
  type PreparedInstallPackage,
  type ResolvedPackage,
  preflightPackageInstallPaths,
} from './linker.ts';

const encoder = new TextEncoder();
const compatMatrixUrl = new URL('../../../docs/public/compat/package-tooling.md', import.meta.url);

interface PreparedPackageBinSource {
  readonly package: Pick<ResolvedPackage, 'name' | 'bin'>;
  readonly nodeModulesDir: string;
}

interface PackageBinClaim {
  readonly nodeModulesDir: string;
  readonly command: string;
  readonly owner: string;
  readonly target: string;
}

interface PackageBinPreflightApi {
  preflightPackageBins(
    current: readonly PreparedPackageBinSource[],
    prior?: readonly PreparedPackageBinSource[],
  ): readonly PackageBinClaim[];
}

const contractApi = linker as unknown as Partial<PackageBinPreflightApi>;

type MissingPreflight = (
  current: readonly (PreparedPackageBinSource | ResolvedPackage | PackageBinClaim)[],
  prior?: readonly PreparedPackageBinSource[],
) => readonly PackageBinClaim[];
type PhaseExport<TKey extends PropertyKey> = TKey extends keyof typeof linker
  ? Extract<(typeof linker)[TKey], (...args: never[]) => unknown>
  : MissingPreflight;
type PreflightExport = PhaseExport<'preflightPackageBins'>;

function proveBinPreflightCarrierTypes(
  preflight: PreflightExport,
  prepared: PreparedInstallPackage,
  narrow: PreparedPackageBinSource,
  raw: ResolvedPackage,
  claim: PackageBinClaim,
): void {
  const preparedClaims: readonly PackageBinClaim[] = preflight([prepared], [narrow]);
  const narrowClaims: readonly PackageBinClaim[] = preflight([narrow], [narrow]);
  // @ts-expect-error Contract: raw resolved packages are not bin-preflight sources.
  preflight([raw]);
  // @ts-expect-error Contract: shaped output claims are not bin-preflight sources.
  preflight([claim]);
  void preparedClaims;
  void narrowClaims;
}

void proveBinPreflightCarrierTypes;

afterEach(() => {
  vi.restoreAllMocks();
});

function requirePreflight(): PackageBinPreflightApi['preflightPackageBins'] {
  const candidate = contractApi.preflightPackageBins;
  expect(candidate, 'preflightPackageBins package-private linker seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing preflightPackageBins');
  }
  return candidate;
}

function pkg(name: string, installPath: string, command: string, target: string): ResolvedPackage {
  const fileTarget = target.replace(/^\.\//, '');
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    bin: { [command]: target },
    files: {
      'package.json': encoder.encode(JSON.stringify({ name, version: '1.0.0' })),
      [fileTarget]: encoder.encode(`throw new Error(${JSON.stringify(name)});\n`),
    },
  };
}

function priorSource(
  name: string,
  nodeModulesDir: string,
  bin: string | Record<string, string>,
): PreparedPackageBinSource {
  return { package: { name, bin }, nodeModulesDir };
}

interface ObservedSource {
  readonly value: PreparedPackageBinSource;
  readonly reads: () => number;
}

function observedSource(
  name: string,
  nodeModulesDir: string,
  bin: string | Record<string, string>,
): ObservedSource {
  const packageValue: { name: string; bin?: string | Record<string, string> } = { name };
  let reads = 0;
  Object.defineProperty(packageValue, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      if (reads > 1) throw new Error(`${name} bin normalized more than once`);
      return bin;
    },
  });
  return {
    value: { package: packageValue, nodeModulesDir },
    reads: () => reads,
  };
}

interface ObservedPackage {
  readonly value: ResolvedPackage;
  readonly pathReads: () => number;
  readonly binReads: () => number;
}

function observedPackage(
  value: ResolvedPackage,
  bin: NonNullable<ResolvedPackage['bin']>,
): ObservedPackage {
  const installPath = value.installPath;
  let pathReads = 0;
  let binReads = 0;
  Object.defineProperty(value, 'installPath', {
    configurable: true,
    enumerable: true,
    get: () => {
      pathReads += 1;
      if (pathReads > 1) throw new Error('raw package installPath read after preflight');
      return installPath;
    },
  });
  Object.defineProperty(value, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      binReads += 1;
      if (binReads > 1) throw new Error('package bin normalized more than once');
      return bin;
    },
  });
  return {
    value,
    pathReads: () => pathReads,
    binReads: () => binReads,
  };
}

interface MutationLedger {
  readonly operations: readonly string[];
  readonly restore: () => void;
}

function observeMutations(vfs: MemoryVfs): MutationLedger {
  const operations: string[] = [];
  const mkdir = vfs.mkdir.bind(vfs);
  const writeFile = vfs.writeFile.bind(vfs);
  const rm = vfs.rm.bind(vfs);
  const utimes = vfs.utimes.bind(vfs);
  const mkdirSpy = vi.spyOn(vfs, 'mkdir').mockImplementation(async (path, options) => {
    operations.push(`mkdir:${path}`);
    await mkdir(path, options);
  });
  const writeSpy = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
    operations.push(`write:${path}`);
    await writeFile(path, data);
  });
  const rmSpy = vi.spyOn(vfs, 'rm').mockImplementation(async (path, options) => {
    operations.push(`rm:${path}`);
    await rm(path, options);
  });
  const utimesSpy = vi.spyOn(vfs, 'utimes').mockImplementation(async (path, atimeMs, mtimeMs) => {
    operations.push(`utimes:${path}`);
    await utimes(path, atimeMs, mtimeMs);
  });
  return {
    operations,
    restore: () => {
      mkdirSpy.mockRestore();
      writeSpy.mockRestore();
      rmSpy.mockRestore();
      utimesSpy.mockRestore();
    },
  };
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return vfs;
}

function expectCollision(error: unknown): void {
  expect.soft(error).toBeInstanceOf(NotImplementedError);
  expect
    .soft((error as NotImplementedError | undefined)?.feature)
    .toBe('npm-client.bin-collision-reify');
}

function expectSyncCollision(run: () => void): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expectCollision(caught);
}

function parseCompatRows(
  markdown: string,
): ReadonlyMap<string, { readonly status: string; readonly notes: string }> {
  const rows = new Map<string, { readonly status: string; readonly notes: string }>();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const [feature, status, notes] = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!feature || !status || !notes || !['✅', '⚠️', '❌'].includes(status)) continue;
    rows.set(feature, { status, notes });
  }
  return rows;
}

describe('package-bin claim preflight authority', () => {
  it.each([
    [
      'root',
      'forward',
      [
        pkg('a-a', 'node_modules/a-a', 'shared', 'bin/a.js'),
        pkg('a_a', 'node_modules/a_a', 'shared', 'bin/a.js'),
      ],
    ],
    [
      'root',
      'reverse',
      [
        pkg('a_a', 'node_modules/a_a', 'shared', 'bin/a.js'),
        pkg('a-a', 'node_modules/a-a', 'shared', 'bin/a.js'),
      ],
    ],
    [
      'nested',
      'forward',
      [
        pkg('a-a', 'node_modules/host/node_modules/a-a', 'shared', 'bin/a.js'),
        pkg('a_a', 'node_modules/host/node_modules/a_a', 'shared', 'bin/a.js'),
      ],
    ],
    [
      'nested',
      'reverse',
      [
        pkg('a_a', 'node_modules/host/node_modules/a_a', 'shared', 'bin/a.js'),
        pkg('a-a', 'node_modules/host/node_modules/a-a', 'shared', 'bin/a.js'),
      ],
    ],
  ] as const)(
    '[fault: frozen-assumption] rejects ambiguous current claims before any %s mutation (%s)',
    async (_scope, _order, packages) => {
      const vfs = await project();
      const mutations = observeMutations(vfs);
      let caught: unknown;

      try {
        await linker.link(vfs, '/project', packages);
      } catch (error) {
        caught = error;
      }

      expectCollision(caught);
      expect(mutations.operations).toEqual([]);
      mutations.restore();
    },
  );

  it('[fault: observable-order] keeps equal command text independent across scopes', async () => {
    const vfs = await project();

    await linker.link(vfs, '/project', [
      pkg('root-cli', 'node_modules/root-cli', 'shared', 'bin/root.js'),
      pkg('nested-cli', 'node_modules/host/node_modules/nested-cli', 'shared', 'bin/nested.js'),
    ]);

    expect(await vfs.readFileText('/project/node_modules/.bin/shared')).toBe(
      "#!/usr/bin/env node\nimport('../root-cli/bin/root.js');\n",
    );
    expect(await vfs.readFileText('/project/node_modules/host/node_modules/.bin/shared')).toBe(
      "#!/usr/bin/env node\nimport('../nested-cli/bin/nested.js');\n",
    );
  });

  it('[fault: observable-order] returns equal commands as exact independent scoped claims', () => {
    const preflight = requirePreflight();

    expect(
      structuredClone(
        preflight([
          priorSource('root-cli', 'node_modules', { shared: './bin/root.js' }),
          priorSource('nested-cli', 'node_modules/host/node_modules', {
            shared: './bin/nested.js',
          }),
        ]),
      ),
    ).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'shared',
        owner: 'root-cli',
        target: 'bin/root.js',
      },
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'shared',
        owner: 'nested-cli',
        target: 'bin/nested.js',
      },
    ]);
  });

  it.each(['public link', 'install tree', 'prepared tree', 'preflight'] as const)(
    '[fault: sibling-drift] normalizes each prepared source once through %s',
    async (entrypoint) => {
      const root = observedPackage(
        pkg('claim-root', 'node_modules/claim-root', 'claim-root', './bin/root.js'),
        './bin/root.js',
      );
      const nested = observedPackage(
        pkg(
          'claim-nested',
          'node_modules/host/node_modules/claim-nested',
          'nested-claim',
          './bin/nested.js',
        ),
        { 'nested-claim': './bin/nested.js' },
      );
      const packages = [root.value, nested.value];
      const expectedClaims = [
        {
          nodeModulesDir: 'node_modules',
          command: 'claim-root',
          owner: 'claim-root',
          target: 'bin/root.js',
        },
        {
          nodeModulesDir: 'node_modules/host/node_modules',
          command: 'nested-claim',
          owner: 'claim-nested',
          target: 'bin/nested.js',
        },
      ];

      if (entrypoint === 'preflight') {
        const prepared = preflightPackageInstallPaths(packages);
        expect(npmClientRoot).not.toHaveProperty('preflightPackageBins');
        expect(structuredClone(requirePreflight()(prepared))).toEqual(expectedClaims);
      } else {
        const vfs = await project();
        if (entrypoint === 'public link') {
          await linker.link(vfs, '/project', packages);
        } else if (entrypoint === 'install tree') {
          await linker.linkInstallTree(vfs, '/project', packages, () => {});
        } else {
          const prepared = preflightPackageInstallPaths(packages);
          await linker.linkPreparedInstallTree(vfs, '/project', prepared, () => {});
        }
        expect(await vfs.readFileText('/project/node_modules/.bin/claim-root')).toBe(
          "#!/usr/bin/env node\nimport('../claim-root/bin/root.js');\n",
        );
        expect(
          await vfs.readFileText('/project/node_modules/host/node_modules/.bin/nested-claim'),
        ).toBe("#!/usr/bin/env node\nimport('../claim-nested/bin/nested.js');\n");
      }

      expect(root.pathReads()).toBe(1);
      expect(nested.pathReads()).toBe(1);
      expect(root.binReads()).toBe(1);
      expect(nested.binReads()).toBe(1);
    },
  );

  it('[fault: observable-order] rejects a prior owner transition', () => {
    const preflight = requirePreflight();
    const current = preflightPackageInstallPaths([
      pkg('current-cli', 'node_modules/current-cli', 'shared', 'bin/current.js'),
    ]);
    const prior = [priorSource('prior-cli', 'node_modules', { shared: 'bin/prior.js' })];

    expectSyncCollision(() => preflight(current, prior));
  });

  it('[fault: frozen-assumption] rejects a recorded prior collision', () => {
    const preflight = requirePreflight();
    const current = preflightPackageInstallPaths([
      pkg('provider-a', 'node_modules/provider-a', 'shared', 'bin/a.js'),
    ]);
    const prior = [
      priorSource('provider-a', 'node_modules', { shared: 'bin/a.js' }),
      priorSource('provider-z', 'node_modules', { shared: 'bin/z.js' }),
    ];

    expectSyncCollision(() => preflight(current, prior));
  });

  it('[fault: observable-order] rejects removal of a recorded sole claimant', () => {
    const preflight = requirePreflight();
    const prior = [priorSource('prior-cli', 'node_modules', { shared: 'bin/prior.js' })];

    expectSyncCollision(() => preflight([], prior));
  });

  it('[fault: sibling-drift] accepts narrow current/prior sources once and returns current targets', () => {
    const preflight = requirePreflight();
    const rootCurrent = observedSource('root-cli', 'node_modules', './bin/current-root.js');
    const nestedCurrent = observedSource('nested-cli', 'node_modules/host/node_modules', {
      'nested-command': './bin/current-nested.js',
    });
    const rootPrior = observedSource('root-cli', 'node_modules', 'bin/prior-root.js');
    const nestedPrior = observedSource('nested-cli', 'node_modules/host/node_modules', {
      'nested-command': 'bin/prior-nested.js',
    });

    expect(
      structuredClone(
        preflight([rootCurrent.value, nestedCurrent.value], [rootPrior.value, nestedPrior.value]),
      ),
    ).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'root-cli',
        owner: 'root-cli',
        target: 'bin/current-root.js',
      },
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'nested-command',
        owner: 'nested-cli',
        target: 'bin/current-nested.js',
      },
    ]);
    expect(rootCurrent.reads()).toBe(1);
    expect(nestedCurrent.reads()).toBe(1);
    expect(rootPrior.reads()).toBe(1);
    expect(nestedPrior.reads()).toBe(1);
  });

  it('[fault: corrupt-input] rejects an escaping target before any VFS mutation', async () => {
    const vfs = await project();
    const mutations = observeMutations(vfs);

    await expect(
      linker.link(vfs, '/project', [
        pkg('bad-target', 'node_modules/bad-target', 'bad', '../escape.js'),
      ]),
    ).rejects.toThrow(/Invalid package bin target/);

    expect(mutations.operations).toEqual([]);
    mutations.restore();
  });

  it('[fault: provenance-lie] keeps same-command settlement at the exact compat ceiling', async () => {
    const rows = parseCompatRows(await readFile(compatMatrixUrl, 'utf8'));
    const row = rows.get('Same-command package-bin settlement');
    expect(row?.status).toBe('❌');
    expect(row?.notes.match(/`NotImplementedError\('([^']+)'\)`/u)?.[1]).toBe(
      'npm-client.bin-collision-reify',
    );
  });
});
