import { createHash } from 'node:crypto';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED,
  BUNDLED_VERSION,
  LedgerCache,
  LedgerRegistry,
  LedgerVfs,
  REAL_FILES,
  SOURCE,
  SOURCE_INTEGRITY,
  SOURCE_URL,
  SOURCE_VERSION,
  type Scope,
  eddyBundleFor,
  freshScope,
  installFixture,
  parentOnlyCache,
  parentOnlyLockfile,
  registryEntry,
  scopePaths,
  snapshotTree,
  writeProject,
} from './_test-fixtures/shadow-recipe-v2-embedded-source.ts';
import type { Lockfile, LockfileEntry } from './linker.ts';

const MATERIALIZATION_LINE =
  'npm: lightningcss@^1.32.0 materialized from shadow registry (rifty.shadow-substitution.lightningcss.v2)';

type EmbeddedLockfileEntry = LockfileEntry & {
  bundleDependencies?: string[];
  inBundle?: boolean;
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedLockPaths(scope: Scope): string[] {
  const paths = scopePaths(scope);
  return scope === 'root'
    ? ['', paths.alias, paths.acquisition, paths.child]
    : [
        '',
        'node_modules/lightningcss-wasm',
        'node_modules/nested-host',
        paths.alias,
        paths.acquisition,
        paths.child,
      ];
}

const SOURCE_FILES = [
  'index.cjs',
  'wasm-node.cjs',
  'browserslistToTargets.js',
  'composeVisitors.js',
  'flags.js',
  'import.meta.url-polyfill.js',
  `node_modules/${BUNDLED}/index.js`,
  `node_modules/${BUNDLED}/package.json`,
  'package.json',
  `node_modules/${BUNDLED}/README.md`,
  'README.md',
  'async.mjs',
  'index.mjs',
  `node_modules/${BUNDLED}/index.mjs`,
  'wasm-node.mjs',
  'ast.d.ts',
  'index.d.ts',
  'targets.d.ts',
  'lightningcss_node.wasm',
] as const;

function aliasMutations(path: string): string[] {
  return ['index.cjs', 'index.mjs', 'package.json'].flatMap((file) => [
    `mkdir:/project/${path}`,
    `write:/project/${path}/${file}`,
  ]);
}

function expectedVfsMutations(scope: Scope, writeLock: boolean): string[] {
  const paths = scopePaths(scope);
  return [
    'mkdir:/project/node_modules',
    ...(scope === 'nested'
      ? [
          `mkdir:/project/node_modules/${SOURCE}`,
          `write:/project/node_modules/${SOURCE}/package.json`,
          'mkdir:/project/node_modules/nested-host',
          'write:/project/node_modules/nested-host/package.json',
        ]
      : []),
    `mkdir:/project/${paths.acquisition}`,
    `mkdir:/project/${paths.child}`,
    ...SOURCE_FILES.map((file) => `write:/project/${paths.acquisition}/${file}`),
    ...aliasMutations(paths.alias),
    ...(scope === 'nested' ? aliasMutations('node_modules/lightningcss') : []),
    ...(writeLock ? ['write:/project/package-lock.json'] : []),
  ];
}

function expectedSources(scope: Scope) {
  const facts =
    scope === 'root'
      ? [{ name: SOURCE, version: SOURCE_VERSION, url: SOURCE_URL }]
      : [
          { name: SOURCE, version: '1.32.1', url: `https://registry.test/${SOURCE}-1.32.1.tgz` },
          {
            name: 'nested-host',
            version: '1.0.0',
            url: 'https://registry.test/nested-host-1.0.0.tgz',
          },
          { name: SOURCE, version: SOURCE_VERSION, url: SOURCE_URL },
        ];
  return {
    cache: facts.map(({ name, version }) => `${name}@${version}`),
    packuments: scope === 'root' ? [SOURCE] : [SOURCE, 'nested-host'],
    tarballs: facts.map(({ url }) => url),
  };
}

async function expectEmbeddedAuthority(
  vfs: MemoryVfs,
  result: Awaited<ReturnType<typeof installFixture>>,
  scope: Scope,
): Promise<void> {
  const paths = scopePaths(scope);
  const acquisition = result.lockfile.packages[paths.acquisition] as
    | EmbeddedLockfileEntry
    | undefined;
  const child = result.lockfile.packages[paths.child] as EmbeddedLockfileEntry | undefined;

  expect
    .soft(Object.keys(result.lockfile.packages).sort(), `${scope}: exact lock paths`)
    .toEqual(expectedLockPaths(scope).sort());
  expect.soft(acquisition, `${scope}: acquisition lock fact`).toMatchObject({
    version: SOURCE_VERSION,
    resolved: SOURCE_URL,
    integrity: SOURCE_INTEGRITY,
    dependencies: { [BUNDLED]: '^1.0.1' },
    bundleDependencies: [BUNDLED],
  });
  expect.soft(acquisition, `${scope}: acquired bin suppression`).not.toHaveProperty('bin');
  expect.soft(child, `${scope}: embedded child lock fact`).toEqual({
    version: BUNDLED_VERSION,
    inBundle: true,
  });
  expect
    .soft(result.lockfile.packages[`node_modules/${BUNDLED}`], `${scope}: no root child lock`)
    .toBeUndefined();
  expect
    .soft(
      result.packages.some(({ name }) => name === BUNDLED),
      `${scope}: no child result`,
    )
    .toBe(false);
  expect
    .soft(
      result.packages.find(({ installPath }) => installPath === paths.acquisition)?.bin,
      `${scope}: acquired result bin suppression`,
    )
    .toBeUndefined();

  for (const file of REAL_FILES) {
    const bytes = await vfs.readFile(`/project/${paths.acquisition}/${file.path}`);
    expect.soft(bytes.byteLength, `${scope}: ${file.path} bytes`).toBe(file.bytes);
    expect.soft(sha256(bytes), `${scope}: ${file.path} sha256`).toBe(file.sha256);
  }
  const embeddedManifest = JSON.parse(
    await vfs.readFileText(`/project/${paths.child}/package.json`),
  ) as Record<string, unknown>;
  expect.soft(embeddedManifest, `${scope}: physical embedded manifest`).toMatchObject({
    name: BUNDLED,
    version: BUNDLED_VERSION,
  });
  await expect
    .soft(vfs.exists(`/project/node_modules/${BUNDLED}`), `${scope}: no standalone tree`)
    .resolves.toBe(false);
  await expect
    .soft(vfs.exists('/project/node_modules/.bin/lightningcss'), `${scope}: acquired bin`)
    .resolves.toBe(false);
  await expect
    .soft(vfs.exists('/project/node_modules/.bin/acquired-only'), `${scope}: acquired-only bin`)
    .resolves.toBe(false);
}

function lockError(error: unknown): Readonly<{ code?: unknown; reason?: unknown }> {
  if (error === null || typeof error !== 'object') return {};
  return {
    code: 'code' in error ? error.code : undefined,
    reason: 'reason' in error ? error.reason : undefined,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 embedded-source authority', () => {
  it.each(['root', 'nested'] as const)(
    '[fault: observable-order/provenance-lie] fresh %s consumes the official embedded source without standalone acquisition',
    async (scope) => {
      const fresh = await freshScope(scope);
      const expected = expectedSources(scope);

      await expectEmbeddedAuthority(fresh.vfs, fresh.result, scope);
      expect.soft(fresh.registry.packumentReads).toEqual(expected.packuments);
      expect.soft(fresh.registry.tarballReads).toEqual(expected.tarballs);
      expect.soft(fresh.cache.gets).toEqual(expected.cache);
      expect.soft(fresh.cache.puts).toEqual(expected.cache);
      expect.soft(fresh.vfs.mutations).toEqual(expectedVfsMutations(scope, true));
      expect.soft(fresh.reports).toContain(MATERIALIZATION_LINE);
    },
  );

  it.each(['root', 'nested'] as const)(
    '[fault: poisoned-cache/provenance-lie] current-protocol %s replay reads the parent cache only and preserves exact bytes',
    async (scope) => {
      const seed = await freshScope(scope);
      const expectedLock = parentOnlyLockfile(seed.result.lockfile, scope);
      const cache = await parentOnlyCache(seed.entries);
      const vfs = new LedgerVfs();
      const lockBytes = await writeProject(vfs, seed.dependencies, expectedLock);
      if (!lockBytes) throw new Error('replay lock bytes are missing');
      vfs.clearLedger();
      const registry = new LedgerRegistry([]);
      const reports: string[] = [];

      const replay = await installFixture(vfs, registry, seed.dependencies, cache, reports);

      await expectEmbeddedAuthority(vfs, replay, scope);
      expect.soft(replay.lockfile, `${scope}: returned lock`).toEqual(expectedLock);
      expect
        .soft(await vfs.readFile('/project/package-lock.json'), `${scope}: raw lock`)
        .toEqual(lockBytes);
      expect.soft(registry.packumentReads, `${scope}: registry packuments`).toEqual([]);
      expect.soft(registry.tarballReads, `${scope}: registry tarballs`).toEqual([]);
      expect.soft(cache.gets, `${scope}: exact cache reads`).toEqual(expectedSources(scope).cache);
      expect.soft(cache.puts, `${scope}: cache writes`).toEqual([]);
      expect
        .soft(vfs.mutations, `${scope}: exact VFS writes`)
        .toEqual(expectedVfsMutations(scope, false));
      expect.soft(reports, `${scope}: replay reports`).toEqual(seed.reports);
      expect
        .soft(await snapshotTree(vfs, '/project/node_modules'), `${scope}: replay tree`)
        .toEqual(await snapshotTree(seed.vfs, '/project/node_modules'));
    },
  );

  it.each(['root', 'nested'] as const)(
    '[fault: sibling-drift/provenance-lie] generic Eddy %s adopts the parent-only current lock without a child tarball',
    async (scope) => {
      const seed = await freshScope(scope);
      const expectedLock = parentOnlyLockfile(seed.result.lockfile, scope);
      const bundle = await eddyBundleFor(expectedLock, seed.entries);
      const vfs = new LedgerVfs();
      await writeProject(vfs, seed.dependencies);
      vfs.clearLedger();
      const registry = new LedgerRegistry([]);
      const cache = new LedgerCache();
      const reports: string[] = [];
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(bundle as unknown as BodyInit));

      const adopted = await installFixture(
        vfs,
        registry,
        seed.dependencies,
        cache,
        reports,
        'https://eddy.test/resolve',
      );

      expect.soft(adopted.source, `${scope}: transport`).toBe('eddy');
      await expectEmbeddedAuthority(vfs, adopted, scope);
      expect.soft(adopted.lockfile, `${scope}: returned lock`).toEqual(expectedLock);
      expect.soft(fetchSpy, `${scope}: one Eddy request`).toHaveBeenCalledTimes(1);
      expect.soft(registry.packumentReads, `${scope}: registry packuments`).toEqual([]);
      expect.soft(registry.tarballReads, `${scope}: registry tarballs`).toEqual([]);
      const expectedCache = expectedSources(scope).cache;
      expect
        .soft(cache.gets, `${scope}: exact cache reads`)
        .toEqual([...expectedCache, ...expectedCache]);
      expect.soft(cache.puts, `${scope}: exact cache seeds`).toEqual(expectedCache);
      expect
        .soft(vfs.mutations, `${scope}: exact VFS writes`)
        .toEqual(expectedVfsMutations(scope, true));
      expect.soft(reports, `${scope}: Eddy reports`).toEqual(seed.reports);
      expect
        .soft(await snapshotTree(vfs, '/project/node_modules'), `${scope}: Eddy tree`)
        .toEqual(await snapshotTree(seed.vfs, '/project/node_modules'));
    },
  );

  it.each(
    (['root', 'nested'] as const).flatMap((scope) => [
      {
        scope,
        label: 'version',
        mutate(entry: EmbeddedLockfileEntry): void {
          entry.version = '1.0.2';
        },
      },
      {
        scope,
        label: 'inBundle',
        mutate(entry: EmbeddedLockfileEntry): void {
          entry.inBundle = false;
        },
      },
    ]),
  )(
    '[fault: corrupt-input/observable-order] rejects $scope child $label drift as EBROKENLOCK before publication',
    async ({ scope, label, mutate }) => {
      const seed = await freshScope(scope);
      const lock = parentOnlyLockfile(seed.result.lockfile, scope);
      const child = lock.packages[scopePaths(scope).child] as EmbeddedLockfileEntry | undefined;
      if (!child) throw new Error(`${scope} corruption fixture lacks its child lock fact`);
      mutate(child);
      const cache = await parentOnlyCache(seed.entries);
      const vfs = new MemoryVfs();
      const lockBytes = await writeProject(vfs, seed.dependencies, lock);
      if (!lockBytes) throw new Error('corrupt replay lock bytes are missing');
      const registry = new LedgerRegistry([]);
      const reports: string[] = [];
      const writers = [
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      const outcome = await installFixture(vfs, registry, seed.dependencies, cache, reports).then(
        (value) => ({ kind: 'resolved' as const, value }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      );

      expect.soft(outcome.kind, `${scope} ${label}: outcome`).toBe('rejected');
      expect
        .soft(lockError(outcome.kind === 'rejected' ? outcome.error : undefined))
        .toEqual({ code: 'EBROKENLOCK', reason: 'shadow-trace-drift' });
      expect.soft(registry.packumentReads, `${scope} ${label}: packuments`).toEqual([]);
      expect.soft(registry.tarballReads, `${scope} ${label}: tarballs`).toEqual([]);
      if (label === 'version') {
        expect
          .soft(cache.gets, `${scope} ${label}: parent cache validation`)
          .toContain(`${SOURCE}@${SOURCE_VERSION}`);
      } else {
        expect.soft(cache.gets, `${scope} ${label}: pre-cache rejection`).toEqual([]);
      }
      expect.soft(cache.gets.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
      expect.soft(cache.puts, `${scope} ${label}: cache writes`).toEqual([]);
      expect.soft(reports, `${scope} ${label}: reports`).toEqual([]);
      for (const writer of writers) {
        expect.soft(writer, `${scope} ${label}: ${writer.getMockName()}`).not.toHaveBeenCalled();
      }
      expect.soft(await vfs.readFile('/project/package-lock.json')).toEqual(lockBytes);
      await expect.soft(vfs.exists('/project/node_modules')).resolves.toBe(false);
    },
  );

  it.each(['raw inBundle', 'malformed shadow trace'] as const)(
    '[fault: provenance-lie] generic Eddy keeps %s outside the plan-proven completeness exception',
    async (guard) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const parent = await registryEntry('embedded-parent', '1.0.0', {
        dependencies: { 'embedded-child': '1.0.0' },
      });
      const child = await registryEntry('embedded-child', '1.0.0');
      const lock = {
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { version: '1.0.0', dependencies: { 'embedded-parent': '1.0.0' } },
          'node_modules/embedded-parent': {
            version: '1.0.0',
            resolved: parent.manifest.dist.tarball,
            integrity: parent.manifest.dist.integrity,
            dependencies: { 'embedded-child': '1.0.0' },
          },
          'node_modules/embedded-parent/node_modules/embedded-child': {
            version: '1.0.0',
            inBundle: true,
          },
        },
        ...(guard === 'malformed shadow trace'
          ? { rifty: { shadowSubstitutions: { protocol: 'malformed', applied: [] } } }
          : {}),
      } as unknown as Lockfile;
      const bundle = await eddyBundleFor(lock, [parent]);
      const dependencies = { 'embedded-parent': '1.0.0' };
      const vfs = new MemoryVfs();
      await writeProject(vfs, dependencies);
      const registry = new LedgerRegistry([parent, child]);
      const cache = new LedgerCache();
      const reports: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bundle as unknown as BodyInit));

      const result = await installFixture(
        vfs,
        registry,
        dependencies,
        cache,
        reports,
        'https://eddy.test/resolve',
      );

      expect.soft(result.source).toBe('standard');
      expect.soft(result.closureHash).toBeUndefined();
      expect.soft(registry.packumentReads).toContain('embedded-child');
      expect.soft(registry.tarballReads).toContain(child.manifest.dist.tarball);
      expect.soft(cache.puts).toContain('embedded-child@1.0.0');
      await expect
        .soft(vfs.exists('/project/node_modules/embedded-child/package.json'))
        .resolves.toBe(true);
    },
  );
});
