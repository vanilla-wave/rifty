import type { VfsMutationIntent } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  createOwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from '../workers/owner-vfs-authority.ts';
import {
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from '../workers/package-acquisition-authority.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { createInstallStamp, installStampPath } from './install-stamp.ts';
import { VfsVersionConflictError } from './owner-vfs-protocol.ts';
import {
  type PackageMutationImpact,
  applyPackageAwareHostCommit,
  assertPortableVfsMutationIntents,
  classifyHostCommitPackageImpact,
  classifyVfsMutationIntentsPackageImpact,
  createPackageMutationExecutor,
  discoverPackageAcquisitionGuardTransitions,
  discoverPackageMutationTransitions,
  packageMutationTransitionsForProjects,
} from './package-mutation-executor.ts';

const ROOT = '/workspace';
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"^5.4.0"}}\n';
const enc = new TextEncoder();
const dec = new TextDecoder();
const PROJECT: PackageAcquisitionProject = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};

interface IntentClassifierCase {
  readonly name: string;
  readonly intent: VfsMutationIntent;
  readonly expected: PackageMutationImpact;
}

const INTENT_CLASSIFIER_CASES: readonly IntentClassifierCase[] = [
  ...(['write', 'replace', 'mkdir', 'rm', 'utimes'] as const).flatMap(
    (kind) =>
      [
        {
          name: `${kind}: exact manifest`,
          intent: { kind, path: `${ROOT}/package.json` },
          expected: 'manifest',
        },
        {
          // ADR-0307: extraneous writes inside the tree never invalidate.
          name: `${kind}: node_modules child`,
          intent: { kind, path: `${ROOT}/node_modules/pkg/index.js` },
          expected: 'none',
        },
        {
          name: `${kind}: the tree itself`,
          intent: { kind, path: `${ROOT}/node_modules` },
          expected: 'tree',
        },
        { name: `${kind}: guarded ancestor`, intent: { kind, path: ROOT }, expected: 'tree' },
        {
          name: `${kind}: unrelated`,
          intent: { kind, path: `${ROOT}/src/index.ts` },
          expected: 'none',
        },
      ] satisfies readonly IntentClassifierCase[],
  ),
  {
    name: 'rename: sensitive source manifest',
    intent: { kind: 'rename', sourcePath: `${ROOT}/package.json`, targetPath: '/archive/app.json' },
    expected: 'manifest',
  },
  {
    name: 'rename: source inside the tree is extraneous (ADR-0307)',
    intent: { kind: 'rename', sourcePath: `${ROOT}/node_modules/pkg`, targetPath: '/archive/pkg' },
    expected: 'none',
  },
  {
    name: 'rename: source is the tree itself',
    intent: { kind: 'rename', sourcePath: `${ROOT}/node_modules`, targetPath: '/archive/nm' },
    expected: 'tree',
  },
  {
    name: 'rename: sensitive source ancestor',
    intent: { kind: 'rename', sourcePath: ROOT, targetPath: '/archive/workspace' },
    expected: 'tree',
  },
  {
    name: 'rename: sensitive target manifest',
    intent: {
      kind: 'rename',
      sourcePath: '/incoming/app.json',
      targetPath: `${ROOT}/package.json`,
    },
    expected: 'manifest',
  },
  {
    name: 'rename: target inside the tree is extraneous (ADR-0307)',
    intent: { kind: 'rename', sourcePath: '/incoming/pkg', targetPath: `${ROOT}/node_modules/pkg` },
    expected: 'none',
  },
  {
    name: 'rename: sensitive target ancestor',
    intent: { kind: 'rename', sourcePath: '/incoming/workspace', targetPath: ROOT },
    expected: 'tree',
  },
  {
    name: 'rename: unrelated endpoints',
    intent: { kind: 'rename', sourcePath: '/tmp/a', targetPath: '/tmp/b' },
    expected: 'none',
  },
  {
    name: 'rename: normalized same path is a no-op',
    intent: {
      kind: 'rename',
      sourcePath: `${ROOT}/package.json`,
      targetPath: `${ROOT}/./package.json`,
    },
    expected: 'none',
  },
  {
    name: 'copy: sensitive manifest source is read-only',
    intent: { kind: 'copy', sourcePath: `${ROOT}/package.json`, targetPath: '/archive/app.json' },
    expected: 'none',
  },
  {
    name: 'copy: sensitive tree source is read-only',
    intent: { kind: 'copy', sourcePath: `${ROOT}/node_modules/pkg`, targetPath: '/archive/pkg' },
    expected: 'none',
  },
  {
    name: 'copy: sensitive ancestor source is read-only',
    intent: { kind: 'copy', sourcePath: ROOT, targetPath: '/archive/workspace' },
    expected: 'none',
  },
  {
    name: 'copy: sensitive target manifest',
    intent: { kind: 'copy', sourcePath: '/incoming/app.json', targetPath: `${ROOT}/package.json` },
    expected: 'manifest',
  },
  {
    name: 'copy: target inside the tree is extraneous (ADR-0307)',
    intent: { kind: 'copy', sourcePath: '/incoming/pkg', targetPath: `${ROOT}/node_modules/pkg` },
    expected: 'none',
  },
  {
    name: 'copy: target is the tree itself',
    intent: { kind: 'copy', sourcePath: '/incoming/nm', targetPath: `${ROOT}/node_modules` },
    expected: 'tree',
  },
  {
    name: 'copy: sensitive target ancestor',
    intent: { kind: 'copy', sourcePath: '/incoming/workspace', targetPath: ROOT },
    expected: 'tree',
  },
  {
    name: 'copy: unrelated endpoints',
    intent: { kind: 'copy', sourcePath: '/tmp/a', targetPath: '/tmp/b' },
    expected: 'none',
  },
];

it('preflights every endpoint in a logical batch before an earlier write can apply', () => {
  const { fsSync } = createMemoryFs();
  const owner = createOwnerVfsAuthority(fsSync, {
    ownerEpoch: 'portable-intent-owner',
    initialRoots: ['/'],
  });
  let applied = false;

  expect(() => {
    assertPortableVfsMutationIntents(
      (paths) => owner.assertPortablePaths(paths),
      [
        { kind: 'write', path: '/workspace/ordinary.txt' },
        { kind: 'replace', path: installStampPath('/workspace') },
      ],
    );
    applied = true;
  }).toThrow(/EPERM.*reserved install-stamp authority claim/i);

  expect(applied).toBe(false);
  expect(fsSync.existsSync('/workspace/ordinary.txt')).toBe(false);
});

async function harness(flush?: () => Promise<{ failures: []; total: 0 }>) {
  const { vfs, fsSync } = createMemoryFs();
  fsSync.mkdirSync(`${ROOT}/node_modules/pkg`, { recursive: true });
  fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
  fsSync.writeFileSync(`${ROOT}/node_modules/pkg/index.js`, enc.encode('trusted'));
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(fsSync, {
    ownerEpoch: 'owner',
    initialRoots: ['/'],
  });
  const stamps = createInstallStampAuthority({ vfs, fsSync: owner, claimIo: installStampClaims });
  const claim = await stamps.demote(PROJECT);
  const promoted = await stamps.promote(
    { ...PROJECT, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1 },
  );
  if (promoted.status !== 'trusted') throw new Error('test setup failed to trust tree');

  const packages = createPackageAcquisitionAuthority({
    stamps,
    ...(flush ? { stampTransition: { flush } } : {}),
    adapter: {
      planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
      install: async () => {
        throw new Error('unused install');
      },
      reset: async () => {},
      switchProject: async () => {},
    },
  });
  const mutations = createPackageMutationExecutor({
    packages,
    fs: owner,
    assertPortablePaths: (paths) => owner.assertPortablePaths(paths),
    activeProject: () => PROJECT,
  });
  return { vfs, owner, stamps, mutations };
}

describe('package mutation routing', () => {
  it.each(INTENT_CLASSIFIER_CASES)('$name', ({ intent, expected }) => {
    expect(classifyVfsMutationIntentsPackageImpact([intent], ROOT)).toBe(expected);
  });

  it('resolves lazy mutation intents after the FIFO-head preflight', async () => {
    const { owner, stamps, mutations } = await harness();
    const path = `${ROOT}/node_modules/pkg/index.js`;
    let intents: readonly VfsMutationIntent[] = [];

    await mutations.guardedMutation(
      () => intents,
      async () => owner.writeFileSync(path, enc.encode('template seed')),
      async () => {
        intents = [{ kind: 'write', path }];
        return { status: 'ready' };
      },
    );

    expect(dec.decode(owner.readFileBytesSync(path))).toBe('template seed');
    // ADR-0307: the in-tree write is extraneous — the seeded claim survives.
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('classifies an ancestor removal against every known project root', () => {
    const projects: readonly PackageAcquisitionProject[] = [
      {
        ...PROJECT,
        projectId: 'a',
        root: '/projects/a',
        slug: 'a',
      },
      {
        ...PROJECT,
        projectId: 'other',
        root: '/projects/other',
        slug: 'other',
      },
    ];

    expect(
      packageMutationTransitionsForProjects([{ kind: 'rm', path: '/projects' }], projects),
    ).toEqual([
      { mode: 'revoke', root: '/projects/a' },
      { mode: 'revoke', root: '/projects/other' },
    ]);
  });

  it('demotes a nested exact manifest without touching the outer tree claim (ADR-0307)', () => {
    const nested: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'nested',
      root: `${ROOT}/node_modules/nested`,
      slug: 'nested',
    };

    expect(
      packageMutationTransitionsForProjects(
        [{ kind: 'write', path: `${nested.root}/package.json` }],
        [PROJECT, nested],
      ),
    ).toEqual([{ mode: 'demote', project: nested }]);
  });

  it('discovers inactive and nested stamped roots from current on-disk state', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const outer: PackageAcquisitionProject = {
      ...PROJECT,
      root: '/projects/a',
      projectId: 'a',
      slug: 'a',
    };
    const nested: PackageAcquisitionProject = {
      ...PROJECT,
      root: '/projects/a/node_modules/nested',
      projectId: 'nested',
      slug: 'nested',
    };
    const other: PackageAcquisitionProject = {
      ...PROJECT,
      root: '/projects/b',
      projectId: 'b',
      slug: 'b',
    };
    const stampAuthority = createInstallStampAuthority({ vfs, fsSync });
    for (const project of [nested, outer, other]) {
      fsSync.mkdirSync(`${project.root}/node_modules/pkg`, { recursive: true });
      fsSync.writeFileSync(`${project.root}/package.json`, enc.encode(PACKAGE_JSON));
      const claim = await stampAuthority.demote(project);
      await stampAuthority.promote(
        { ...project, packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      );
    }

    expect(
      discoverPackageMutationTransitions(fsSync, [], [{ kind: 'rm', path: '/projects' }]),
    ).toEqual([
      { mode: 'revoke', root: '/projects/a' },
      { mode: 'revoke', root: '/projects/b' },
      { mode: 'revoke', root: '/projects/a/node_modules/nested' },
    ]);
    expect(
      discoverPackageMutationTransitions(
        fsSync,
        [],
        [{ kind: 'write', path: `${nested.root}/package.json` }],
      ),
    ).toEqual([{ mode: 'demote', project: nested }]);
  });

  it.each(['write', 'rm', 'replace'] as const)(
    'recursively discovers an inactive nested trusted claim for a broad %s',
    async (kind) => {
      const { vfs, fsSync } = createMemoryFs();
      const nested: PackageAcquisitionProject = {
        ...PROJECT,
        projectId: 'inactive-tool',
        root: '/repo/tools/inactive',
        slug: 'inactive-tool',
      };
      fsSync.mkdirSync(`${nested.root}/node_modules/pkg`, { recursive: true });
      fsSync.writeFileSync(`${nested.root}/package.json`, enc.encode(PACKAGE_JSON));
      const stamps = createInstallStampAuthority({ vfs, fsSync });
      const claim = await stamps.demote(nested);
      const promoted = await stamps.promote(
        { ...nested, packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      );
      if (promoted.status !== 'trusted') throw new Error('test setup failed to trust nested tree');

      expect(discoverPackageMutationTransitions(fsSync, [], [{ kind, path: '/repo' }])).toEqual([
        { mode: 'revoke', root: nested.root },
      ]);
    },
  );

  it('resolves a whole-root reset at the FIFO head and revokes nested project claims', async () => {
    const pair = createMemoryFs();
    const nestedRoot = `${ROOT}/src/tool`;
    const nestedProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'nested-tool',
      root: nestedRoot,
      slug: 'nested-tool',
    };
    pair.fsSync.mkdirSync(`${nestedRoot}/node_modules/pkg`, { recursive: true });
    pair.fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
    pair.fsSync.writeFileSync(`${nestedRoot}/package.json`, enc.encode(PACKAGE_JSON));
    const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
      pair.fsSync,
      { ownerEpoch: 'whole-root-reset' },
    );
    const stamps = createInstallStampAuthority({
      vfs: pair.vfs,
      fsSync: owner,
      claimIo: installStampClaims,
    });
    const packages = createPackageAcquisitionAuthority({
      stamps,
      adapter: {
        planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
        install: async () => {
          throw new Error('unused');
        },
        reset: async () => {
          throw new Error('prepared reset should own the mutation');
        },
        switchProject: async () => {},
      },
    });
    let releaseHead!: () => void;
    const headGate = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    let markHeadStarted!: () => void;
    const headStarted = new Promise<void>((resolve) => {
      markHeadStarted = resolve;
    });
    let transitionResolutions = 0;
    const seedNestedClaim = packages.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: async () => {
        markHeadStarted();
        await headGate;
        const claim = await stamps.demote(nestedProject);
        await stamps.promote(
          { ...nestedProject, packageJsonText: PACKAGE_JSON },
          { epoch: claim.epoch, packages: 1 },
        );
      },
    });
    await headStarted;
    const reset = packages.dispatch({
      type: 'reset',
      target: { root: ROOT },
      resolveTransitions: () => {
        transitionResolutions += 1;
        return discoverPackageMutationTransitions(owner, packages.knownProjects?.() ?? [], [
          { kind: 'rm', path: ROOT },
        ]);
      },
      prepare: async () => ({
        status: 'ready' as const,
        mutate: async () => owner.rmSync(ROOT, { recursive: true, force: true }),
      }),
    });

    expect(transitionResolutions).toBe(0);
    releaseHead();
    await seedNestedClaim;
    await expect(reset).resolves.toBeUndefined();

    expect(transitionResolutions).toBe(1);
    expect(owner.existsSync(ROOT)).toBe(false);
    await expect(stamps.check({ root: nestedRoot, slug: nestedProject.slug })).resolves.toEqual({
      status: 'absent',
    });
  });

  it('discovers and revokes an inactive nested marker-shaped directory before root reset', async () => {
    const pair = createMemoryFs();
    const nestedRoot = `${ROOT}/src/tool`;
    const marker = installStampPath(nestedRoot);
    pair.fsSync.mkdirSync(marker, { recursive: true });
    pair.fsSync.writeFileSync(`${marker}/payload`, enc.encode('forged'));
    const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
      pair.fsSync,
      { ownerEpoch: 'malformed-directory-reset' },
    );
    const stamps = createInstallStampAuthority({
      vfs: pair.vfs,
      fsSync: owner,
      claimIo: installStampClaims,
    });
    const packages = createPackageAcquisitionAuthority({
      stamps,
      adapter: {
        planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
        install: async () => {
          throw new Error('unused');
        },
        reset: async () => {
          throw new Error('prepared reset should own the mutation');
        },
        switchProject: async () => {},
      },
    });

    await expect(
      packages.dispatch({
        type: 'reset',
        target: { root: ROOT },
        resolveTransitions: () =>
          discoverPackageMutationTransitions(owner, packages.knownProjects?.() ?? [], [
            { kind: 'rm', path: ROOT },
          ]),
        prepare: async () => ({
          status: 'ready' as const,
          mutate: async () => owner.rmSync(ROOT, { recursive: true, force: true }),
        }),
      }),
    ).resolves.toBeUndefined();

    expect(owner.existsSync(ROOT)).toBe(false);
  });

  it.each([
    ['malformed', '{'],
    ['v2', '{"version":2}'],
    [
      'wrong-root',
      `${JSON.stringify(
        createInstallStamp('/other', PACKAGE_JSON, { slug: 'other', packages: 1 }),
      )}\n`,
    ],
  ])('revokes a physical %s claim that cannot supply trusted project metadata', (_case, bytes) => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
    fsSync.writeFileSync(installStampPath(ROOT), enc.encode(bytes));

    expect(
      discoverPackageMutationTransitions(
        fsSync,
        [],
        [{ kind: 'write', path: `${ROOT}/package.json` }],
      ),
    ).toEqual([{ mode: 'revoke', root: ROOT }]);
  });

  it('revokes invalid physical ancestor and descendant claims around an acquisition root', () => {
    const { fsSync } = createMemoryFs();
    const outer = '/projects/a';
    const actual = `${outer}/node_modules/actual`;
    const descendant = `${actual}/node_modules/descendant`;
    for (const root of [outer, descendant]) {
      fsSync.mkdirSync(`${root}/node_modules`, { recursive: true });
      fsSync.writeFileSync(installStampPath(root), enc.encode('{'));
    }

    expect(discoverPackageAcquisitionGuardTransitions(fsSync, [], actual)).toEqual([
      { mode: 'revoke', root: outer },
      { mode: 'revoke', root: descendant },
    ]);
  });

  it('pre-revokes a late invalid claim before any earlier batch byte applies', async () => {
    const pair = createMemoryFs();
    pair.fsSync.mkdirSync(`${ROOT}/node_modules/pkg`, { recursive: true });
    pair.fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
    pair.fsSync.writeFileSync(installStampPath(ROOT), enc.encode('{'));
    const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
      pair.fsSync,
      { ownerEpoch: 'invalid-claim-batch' },
    );
    const stamps = createInstallStampAuthority({
      vfs: pair.vfs,
      fsSync: owner,
      claimIo: installStampClaims,
    });
    const packages = createPackageAcquisitionAuthority({
      stamps,
      adapter: {
        planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
        install: async () => {
          throw new Error('unused');
        },
        reset: async () => {},
        switchProject: async () => {},
      },
    });
    const ordinary = `${ROOT}/ordinary.txt`;
    let claimPresentAtFirstWrite = true;

    await packages.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () =>
        discoverPackageMutationTransitions(
          owner,
          [],
          [
            { kind: 'write', path: ordinary },
            { kind: 'rm', path: `${ROOT}/node_modules` },
          ],
        ),
      mutate: async () => {
        claimPresentAtFirstWrite = owner.existsSync(installStampPath(ROOT));
        owner.writeFileSync(ordinary, enc.encode('applied'));
        owner.rmSync(`${ROOT}/node_modules`, { recursive: true, force: true });
      },
    });

    expect(claimPresentAtFirstWrite).toBe(false);
    expect(dec.decode(owner.readFileBytesSync(ordinary))).toBe('applied');
    expect(owner.existsSync(`${ROOT}/node_modules`)).toBe(false);
  });

  it('demotes stamped ancestors and revokes stamped descendants for acquisition tree replacement', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const outer: PackageAcquisitionProject = {
      ...PROJECT,
      root: '/projects/a',
      projectId: 'a',
      slug: 'a',
    };
    const actual: PackageAcquisitionProject = {
      ...PROJECT,
      root: '/projects/a/node_modules/actual',
      projectId: 'actual',
      slug: 'actual',
    };
    const descendant: PackageAcquisitionProject = {
      ...PROJECT,
      root: '/projects/a/node_modules/actual/node_modules/descendant',
      projectId: 'descendant',
      slug: 'descendant',
    };
    const stampAuthority = createInstallStampAuthority({ vfs, fsSync });
    for (const project of [descendant, actual, outer]) {
      fsSync.mkdirSync(`${project.root}/node_modules/pkg`, { recursive: true });
      fsSync.writeFileSync(`${project.root}/package.json`, enc.encode(PACKAGE_JSON));
      const claim = await stampAuthority.demote(project);
      await stampAuthority.promote(
        { ...project, packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      );
    }

    expect(discoverPackageAcquisitionGuardTransitions(fsSync, [], actual)).toEqual([
      { mode: 'demote', project: outer },
      { mode: 'revoke', root: descendant.root },
    ]);
  });

  it('returns a stale package.json CAS conflict before demotion or its failing flush', async () => {
    let flushCalls = 0;
    const { owner, stamps, mutations } = await harness(async () => {
      flushCalls += 1;
      throw new Error('stamp flush must not run');
    });
    const before = owner.readFileBytesSync(`${ROOT}/package.json`);
    const request = {
      kind: 'write' as const,
      operationId: 'stale-package-json',
      path: `${ROOT}/package.json`,
      expectedVersion: 'stale-owner-version',
      data: enc.encode('{"name":"changed"}\n'),
    };

    await expect(
      applyPackageAwareHostCommit(owner, mutations, ROOT, request),
    ).rejects.toBeInstanceOf(VfsVersionConflictError);

    expect(flushCalls).toBe(0);
    expect(owner.readFileBytesSync(`${ROOT}/package.json`)).toEqual(before);
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('revokes a hidden claim without invalidating a validated recursive root remove', async () => {
    const { owner, mutations } = await harness();
    const expectedVersion = owner.versionOf(ROOT);
    if (!expectedVersion) throw new Error('test setup missing root version');

    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'remove',
      operationId: 'remove-stamped-root',
      path: ROOT,
      expectedVersion,
      recursive: true,
    });

    expect(owner.existsSync(ROOT)).toBe(false);
  });

  it('revokes a hidden claim without invalidating a validated root rename', async () => {
    const { owner, mutations } = await harness();
    owner.mkdirSync('/archive', { recursive: true });
    const expectedSourceVersion = owner.versionOf(ROOT);
    if (!expectedSourceVersion) throw new Error('test setup missing root version');
    const target = '/archive/workspace';

    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'rename',
      operationId: 'rename-stamped-root',
      sourcePath: ROOT,
      targetPath: target,
      expectedSourceVersion,
      expectedTargetVersion: null,
    });

    expect(owner.existsSync(ROOT)).toBe(false);
    expect(dec.decode(owner.readFileBytesSync(`${target}/package.json`))).toBe(PACKAGE_JSON);
    expect(owner.existsSync(installStampPath(target))).toBe(false);
  });

  it('rejects an already-applied stale package commit before demoting a newly trusted tree', async () => {
    const { owner, stamps, mutations } = await harness();
    const request = {
      kind: 'write' as const,
      operationId: 'package-json-once',
      path: `${ROOT}/package.json`,
      expectedVersion: owner.versionOf(`${ROOT}/package.json`),
      data: enc.encode(PACKAGE_JSON),
    };
    await applyPackageAwareHostCommit(owner, mutations, ROOT, request);
    const claim = await stamps.demote(PROJECT);
    await stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      { epoch: claim.epoch, packages: 1 },
    );

    await expect(
      applyPackageAwareHostCommit(owner, mutations, ROOT, request),
    ).rejects.toBeInstanceOf(VfsVersionConflictError);
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('applies a validated same-path rename no-op without demoting', async () => {
    const { owner, stamps, mutations } = await harness();
    const version = owner.versionOf(`${ROOT}/package.json`);
    if (!version) throw new Error('test setup missing package.json version');

    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'rename',
      operationId: 'manifest-self-rename',
      sourcePath: `${ROOT}/package.json`,
      targetPath: `${ROOT}/package.json`,
      expectedSourceVersion: version,
      expectedTargetVersion: version,
    });

    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  // ADR-0307 churn scenario: a tool writing into the tree (Vite's
  // node_modules/.vite-temp config modules) is an extraneous write — trust
  // survives, matching real npm which never re-validates tree bytes.
  it('keeps the trusted claim across direct node_modules child writes', async () => {
    const { owner, stamps, mutations } = await harness();
    const path = `${ROOT}/node_modules/pkg/index.js`;
    const temp = `${ROOT}/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs`;

    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'write',
      operationId: 'derived-write',
      path,
      expectedVersion: owner.versionOf(path),
      data: enc.encode('changed'),
    });
    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'mkdir',
      operationId: 'vite-temp-mkdir',
      path: `${ROOT}/node_modules/.vite-temp`,
      expectedVersion: null,
    });
    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'write',
      operationId: 'vite-temp-write',
      path: temp,
      expectedVersion: null,
      data: enc.encode('export default {}'),
    });
    const tempVersion = owner.versionOf(temp);
    if (!tempVersion) throw new Error('test setup missing temp version');
    await applyPackageAwareHostCommit(owner, mutations, ROOT, {
      kind: 'remove',
      operationId: 'vite-temp-remove',
      path: temp,
      expectedVersion: tempVersion,
    });

    expect(dec.decode(owner.readFileBytesSync(path))).toBe('changed');
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('classifies exact manifest separately from guarded-tree and ancestor mutations', () => {
    expect(
      classifyHostCommitPackageImpact(
        {
          kind: 'remove',
          operationId: 'manifest',
          path: `${ROOT}/package.json`,
          expectedVersion: 'v1',
        },
        ROOT,
      ),
    ).toBe('manifest');
    expect(
      classifyHostCommitPackageImpact(
        {
          kind: 'remove',
          operationId: 'extraneous',
          path: `${ROOT}/node_modules/pkg`,
          expectedVersion: 'v1',
          recursive: true,
        },
        ROOT,
      ),
    ).toBe('none');
    expect(
      classifyHostCommitPackageImpact(
        {
          kind: 'remove',
          operationId: 'tree',
          path: `${ROOT}/node_modules`,
          expectedVersion: 'v1',
          recursive: true,
        },
        ROOT,
      ),
    ).toBe('tree');
    expect(
      classifyHostCommitPackageImpact(
        {
          kind: 'rename',
          operationId: 'ancestor',
          sourcePath: ROOT,
          targetPath: '/archive/workspace',
          expectedSourceVersion: 'v1',
          expectedTargetVersion: null,
        },
        ROOT,
      ),
    ).toBe('tree');
  });
});
