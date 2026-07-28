import { readFileSync } from 'node:fs';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as linker from './linker.ts';
import type { ResolvedPackage } from './linker.ts';

const encoder = new TextEncoder();

interface PackageBinClaim {
  readonly nodeModulesDir: string;
  readonly command: string;
  readonly owner: string;
  readonly target: string;
}

interface PackageBinPhaseApi {
  preflightPackageBins(
    current: readonly ResolvedPackage[],
    prior?: readonly ResolvedPackage[],
  ): readonly PackageBinClaim[];
  linkInstallPackageFiles(
    vfs: Vfs,
    root: string,
    packages: readonly ResolvedPackage[],
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

interface ObservedBinPackage {
  readonly value: ResolvedPackage;
  readonly reads: () => number;
  readonly poison: () => void;
}

function observedBinPackage(
  value: ResolvedPackage,
  bin: NonNullable<ResolvedPackage['bin']>,
): ObservedBinPackage {
  let reads = 0;
  Object.defineProperty(value, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      if (reads > 1) {
        return { sentinel: 'bin/second-normalization-must-not-run.js' };
      }
      return bin;
    },
  });
  return {
    value,
    reads: () => reads,
    poison: () => {
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

interface IdentifierCall {
  readonly name: string;
  readonly guarded: boolean;
}

function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function makesChildExecutionConditional(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isSwitchStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    (ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind))
  );
}

function identifierCalls(node: IndexedFunction): readonly IdentifierCall[] {
  const calls: IdentifierCall[] = [];
  const visit = (candidate: ts.Node, guarded: boolean): void => {
    if (candidate !== node && isFunctionBoundary(candidate)) return;
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)) {
      calls.push({ name: candidate.expression.text, guarded });
    }
    const childGuarded = guarded || makesChildExecutionConditional(candidate);
    ts.forEachChild(candidate, (child) => visit(child, childGuarded));
  };
  visit(node, false);
  return calls;
}

function memberCallNames(node: IndexedFunction): readonly string[] {
  const calls: string[] = [];
  const visit = (candidate: ts.Node): void => {
    if (candidate !== node && isFunctionBoundary(candidate)) return;
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression)) {
      calls.push(candidate.expression.name.text);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return calls;
}

function allIdentifierCallNames(node: ts.Node): readonly string[] {
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

function allMemberCallNames(node: ts.Node): readonly string[] {
  const calls: string[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression)) {
      calls.push(candidate.expression.name.text);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return calls;
}

function callersOf(
  functions: ReadonlyMap<string, IndexedFunction>,
  callee: string,
): readonly string[] {
  return [...functions]
    .filter(([, declaration]) => allIdentifierCallNames(declaration).includes(callee))
    .map(([name]) => name);
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

  it('[fault: sibling-drift] keeps both linker entrypoints on one finite phased topology', () => {
    const sourceText = readFileSync(new URL('./linker.ts', import.meta.url), 'utf8');
    const source = ts.createSourceFile(
      'linker.ts',
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const functions = topLevelFunctions(source);
    const publicLink = functions.get('link');
    const installTree = functions.get('linkInstallTree');
    expect.soft(publicLink).toBeDefined();
    expect.soft(installTree).toBeDefined();
    if (!publicLink || !installTree) throw new Error('linker entrypoint declaration missing');

    const phases = [
      'preflightPackageBins',
      'linkInstallPackageFiles',
      'linkInstallPackageBins',
    ] as const;
    const publicCalls = identifierCalls(publicLink).filter(
      (call) => !call.guarded && functions.has(call.name),
    );
    const installCalls = identifierCalls(installTree).filter(
      (call) => !call.guarded && functions.has(call.name),
    );
    expect.soft(publicCalls).toHaveLength(1);
    expect.soft(installCalls).toHaveLength(1);
    const sharedComposers = publicCalls
      .map((call) => call.name)
      .filter((name) => {
        if (!installCalls.some((call) => call.name === name)) return false;
        const declaration = functions.get(name);
        if (!declaration) return false;
        const calls = identifierCalls(declaration);
        return phases.every(
          (phase) => calls.filter((call) => call.name === phase && !call.guarded).length === 1,
        );
      });

    expect.soft(sharedComposers).toHaveLength(1);
    const composer = sharedComposers[0];
    if (!composer) throw new Error('shared phased linker composer missing');
    const declaration = functions.get(composer);
    if (!declaration) throw new Error(`shared linker composer ${composer} missing`);
    const composerBody = declaration.body;
    expect.soft(composerBody && ts.isBlock(composerBody)).toBe(true);
    if (!composerBody || !ts.isBlock(composerBody)) {
      throw new Error(`shared linker composer ${composer} must have a block body`);
    }
    expect(
      identifierCalls(declaration)
        .filter((call) => functions.has(call.name))
        .map((call) => call.name),
    ).toEqual(phases);
    expect(identifierCalls(declaration).filter((call) => call.guarded)).toEqual([]);
    expect(composerBody.statements.some(ts.isReturnStatement)).toBe(false);
    expect(memberCallNames(declaration)).not.toContain(
      expect.stringMatching(/^(mkdir|readFile|writeFile)$/),
    );
    expect(callersOf(functions, 'preflightPackageBins')).toEqual([composer]);
    expect(callersOf(functions, 'linkInstallPackageFiles')).toEqual([composer]);
    expect(callersOf(functions, 'linkInstallPackageBins')).toEqual([composer]);
    expect(callersOf(functions, 'normalizeBin')).toEqual(['preflightPackageBins']);
    expect(callersOf(functions, 'normalizeBinTarget')).toEqual(['preflightPackageBins']);
    const shimOwners = [...functions]
      .filter(([, candidate]) => candidate.getText(source).includes('#!/usr/bin/env node'))
      .map(([name]) => name);
    const writeOwners = [...functions].flatMap(([name, candidate]) =>
      allMemberCallNames(candidate)
        .filter((call) => call === 'writeFile')
        .map(() => name),
    );
    expect(sourceText.match(/#!\/usr\/bin\/env node/g)).toHaveLength(1);
    expect(shimOwners).toEqual(['linkInstallPackageBins']);
    expect(writeOwners.sort()).toEqual(
      ['linkInstallPackageFiles', 'linkInstallPackageBins'].sort(),
    );
    expect(functions.has('linkBins')).toBe(false);
  });

  it.each(['public link', 'install tree', 'phased'] as const)(
    '[fault: sibling-drift] runs one shaped package-bin pass through the %s entrypoint',
    async (entrypoint) => {
      const root = observedBinPackage(
        pkg('phase-root', 'node_modules/phase-root', 'phase-root', './bin/root.js'),
        './bin/root.js',
      );
      const nested = observedBinPackage(
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
        const preflight = requireContractFunction('preflightPackageBins');
        const linkFiles = requireContractFunction('linkInstallPackageFiles');
        const linkBins = requireContractFunction('linkInstallPackageBins');
        const preparedClaims = preflight(packages);
        expect(preparedClaims).not.toBe(packages);
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

        await linkFiles(vfs, '/project', packages, () => {});
        expect(await vfs.exists(launcherPaths[0] ?? '')).toBe(false);
        expect(await vfs.exists(launcherPaths[1] ?? '')).toBe(false);
        root.poison();
        nested.poison();
        await linkBins(vfs, '/project', claims, () => {});
      }

      expect(root.reads()).toBe(1);
      expect(nested.reads()).toBe(1);
      expect(ledger.targetReads).toEqual(targetPaths);
      expect(ledger.launcherWrites).toEqual(launcherPaths);
      ledger.restore();

      expect(await vfs.readFileText(targetPaths[0] ?? '')).toBe('throw new Error("phase-root");\n');
      expect(await vfs.readFileText(targetPaths[1] ?? '')).toBe(
        'throw new Error("phase-nested");\n',
      );
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

  it('[fault: observable-order] links only current string/object targets for a stable recorded owner', async () => {
    const preflight = requireContractFunction('preflightPackageBins');
    const linkFiles = requireContractFunction('linkInstallPackageFiles');
    const linkBins = requireContractFunction('linkInstallPackageBins');
    const root = observedBinPackage(
      pkg('root-cli', 'node_modules/root-cli', 'root-cli', './bin/current-root.js'),
      './bin/current-root.js',
    );
    const nested = observedBinPackage(
      pkg(
        'nested-cli',
        'node_modules/host/node_modules/nested-cli',
        'nested-command',
        './bin/current-nested.js',
      ),
      { 'nested-command': './bin/current-nested.js' },
    );
    const current = [root.value, nested.value];
    const prior = [
      {
        ...pkg('root-cli', 'node_modules/root-cli', 'root-cli', 'bin/prior-root.js'),
        bin: 'bin/prior-root.js',
      },
      pkg(
        'nested-cli',
        'node_modules/host/node_modules/nested-cli',
        'nested-command',
        'bin/prior-nested.js',
      ),
    ];
    const claims = structuredClone(preflight(current, prior));
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
    root.poison();
    nested.poison();
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

    expect(root.reads()).toBe(1);
    expect(nested.reads()).toBe(1);
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

  describe.each(['public link', 'install tree', 'preflight', 'package-file phase'] as const)(
    '%s install-path ingress',
    (entrypoint) => {
      it.each([
        {
          label: 'relative traversal retaining the package suffix (binless)',
          installPath: '../outside/node_modules/bad-cli',
          binless: true,
        },
        {
          label: 'absolute path retaining the package suffix',
          installPath: '/outside/node_modules/bad-cli',
          binless: false,
        },
      ])(
        '[fault: corrupt-input] rejects $label with zero VFS mutation',
        async ({ installPath, binless }) => {
          const vfs = await project();
          const invalid = pkg('bad-cli', installPath, 'bad', 'bin/bad.js');
          if (binless) invalid.bin = undefined;
          const mkdir = vi.spyOn(vfs, 'mkdir');
          const writeFile = vi.spyOn(vfs, 'writeFile');
          let caught: unknown;

          try {
            if (entrypoint === 'public link') {
              await linker.link(vfs, '/project', [invalid]);
            } else if (entrypoint === 'install tree') {
              await linker.linkInstallTree(vfs, '/project', [invalid], () => {});
            } else if (entrypoint === 'preflight') {
              requireContractFunction('preflightPackageBins')([invalid]);
            } else {
              await requireContractFunction('linkInstallPackageFiles')(
                vfs,
                '/project',
                [invalid],
                () => {},
              );
            }
          } catch (error) {
            caught = error;
          }

          expect.soft(caught).toBeInstanceOf(Error);
          expect
            .soft((caught as Error | undefined)?.message ?? '')
            .toContain('Invalid package installPath');
          expect.soft(mkdir).not.toHaveBeenCalled();
          expect(writeFile).not.toHaveBeenCalled();
          mkdir.mockRestore();
          writeFile.mockRestore();
        },
      );
    },
  );

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
