import { TARBALL_CACHE_ROOT, serializePackageJson } from '@riftydev/npm-client';
import type { VfsMutationIntent } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const localSource = "console.log('retained edited source');\n";
const suppliedSource = "console.log('unused arriving definition source');\n";
let first: SavedSnapshotFixture;
let second: SavedSnapshotFixture;
beforeAll(async () => {
  first = await bakeSavedSnapshotFixture();
  second = await bakeSavedSnapshotFixture({
    description: 'second producer artifact',
    assetUrl: 'https://host.test/snapshot-second.tar.gz',
  });
  expect(second.snapshotId).not.toBe(first.snapshotId);
  expect(second.installArtifactIdentity).toBe(first.installArtifactIdentity);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

type Endpoint = 'scratch' | 'named';
type Harness = Awaited<ReturnType<typeof seed>>;

async function seed(endpoint: Endpoint = 'scratch') {
  const network = installSnapshotNetwork(first, second);
  const h = await openSavedSnapshotOwner(network);
  const scratch = savedSnapshotDefinition('scratch', first.descriptor);
  await h.catalog.createScratch({ definition: scratch });
  const opened = await h.owner.openProject(scratch);
  expect(opened.acquisition).toMatchObject({
    kind: 'ready',
    provenance: { outcome: 'snapshot', snapshotId: first.snapshotId, packages: 1 },
  });
  await opened.close();
  const id = endpoint === 'scratch' ? 'scratch' : 'applied-project';
  if (endpoint === 'named') {
    const definition = savedSnapshotDefinition(id, first.descriptor);
    await h.catalog.saveScratch({ id, name: 'Snapshot apply', definition });
    const saved = await h.owner.openProject(definition);
    expect(saved.acquisition).toMatchObject({ kind: 'saved' });
    await saved.close();
  }
  const root = `/.rifty/workbench/v1/projects/${id}/tree`;
  const stamp = readInstallStampSync(h.authority, root);
  expect(stamp !== null && stampTrusted(stamp)).toBe(true);
  expect(network.requests).toEqual([first.descriptor.assetUrl]);
  await h.authority.flush();
  return { ...h, network, id, root };
}

async function edit(
  h: Harness,
  paths: readonly string[],
  mutate: () => void,
  artifact = first,
): Promise<void> {
  const opened = await h.owner.openProject(
    savedSnapshotDefinition(h.id, artifact.descriptor, {
      packageJsonText: artifact.payload.packageJsonText,
    }),
  );
  try {
    const intents: VfsMutationIntent[] = paths.map((path) => ({
      kind: 'replace',
      path: `${h.root}${path}`,
    }));
    await h.packages.mutations.guardedMutation(intents, async () => mutate());
    await h.owner.recordMutation({
      project: opened,
      kind: 'file',
      treeRevision: h.authority.treeRevision,
    });
    await h.authority.flush();
  } finally {
    await opened.close();
  }
}

function write(h: Harness, path: string, contents: string): void {
  const absolute = `${h.root}${path}`;
  h.authority.mkdirSync(absolute.slice(0, absolute.lastIndexOf('/')), { recursive: true });
  h.authority.writeFileSync(absolute, encoder.encode(contents));
}

function remove(h: Harness, path: string): void {
  h.authority.rmSync(`${h.root}${path}`, { recursive: true, force: true });
}

function retainExtras(h: Harness): void {
  write(h, '/main.cjs', localSource);
  write(h, '/user.txt', 'retained ordinary file\n');
  write(h, '/node_modules/ms/local.txt', 'retained local package file\n');
  write(h, '/node_modules/local-only/index.js', 'module.exports = 17;\n');
  h.authority.mkdirSync(`${h.root}/empty-local`, { recursive: true });
  h.authority.mkdirSync(`${h.root}/node_modules/ms/empty-local`, { recursive: true });
  h.authority.mkdirSync(TARBALL_CACHE_ROOT, { recursive: true });
  h.authority.writeFileSync(
    `${TARBALL_CACHE_ROOT}/unrelated-sentinel`,
    new Uint8Array([0, 255, 3]),
  );
}

const extraPaths = [
  '/main.cjs',
  '/user.txt',
  '/node_modules/ms/local.txt',
  '/node_modules/local-only',
  '/empty-local',
  '/node_modules/ms/empty-local',
];

async function attemptApply(
  h: Harness,
  artifact: SavedSnapshotFixture,
  conflict?: 'error' | 'overwrite',
) {
  let opened: OpenedPlaygroundProject | undefined;
  let failure: unknown;
  try {
    const definition = savedSnapshotDefinition(h.id, artifact.descriptor, {
      packageJsonText: artifact.payload.packageJsonText,
      source: suppliedSource,
      application: { mode: 'apply-snapshot', ...(conflict === undefined ? {} : { conflict }) },
    });
    opened = await h.owner.openProject(definition);
  } catch (error) {
    failure = error;
  }
  return { opened, failure };
}

function expectConflict(failure: unknown, paths: readonly string[]): void {
  expect.soft(failure).toMatchObject({ name: 'SnapshotApplicationConflictError' });
  const actual =
    failure !== null && typeof failure === 'object' && 'conflictingPaths' in failure
      ? failure.conflictingPaths
      : undefined;
  expect.soft(actual).toEqual(expect.arrayContaining([...paths]));
  if (Array.isArray(actual)) {
    expect
      .soft(actual.every((path: unknown) => typeof path === 'string' && path.startsWith('/')))
      .toBe(true);
    expect.soft(actual).not.toContain('/node_modules/ms/readme.md');
  }
}

function expectPayload(h: Harness, artifact: SavedSnapshotFixture): void {
  const files: [string, Uint8Array][] = [
    ['/package.json', encoder.encode(artifact.payload.packageJsonText)],
    ['/package-lock.json', encoder.encode(artifact.payload.lockfile)],
    ...artifact.payload.nodeModules.files.map((file): [string, Uint8Array] => [
      `/node_modules/${file.path}`,
      Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)),
    ]),
  ];
  for (const [path, expected] of files) {
    const stat = h.authority.statSyncOrNull(`${h.root}${path}`);
    expect.soft(stat?.isFile, `payload file ${path}`).toBe(true);
    if (stat?.isFile)
      expect.soft(h.authority.readFileBytesSync(`${h.root}${path}`), path).toEqual(expected);
  }
  for (const path of artifact.payload.nodeModules.directories ?? []) {
    expect
      .soft(h.authority.statSyncOrNull(`${h.root}/node_modules/${path}`)?.isDirectory, path)
      .toBe(true);
  }
}

function expectExtras(h: Harness): void {
  for (const [path, expected] of [
    ['/main.cjs', localSource],
    ['/user.txt', 'retained ordinary file\n'],
    ['/node_modules/ms/local.txt', 'retained local package file\n'],
    ['/node_modules/local-only/index.js', 'module.exports = 17;\n'],
  ]) {
    const stat = h.authority.statSyncOrNull(`${h.root}${path}`);
    expect.soft(stat?.isFile, `retained ${path}`).toBe(true);
    if (stat?.isFile)
      expect.soft(decoder.decode(h.authority.readFileBytesSync(`${h.root}${path}`))).toBe(expected);
  }
  for (const path of ['/empty-local', '/node_modules/ms/empty-local']) {
    expect.soft(h.authority.statSyncOrNull(`${h.root}${path}`)?.isDirectory, path).toBe(true);
  }
  expect
    .soft(h.authority.readFileBytesSync(`${TARBALL_CACHE_ROOT}/unrelated-sentinel`))
    .toEqual(new Uint8Array([0, 255, 3]));
}

describe('I8 explicit snapshot application uses one file conflict policy', () => {
  it.each([
    ['same', undefined],
    ['same', 'error'],
    ['new', undefined],
    ['new', 'error'],
  ] as const)(
    '%s ID with conflict=%s rejects all differing files before any addition',
    async (identity, conflict) => {
      const h = await seed();
      const artifact = identity === 'same' ? first : second;
      let applied: Awaited<ReturnType<typeof attemptApply>> | undefined;
      try {
        await edit(
          h,
          [
            ...extraPaths,
            '/package.json',
            '/package-lock.json',
            '/node_modules/ms/index.js',
            '/node_modules/ms/readme.md',
          ],
          () => {
            retainExtras(h);
            const manifest = JSON.parse(first.payload.packageJsonText) as Record<string, unknown>;
            write(
              h,
              '/package.json',
              serializePackageJson({ ...manifest, description: 'local manifest' }),
            );
            write(h, '/package-lock.json', `${first.payload.lockfile}\n `);
            write(h, '/node_modules/ms/index.js', 'local conflicting bytes\n');
            remove(h, '/node_modules/ms/readme.md');
          },
        );
        const before = h.fs.durableSnapshot();
        h.network.requests.length = 0;
        applied = await attemptApply(h, artifact, conflict);
        expectConflict(applied.failure, [
          '/package.json',
          '/package-lock.json',
          '/node_modules/ms/index.js',
        ]);
        expect.soft(applied.opened).toBeUndefined();
        expect.soft(h.network.requests).toEqual([artifact.descriptor.assetUrl]);
        expect
          .soft(h.fs.liveSnapshot(), 'preflight retains all files, dirs, cache and claim bytes')
          .toEqual(before);
        expect.soft(h.fs.durableSnapshot()).toEqual(before);
      } finally {
        await applied?.opened?.close();
        await h.close();
      }
    },
  );

  it.each([
    ['scratch', 'same'],
    ['scratch', 'new'],
    ['named', 'same'],
    ['named', 'new'],
  ] as const)(
    '%s overwrite with %s ID restores payload, retains extras and reapplies on the next same-ID open',
    async (endpoint, identity) => {
      const h = await seed(endpoint);
      const artifact = identity === 'same' ? first : second;
      let applied: Awaited<ReturnType<typeof attemptApply>> | undefined;
      try {
        await edit(
          h,
          [
            ...extraPaths,
            '/package.json',
            '/package-lock.json',
            '/node_modules/ms/index.js',
            '/node_modules/ms/readme.md',
          ],
          () => {
            retainExtras(h);
            write(
              h,
              '/package.json',
              serializePackageJson({
                name: 'saved-snapshot-ms',
                version: '1.0.0',
                dependencies: { ms: '2.0.0' },
                description: 'local manifest',
              }),
            );
            write(h, '/package-lock.json', `${first.payload.lockfile}\n `);
            write(h, '/node_modules/ms/index.js', 'local conflicting bytes\n');
            remove(h, '/node_modules/ms/readme.md');
          },
        );
        h.network.requests.length = 0;
        applied = await attemptApply(h, artifact, 'overwrite');
        expect.soft(applied.failure).toBeUndefined();
        expect.soft(applied.opened?.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: artifact.snapshotId },
        });
        expect.soft(h.network.requests).toEqual([artifact.descriptor.assetUrl]);
        expectPayload(h, artifact);
        expectExtras(h);
        if (applied.opened === undefined) return;
        await applied.opened.close();
        await edit(
          h,
          ['/node_modules/ms/index.js'],
          () => write(h, '/node_modules/ms/index.js', 'edited after first explicit apply\n'),
          artifact,
        );
        h.network.requests.length = 0;
        applied = await attemptApply(h, artifact, 'overwrite');
        expect.soft(applied.failure).toBeUndefined();
        expect.soft(h.network.requests).toEqual([artifact.descriptor.assetUrl]);
        expect.soft(applied.opened?.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: artifact.snapshotId },
        });
        expectPayload(h, artifact);
        expectExtras(h);
      } finally {
        await applied?.opened?.close();
        await h.close();
      }
    },
  );

  it.each([
    ['/node_modules/ms/index.js', 'saved-directory', 'error'],
    ['/node_modules/ms/index.js', 'saved-directory', 'overwrite'],
    ['/node_modules/ms', 'saved-file', 'error'],
    ['/node_modules/ms', 'saved-file', 'overwrite'],
    ['/node_modules', 'saved-file', 'error'],
    ['/node_modules', 'saved-file', 'overwrite'],
  ] as const)('%s %s obeys %s for type/ancestor conflicts', async (path, kind, conflict) => {
    const h = await seed();
    let applied: Awaited<ReturnType<typeof attemptApply>> | undefined;
    try {
      await edit(h, [path, '/user.txt', '/main.cjs'], () => {
        write(h, '/user.txt', 'outside replaced target\n');
        write(h, '/main.cjs', localSource);
        remove(h, path);
        if (kind === 'saved-directory')
          write(h, `${path}/local-child.txt`, 'replaced incompatible subtree\n');
        else write(h, path, 'saved file blocks payload descendants\n');
      });
      const before = h.fs.durableSnapshot();
      h.network.requests.length = 0;
      applied = await attemptApply(h, first, conflict);
      expect.soft(h.network.requests).toEqual([first.descriptor.assetUrl]);
      if (conflict === 'error') {
        expectConflict(applied.failure, [path]);
        expect.soft(applied.opened).toBeUndefined();
        expect.soft(h.fs.liveSnapshot()).toEqual(before);
        expect.soft(h.fs.durableSnapshot()).toEqual(before);
      } else {
        expect.soft(applied.failure).toBeUndefined();
        expectPayload(h, first);
        if (kind === 'saved-directory')
          expect.soft(h.authority.existsSync(`${h.root}${path}/local-child.txt`)).toBe(false);
        expect
          .soft(decoder.decode(h.authority.readFileBytesSync(`${h.root}/user.txt`)))
          .toBe('outside replaced target\n');
        expect
          .soft(decoder.decode(h.authority.readFileBytesSync(`${h.root}/main.cjs`)))
          .toBe(localSource);
      }
    } finally {
      await applied?.opened?.close();
      await h.close();
    }
  });

  it.each(['same', 'new'] as const)(
    '%s ID admits equal bytes/directories and adds missing payload entries in error mode',
    async (identity) => {
      const h = await seed('named');
      const artifact = identity === 'same' ? first : second;
      let applied: Awaited<ReturnType<typeof attemptApply>> | undefined;
      try {
        await edit(
          h,
          [...extraPaths, '/package.json', '/package-lock.json', '/node_modules/ms/readme.md'],
          () => {
            retainExtras(h);
            write(h, '/package.json', artifact.payload.packageJsonText);
            write(h, '/package-lock.json', artifact.payload.lockfile);
            remove(h, '/node_modules/ms/readme.md');
          },
        );
        h.network.requests.length = 0;
        applied = await attemptApply(h, artifact, 'error');
        expect.soft(applied.failure).toBeUndefined();
        expect.soft(applied.opened?.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: artifact.snapshotId },
        });
        expect.soft(h.network.requests).toEqual([artifact.descriptor.assetUrl]);
        expectPayload(h, artifact);
        expectExtras(h);
      } finally {
        await applied?.opened?.close();
        await h.close();
      }
    },
  );
});
