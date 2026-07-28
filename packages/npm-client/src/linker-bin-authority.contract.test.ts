import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import {
  type PreparedInstallPackage,
  type ResolvedPackage,
  preflightPackageInstallPaths,
} from './linker.ts';

const encoder = new TextEncoder();

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

interface PackageBinPhaseApi {
  preflightPackageBins(
    current: readonly PreparedPackageBinSource[],
    prior?: readonly PreparedPackageBinSource[],
  ): readonly PackageBinClaim[];
  linkInstallPackageFiles(
    vfs: Vfs,
    root: string,
    packages: readonly PreparedInstallPackage[],
    checkpoint: () => void,
  ): Promise<void>;
  linkInstallPackageBins(
    vfs: Vfs,
    root: string,
    claims: readonly PackageBinClaim[],
    checkpoint: () => void,
  ): Promise<void>;
}

const contractApi = linker as unknown as Partial<PackageBinPhaseApi>;

type AcceptAnythingPhase = (...args: unknown[]) => unknown;
type PhaseExport<TKey extends PropertyKey> = TKey extends keyof typeof linker
  ? Extract<(typeof linker)[TKey], (...args: never[]) => unknown>
  : AcceptAnythingPhase;

function proveRawPhaseIngressIsRejected(
  preflight: PhaseExport<'preflightPackageBins'>,
  linkFiles: PhaseExport<'linkInstallPackageFiles'>,
  linkBins: PhaseExport<'linkInstallPackageBins'>,
  vfs: Vfs,
  raw: ResolvedPackage,
  checkpoint: () => void,
): void {
  // @ts-expect-error Contract: bin preflight accepts only narrow prepared sources.
  preflight([raw]);
  // @ts-expect-error Contract: the file phase accepts only prepared install packages.
  linkFiles(vfs, '/project', [raw], checkpoint);
  // @ts-expect-error Contract: the bin phase accepts only detached shaped claims.
  linkBins(vfs, '/project', [raw], checkpoint);
}

void proveRawPhaseIngressIsRejected;

afterEach(() => {
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function requireContractFunction<K extends keyof PackageBinPhaseApi>(
  name: K,
): PackageBinPhaseApi[K] {
  const candidate = contractApi[name];
  expect(candidate, `${name} package-private linker seam`).toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error(`Contract RED: linker is missing ${name}`);
  }
  return candidate as PackageBinPhaseApi[K];
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

interface ObservedPriorSource {
  readonly value: PreparedPackageBinSource;
  readonly reads: () => number;
}

function observedPriorSource(
  name: string,
  nodeModulesDir: string,
  bin: string | Record<string, string>,
): ObservedPriorSource {
  const packageValue: { name: string; bin?: string | Record<string, string> } = { name };
  let reads = 0;
  Object.defineProperty(packageValue, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      if (reads > 1) throw new Error('authoritative prior bin normalized more than once');
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
  readonly poisonBin: () => void;
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
      if (binReads > 1) {
        return { sentinel: 'bin/second-normalization-must-not-run.js' };
      }
      return bin;
    },
  });
  return {
    value,
    pathReads: () => pathReads,
    binReads: () => binReads,
    poisonBin: () => {
      Object.defineProperty(value, 'bin', {
        configurable: true,
        enumerable: true,
        get: () => {
          throw new Error('raw package bin read after preflight');
        },
      });
    },
  };
}

interface BinPassLedger {
  readonly targetReads: string[];
  readonly launcherWrites: string[];
  readonly restore: () => void;
}

function observeBinPass(
  vfs: MemoryVfs,
  targets: ReadonlySet<string>,
  launchers: ReadonlySet<string>,
): BinPassLedger {
  const targetReads: string[] = [];
  const launcherWrites: string[] = [];
  const readFile = vfs.readFile.bind(vfs);
  const writeFile = vfs.writeFile.bind(vfs);
  const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (targets.has(path)) targetReads.push(path);
    return await readFile(path);
  });
  const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
    if (launchers.has(path)) launcherWrites.push(path);
    await writeFile(path, data);
  });
  return {
    targetReads,
    launcherWrites,
    restore: () => {
      read.mockRestore();
      write.mockRestore();
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

describe('package-bin linker authority', () => {
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
    '[fault: frozen-assumption] rejects ambiguous current claims before a %s tree exists (%s)',
    async (_scope, _order, packages) => {
      const vfs = await project();
      let caught: unknown;

      try {
        await linker.link(vfs, '/project', packages);
      } catch (error) {
        caught = error;
      }

      expectCollision(caught);
      expect(await vfs.exists('/project/node_modules')).toBe(false);
    },
  );

  it('[fault: observable-order] keeps equal command text independent across root and nested scopes', async () => {
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

  it('[fault: observable-order] completes every package file before the first launcher write', async () => {
    const vfs = await project();
    const events: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      events.push(path.includes('/.bin/') ? `bin:${path}` : `file:${path}`);
      await writeFile(path, data);
    });

    await linker.link(vfs, '/project', [
      pkg('first-cli', 'node_modules/first-cli', 'first', 'bin/first.js'),
      pkg('second-cli', 'node_modules/second-cli', 'second', 'bin/second.js'),
    ]);

    const firstBin = events.findIndex((event) => event.startsWith('bin:'));
    const lastFile = events.findLastIndex((event) => event.startsWith('file:'));
    expect.soft(firstBin).toBeGreaterThan(-1);
    expect.soft(lastFile).toBeGreaterThan(-1);
    expect(firstBin).toBeGreaterThan(lastFile);
  });

  it.each(['public link', 'install tree', 'prepared tree', 'phased'] as const)(
    '[fault: sibling-drift] runs one prepared package-bin pass through the %s entrypoint',
    async (entrypoint) => {
      const root = observedPackage(
        pkg('phase-root', 'node_modules/phase-root', 'phase-root', './bin/root.js'),
        './bin/root.js',
      );
      const nested = observedPackage(
        pkg(
          'phase-nested',
          'node_modules/host/node_modules/phase-nested',
          'nested-phase',
          './bin/nested.js',
        ),
        { 'nested-phase': './bin/nested.js' },
      );
      const packages = [root.value, nested.value];
      const vfs = await project();
      const targetPaths = [
        '/project/node_modules/phase-root/bin/root.js',
        '/project/node_modules/host/node_modules/phase-nested/bin/nested.js',
      ];
      const launcherPaths = [
        '/project/node_modules/.bin/phase-root',
        '/project/node_modules/host/node_modules/.bin/nested-phase',
      ];
      const ledger = observeBinPass(vfs, new Set(targetPaths), new Set(launcherPaths));

      if (entrypoint === 'public link') {
        await linker.link(vfs, '/project', packages);
      } else if (entrypoint === 'install tree') {
        await linker.linkInstallTree(vfs, '/project', packages, () => {});
      } else {
        const prepared = preflightPackageInstallPaths(packages);
        if (entrypoint === 'prepared tree') {
          await linker.linkPreparedInstallTree(vfs, '/project', prepared, () => {});
        } else {
          for (const phase of [
            'preflightPackageBins',
            'linkInstallPackageFiles',
            'linkInstallPackageBins',
          ]) {
            expect(npmClientRoot).not.toHaveProperty(phase);
          }
          const preflight = requireContractFunction('preflightPackageBins');
          const linkFiles = requireContractFunction('linkInstallPackageFiles');
          const linkBins = requireContractFunction('linkInstallPackageBins');
          const preparedClaims = preflight(prepared);
          expect(preparedClaims).not.toBe(prepared);
          expect(preparedClaims).not.toContain(root.value);
          expect(preparedClaims).not.toContain(nested.value);
          const claims = structuredClone(preparedClaims);
          expect(claims).toEqual([
            {
              nodeModulesDir: 'node_modules',
              command: 'phase-root',
              owner: 'phase-root',
              target: 'bin/root.js',
            },
            {
              nodeModulesDir: 'node_modules/host/node_modules',
              command: 'nested-phase',
              owner: 'phase-nested',
              target: 'bin/nested.js',
            },
          ]);

          await linkFiles(vfs, '/project', prepared, () => {});
          expect(await vfs.exists(launcherPaths[0] ?? '')).toBe(false);
          expect(await vfs.exists(launcherPaths[1] ?? '')).toBe(false);
          root.poisonBin();
          nested.poisonBin();
          await linkBins(vfs, '/project', claims, () => {});
        }
      }

      expect(root.pathReads()).toBe(1);
      expect(nested.pathReads()).toBe(1);
      expect(root.binReads()).toBe(1);
      expect(nested.binReads()).toBe(1);
      expect(ledger.targetReads).toEqual(targetPaths);
      expect(ledger.launcherWrites).toEqual(launcherPaths);
      ledger.restore();
      expect(await vfs.readFileText(launcherPaths[0] ?? '')).toBe(
        "#!/usr/bin/env node\nimport('../phase-root/bin/root.js');\n",
      );
      expect(await vfs.readFileText(launcherPaths[1] ?? '')).toBe(
        "#!/usr/bin/env node\nimport('../phase-nested/bin/nested.js');\n",
      );
      expect(await vfs.exists('/project/node_modules/.bin/sentinel')).toBe(false);
      expect(await vfs.exists('/project/node_modules/host/node_modules/.bin/sentinel')).toBe(false);
    },
  );

  it.each(['root', 'nested'] as const)(
    '[fault: torn-state] aborts a parked %s target read before launcher write and retries exactly',
    async (scope) => {
      const preflightPackageBins = requireContractFunction('preflightPackageBins');
      const linkFiles = requireContractFunction('linkInstallPackageFiles');
      const linkBins = requireContractFunction('linkInstallPackageBins');
      const vfs = await project();
      const nodeModulesDir = scope === 'root' ? 'node_modules' : 'node_modules/host/node_modules';
      const prepared = preflightPackageInstallPaths([
        pkg('abort-cli', `${nodeModulesDir}/abort-cli`, 'abort', 'bin/abort.js'),
        pkg('later-cli', `${nodeModulesDir}/later-cli`, 'later', 'bin/later.js'),
      ]);
      const claims = preflightPackageBins(prepared);
      expect(claims).toHaveLength(2);
      const parkedClaim = claims[0];
      const laterClaim = claims[1];
      if (!parkedClaim || !laterClaim) throw new Error('two ordered bin claims required');
      const targetPath = (claim: PackageBinClaim): string =>
        `/project/${claim.nodeModulesDir}/${claim.owner}/${claim.target}`;
      const launcherPath = (claim: PackageBinClaim): string =>
        `/project/${claim.nodeModulesDir}/.bin/${claim.command}`;
      await linkFiles(vfs, '/project', prepared, () => {});

      const readStarted = deferred<void>();
      const releaseRead = deferred<void>();
      let laterTargetRead = false;
      const readFile = vfs.readFile.bind(vfs);
      const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
        if (path === targetPath(parkedClaim)) {
          readStarted.resolve();
          await releaseRead.promise;
        }
        if (path === targetPath(laterClaim)) laterTargetRead = true;
        return await readFile(path);
      });
      const controller = new AbortController();
      const reason = new Error(`cancel ${scope} package-bin target read`);
      const checkpoint = (): void => {
        if (controller.signal.aborted) throw controller.signal.reason;
      };
      const linking = linkBins(vfs, '/project', claims, checkpoint);

      await readStarted.promise;
      controller.abort(reason);
      releaseRead.resolve();
      await expect(linking).rejects.toBe(reason);
      expect(laterTargetRead).toBe(false);
      expect(await vfs.exists(launcherPath(parkedClaim))).toBe(false);
      expect(await vfs.exists(launcherPath(laterClaim))).toBe(false);

      read.mockRestore();
      await linkBins(vfs, '/project', claims, () => {});
      for (const claim of claims) {
        expect(await vfs.readFileText(launcherPath(claim))).toBe(
          `#!/usr/bin/env node\nimport('../${claim.owner}/${claim.target}');\n`,
        );
      }
    },
  );

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a %s launcher write loud and retries through the same writer',
    async (code) => {
      const linkFiles = requireContractFunction('linkInstallPackageFiles');
      const linkBins = requireContractFunction('linkInstallPackageBins');
      const preflightPackageBins = requireContractFunction('preflightPackageBins');
      const vfs = await project();
      const prepared = preflightPackageInstallPaths([
        pkg('fault-cli', 'node_modules/fault-cli', 'fault', 'bin/fault.js'),
      ]);
      const launcherPath = '/project/node_modules/.bin/fault';
      const claims = preflightPackageBins(prepared);
      await linkFiles(vfs, '/project', prepared, () => {});

      const failure = Object.assign(new Error(`${code}: launcher write denied`), { code });
      const writeFile = vfs.writeFile.bind(vfs);
      const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (path === launcherPath) throw failure;
        await writeFile(path, data);
      });

      await expect(linkBins(vfs, '/project', claims, () => {})).rejects.toBe(failure);
      expect(await vfs.exists(launcherPath)).toBe(false);

      write.mockRestore();
      await linkBins(vfs, '/project', claims, () => {});
      expect(await vfs.readFileText(launcherPath)).toBe(
        "#!/usr/bin/env node\nimport('../fault-cli/bin/fault.js');\n",
      );
    },
  );

  it('[fault: observable-order] rejects a prior owner transition', () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const current = preflightPackageInstallPaths([
      pkg('current-cli', 'node_modules/current-cli', 'shared', 'bin/current.js'),
    ]);
    const prior = [priorSource('prior-cli', 'node_modules', { shared: 'bin/prior.js' })];

    expectSyncCollision(() => preflight(current, prior));
  });

  it('[fault: frozen-assumption] rejects a recorded prior collision even with one current claimant', () => {
    const preflight = requireContractFunction('preflightPackageBins');
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
    const preflight = requireContractFunction('preflightPackageBins');
    const current = preflightPackageInstallPaths([]);
    const prior = [priorSource('prior-cli', 'node_modules', { shared: 'bin/prior.js' })];

    expectSyncCollision(() => preflight(current, prior));
  });

  it('[fault: observable-order] links only current string/object targets for a stable recorded owner', async () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const linkFiles = requireContractFunction('linkInstallPackageFiles');
    const linkBins = requireContractFunction('linkInstallPackageBins');
    const root = observedPackage(
      pkg('root-cli', 'node_modules/root-cli', 'root-cli', './bin/current-root.js'),
      './bin/current-root.js',
    );
    const nested = observedPackage(
      pkg(
        'nested-cli',
        'node_modules/host/node_modules/nested-cli',
        'nested-command',
        './bin/current-nested.js',
      ),
      { 'nested-command': './bin/current-nested.js' },
    );
    const current = preflightPackageInstallPaths([root.value, nested.value]);
    const rootPrior = observedPriorSource('root-cli', 'node_modules', 'bin/prior-root.js');
    const nestedPrior = observedPriorSource('nested-cli', 'node_modules/host/node_modules', {
      'nested-command': 'bin/prior-nested.js',
    });
    const prior = [rootPrior.value, nestedPrior.value];
    const claims = structuredClone(preflight(current, prior));
    expect(rootPrior.reads()).toBe(1);
    expect(nestedPrior.reads()).toBe(1);
    expect(claims).toEqual([
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

    const vfs = await project();
    await linkFiles(vfs, '/project', current, () => {});
    root.poisonBin();
    nested.poisonBin();
    const currentTargets = [
      '/project/node_modules/root-cli/bin/current-root.js',
      '/project/node_modules/host/node_modules/nested-cli/bin/current-nested.js',
    ];
    const currentLaunchers = [
      '/project/node_modules/.bin/root-cli',
      '/project/node_modules/host/node_modules/.bin/nested-command',
    ];
    const ledger = observeBinPass(vfs, new Set(currentTargets), new Set(currentLaunchers));
    await linkBins(vfs, '/project', claims, () => {});

    expect(root.pathReads()).toBe(1);
    expect(nested.pathReads()).toBe(1);
    expect(root.binReads()).toBe(1);
    expect(nested.binReads()).toBe(1);
    expect(ledger.targetReads).toEqual(currentTargets);
    expect(ledger.launcherWrites).toEqual(currentLaunchers);
    ledger.restore();
    expect(await vfs.readFileText(currentLaunchers[0] ?? '')).toBe(
      "#!/usr/bin/env node\nimport('../root-cli/bin/current-root.js');\n",
    );
    expect(await vfs.readFileText(currentLaunchers[1] ?? '')).toBe(
      "#!/usr/bin/env node\nimport('../nested-cli/bin/current-nested.js');\n",
    );
    expect(await vfs.exists('/project/node_modules/root-cli/bin/prior-root.js')).toBe(false);
    expect(
      await vfs.exists('/project/node_modules/host/node_modules/nested-cli/bin/prior-nested.js'),
    ).toBe(false);
  });

  it('[fault: corrupt-input] rejects an escaping bin target before project-tree mutation', async () => {
    const vfs = await project();
    const invalid = pkg('bad-target', 'node_modules/bad-target', 'bad', '../escape.js');

    await expect(linker.link(vfs, '/project', [invalid])).rejects.toThrow(
      /Invalid package bin target/,
    );

    expect(await vfs.exists('/project/node_modules')).toBe(false);
  });

  it('[fault: corrupt-input] keeps a missing target loud and writes no launcher', async () => {
    const vfs = await project();
    const missing: ResolvedPackage = {
      ...pkg('liar', 'node_modules/liar', 'liar', 'bin/missing.js'),
      files: {
        'package.json': encoder.encode(JSON.stringify({ name: 'liar', version: '1.0.0' })),
      },
    };

    await expect(linker.link(vfs, '/project', [missing])).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/project/node_modules/liar/bin/missing.js',
    });
    expect(await vfs.exists('/project/node_modules/.bin/liar')).toBe(false);

    missing.files['bin/missing.js'] = encoder.encode('throw new Error("repaired");\n');
    await linker.link(vfs, '/project', [missing]);
    expect(await vfs.readFileText('/project/node_modules/.bin/liar')).toBe(
      "#!/usr/bin/env node\nimport('../liar/bin/missing.js');\n",
    );
  });
});
