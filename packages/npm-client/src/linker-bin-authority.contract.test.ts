import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import * as linker from './linker.ts';
import type { ResolvedPackage } from './linker.ts';

const encoder = new TextEncoder();

interface PackageBinPhaseApi {
  preflightPackageBins(
    current: readonly ResolvedPackage[],
    prior?: readonly ResolvedPackage[],
  ): readonly unknown[];
  linkInstallPackageFiles(
    vfs: Vfs,
    root: string,
    packages: readonly ResolvedPackage[],
    checkpoint: () => void,
  ): Promise<void>;
  linkInstallPackageBins(
    vfs: Vfs,
    root: string,
    claims: readonly unknown[],
    checkpoint: () => void,
  ): Promise<void>;
}

const contractApi = linker as unknown as Partial<PackageBinPhaseApi>;

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
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    bin: { [command]: target },
    files: {
      'package.json': encoder.encode(JSON.stringify({ name, version: '1.0.0' })),
      [target]: encoder.encode(`throw new Error(${JSON.stringify(name)});\n`),
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

async function expectAsyncCollision(run: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (error) {
    caught = error;
  }
  expectCollision(caught);
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

      await expectAsyncCollision(linker.link(vfs, '/project', packages));

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

  it('[fault: sibling-drift] makes public and phased linking byte-identical through one shaped claim list', async () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const linkFiles = requireContractFunction('linkInstallPackageFiles');
    const linkBins = requireContractFunction('linkInstallPackageBins');
    const publicVfs = await project();
    const phasedVfs = await project();
    const packages = [
      {
        ...pkg('phase-root', 'node_modules/phase-root', 'phase-root', 'bin/root.js'),
        bin: 'bin/root.js',
      },
      pkg(
        'phase-nested',
        'node_modules/host/node_modules/phase-nested',
        'nested-phase',
        'bin/nested.js',
      ),
    ];

    await linker.link(publicVfs, '/project', packages);
    const claims = preflight(packages);
    await linkFiles(phasedVfs, '/project', packages, () => {});
    expect(await phasedVfs.exists('/project/node_modules/.bin/phase-root')).toBe(false);
    expect(
      await phasedVfs.exists('/project/node_modules/host/node_modules/.bin/nested-phase'),
    ).toBe(false);

    await linkBins(phasedVfs, '/project', claims, () => {});
    const expected = new Map([
      [
        '/project/node_modules/phase-root/package.json',
        JSON.stringify({ name: 'phase-root', version: '1.0.0' }),
      ],
      ['/project/node_modules/phase-root/bin/root.js', 'throw new Error("phase-root");\n'],
      [
        '/project/node_modules/.bin/phase-root',
        "#!/usr/bin/env node\nimport('../phase-root/bin/root.js');\n",
      ],
      [
        '/project/node_modules/host/node_modules/phase-nested/package.json',
        JSON.stringify({ name: 'phase-nested', version: '1.0.0' }),
      ],
      [
        '/project/node_modules/host/node_modules/phase-nested/bin/nested.js',
        'throw new Error("phase-nested");\n',
      ],
      [
        '/project/node_modules/host/node_modules/.bin/nested-phase',
        "#!/usr/bin/env node\nimport('../phase-nested/bin/nested.js');\n",
      ],
    ]);
    for (const [path, bytes] of expected) {
      expect(await phasedVfs.readFileText(path)).toBe(bytes);
      expect(await publicVfs.readFileText(path)).toBe(bytes);
    }
  });

  it.each(['root', 'nested'] as const)(
    '[fault: torn-state] aborts a parked %s target read before launcher write and retries exactly',
    async (scope) => {
      const preflightPackageBins = requireContractFunction('preflightPackageBins');
      const linkFiles = requireContractFunction('linkInstallPackageFiles');
      const linkBins = requireContractFunction('linkInstallPackageBins');
      const vfs = await project();
      const installPath =
        scope === 'root' ? 'node_modules/abort-cli' : 'node_modules/host/node_modules/abort-cli';
      const packageRoot = `/project/${installPath}`;
      const launcherPath =
        scope === 'root'
          ? '/project/node_modules/.bin/abort'
          : '/project/node_modules/host/node_modules/.bin/abort';
      const packages = [pkg('abort-cli', installPath, 'abort', 'bin/abort.js')];
      const claims = preflightPackageBins(packages);
      await linkFiles(vfs, '/project', packages, () => {});

      const readStarted = deferred<void>();
      const releaseRead = deferred<void>();
      const readFile = vfs.readFile.bind(vfs);
      const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
        if (path === `${packageRoot}/bin/abort.js`) {
          readStarted.resolve();
          await releaseRead.promise;
        }
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
      expect(await vfs.exists(launcherPath)).toBe(false);

      read.mockRestore();
      await linkBins(vfs, '/project', claims, () => {});
      expect(await vfs.readFileText(launcherPath)).toBe(
        "#!/usr/bin/env node\nimport('../abort-cli/bin/abort.js');\n",
      );
    },
  );

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a %s launcher write loud and retries through the same writer',
    async (code) => {
      const linkFiles = requireContractFunction('linkInstallPackageFiles');
      const linkBins = requireContractFunction('linkInstallPackageBins');
      const preflightPackageBins = requireContractFunction('preflightPackageBins');
      const vfs = await project();
      const packages = [pkg('fault-cli', 'node_modules/fault-cli', 'fault', 'bin/fault.js')];
      const launcherPath = '/project/node_modules/.bin/fault';
      const claims = preflightPackageBins(packages);
      await linkFiles(vfs, '/project', packages, () => {});

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
    const current = [pkg('current-cli', 'node_modules/current-cli', 'shared', 'bin/current.js')];
    const prior = [pkg('prior-cli', 'node_modules/prior-cli', 'shared', 'bin/prior.js')];

    expectSyncCollision(() => preflight(current, prior));
  });

  it('[fault: frozen-assumption] rejects a recorded prior collision even with one current claimant', () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const current = [pkg('provider-a', 'node_modules/provider-a', 'shared', 'bin/a.js')];
    const prior = [
      pkg('provider-a', 'node_modules/provider-a', 'shared', 'bin/a.js'),
      pkg('provider-z', 'node_modules/provider-z', 'shared', 'bin/z.js'),
    ];

    expectSyncCollision(() => preflight(current, prior));
  });

  it('[fault: observable-order] rejects removal of a recorded sole claimant', () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const prior = [pkg('prior-cli', 'node_modules/prior-cli', 'shared', 'bin/prior.js')];

    expectSyncCollision(() => preflight([], prior));
  });

  it('[fault: observable-order] admits fresh claims and a stable recorded owner', () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const current = [
      pkg('root-cli', 'node_modules/root-cli', 'shared', 'bin/root.js'),
      pkg('nested-cli', 'node_modules/host/node_modules/nested-cli', 'shared', 'bin/nested.js'),
    ];
    const prior = [
      pkg('root-cli', 'node_modules/root-cli', 'shared', 'bin/old-root.js'),
      pkg('nested-cli', 'node_modules/host/node_modules/nested-cli', 'shared', 'bin/old-nested.js'),
    ];

    expect(() => preflight(current)).not.toThrow();
    expect(() => preflight(current, prior)).not.toThrow();
  });

  it('[fault: corrupt-input] rejects an invalid install path before project-tree mutation', async () => {
    const vfs = await project();
    const invalid = pkg('bad-cli', 'packages/bad-cli', 'bad', 'bin/bad.js');

    await expect(linker.link(vfs, '/project', [invalid])).rejects.toThrow(
      'Invalid package installPath',
    );

    expect(await vfs.exists('/project/node_modules')).toBe(false);
    expect(await vfs.exists('/project/packages/bad-cli')).toBe(false);
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
