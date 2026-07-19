import { type GitIdentity, type LogEntry, makeGit, vfsToGitFs } from '@riftydev/git';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { createPlaygroundScmAdapter as createAdapter } from './playground-scm.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const FOREIGN_OWNER_FILE = '/.rifty/workbench/v1/projects/project-b/tree/src/foreign.bin';
const MIXED = '/src/mixed.bin';
const DISCARD = '/src/discard.bin';
const UNTRACKED = '/src/untracked.bin';
const INITIAL_MIXED = Uint8Array.from([0, 255, 1]);
const STAGED_MIXED = Uint8Array.from([2, 0, 254]);
const WORKING_MIXED = Uint8Array.from([4, 253, 0]);
const INITIAL_DISCARD = Uint8Array.from([6, 0, 7]);
const WORKING_DISCARD = Uint8Array.from([8, 0, 9]);
const UNTRACKED_BYTES = Uint8Array.from([10, 0, 11]);
const ADD_STAGED = '/matrix/add-staged.bin';
const ADD_WORKING = '/matrix/add-working.bin';
const MODIFY_STAGED = '/matrix/modify-staged.bin';
const MODIFY_WORKING = '/matrix/modify-working.bin';
const DELETE_STAGED = '/matrix/delete-staged.bin';
const DELETE_WORKING = '/matrix/delete-working.bin';
const MATRIX_BYTES = Object.freeze({
  addStaged: Uint8Array.from([21, 0, 22]),
  addWorking: Uint8Array.from([23, 0, 24]),
  modifyStagedHead: Uint8Array.from([31, 0, 32]),
  modifyStagedIndex: Uint8Array.from([33, 0, 34]),
  modifyWorkingHead: Uint8Array.from([41, 0, 42]),
  modifyWorkingTree: Uint8Array.from([43, 0, 44]),
  deleteStagedHead: Uint8Array.from([51, 0, 52]),
  deleteWorkingHead: Uint8Array.from([61, 0, 62]),
});
const COMMIT_IDENTITY: GitIdentity = Object.freeze({
  name: 'Playground SCM Contract',
  email: 'scm-contract@rifty.test',
  timestamp: 1_700_000_000,
  timezoneOffset: 0,
});
const PUBLIC_METHODS = Object.freeze([
  'commit',
  'diff',
  'discard',
  'refresh',
  'snapshot',
  'stage',
  'subscribe',
  'unstage',
]);

interface PlaygroundScmChange {
  readonly path: string;
  readonly code: string;
  readonly area: 'staged' | 'working';
}

interface PlaygroundScmSnapshot {
  readonly branch?: string;
  readonly history: readonly LogEntry[];
  readonly changes: readonly PlaygroundScmChange[];
}

interface PlaygroundScmBlob {
  readonly source: 'head' | 'index' | 'working' | 'empty';
  readonly bytes: Uint8Array;
}

interface PlaygroundScmDiff {
  readonly original: PlaygroundScmBlob;
  readonly modified: PlaygroundScmBlob;
}

interface PlaygroundScm {
  snapshot(): PlaygroundScmSnapshot;
  subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void): () => void;
  refresh(): Promise<PlaygroundScmSnapshot>;
  diff(change: PlaygroundScmChange): Promise<PlaygroundScmDiff>;
  stage(path: string): Promise<void>;
  unstage(path: string): Promise<void>;
  discard(path: string): Promise<void>;
  commit(message: string): Promise<string>;
}

interface PlaygroundScmAuthority {
  readonly projectRoot: string;
  readonly vfs: Vfs;
  readonly git: ReturnType<typeof makeGit>;
  readonly commitIdentity: GitIdentity;
}

type CreatePlaygroundScmAdapter = (authority: PlaygroundScmAuthority) => Promise<PlaygroundScm>;

const createPlaygroundScmAdapter: CreatePlaygroundScmAdapter = createAdapter;

interface ScmHarness {
  readonly vfs: MemoryVfs;
  readonly git: ReturnType<typeof makeGit>;
  readonly scm: PlaygroundScm;
}

interface DiffMatrixCase {
  readonly name: string;
  readonly path: string;
  readonly code: string;
  readonly area: PlaygroundScmChange['area'];
  readonly original: { readonly source: PlaygroundScmBlob['source']; readonly bytes: Uint8Array };
  readonly modified: { readonly source: PlaygroundScmBlob['source']; readonly bytes: Uint8Array };
}

type TreeSnapshot = readonly (readonly [path: string, bytes: readonly number[]])[];

function ownerPath(publicPath: string): string {
  return `${PROJECT_ROOT}${publicPath}`;
}

async function write(vfs: Vfs, publicPath: string, bytes: Uint8Array): Promise<void> {
  const path = ownerPath(publicPath);
  await vfs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await vfs.writeFile(path, new Uint8Array(bytes));
}

async function treeSnapshot(vfs: Vfs): Promise<TreeSnapshot> {
  const files: Array<readonly [string, readonly number[]]> = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = [...(await vfs.readdir(directory))].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else files.push([path, [...(await vfs.readFile(path))]]);
    }
  };
  await walk(PROJECT_ROOT);
  return files;
}

async function statusSnapshot(
  git: ReturnType<typeof makeGit>,
): Promise<readonly { readonly filepath: string; readonly status: string }[]> {
  return [...(await git.status())]
    .map(({ filepath, status }) => ({ filepath, status }))
    .sort((left, right) => left.filepath.localeCompare(right.filepath));
}

function expectedChange(
  path: string,
  code: string,
  area: PlaygroundScmChange['area'],
): PlaygroundScmChange {
  return { path, code, area };
}

const INITIAL_CHANGES = Object.freeze([
  expectedChange(MIXED, 'MM', 'staged'),
  expectedChange(DISCARD, ' M', 'working'),
  expectedChange(MIXED, 'MM', 'working'),
  expectedChange(UNTRACKED, '??', 'working'),
]);

async function harness(): Promise<ScmHarness> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(PROJECT_ROOT, { recursive: true });
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: PROJECT_ROOT });
  await git.init();
  await write(vfs, MIXED, INITIAL_MIXED);
  await write(vfs, DISCARD, INITIAL_DISCARD);
  await git.add(MIXED.slice(1));
  await git.add(DISCARD.slice(1));
  await git.commit({
    message: 'initial byte fixtures',
    author: COMMIT_IDENTITY,
    committer: COMMIT_IDENTITY,
  });

  await write(vfs, MIXED, STAGED_MIXED);
  await git.add(MIXED.slice(1));
  await write(vfs, MIXED, WORKING_MIXED);
  await write(vfs, DISCARD, WORKING_DISCARD);
  await write(vfs, UNTRACKED, UNTRACKED_BYTES);

  const scm = await createPlaygroundScmAdapter({
    projectRoot: PROJECT_ROOT,
    vfs,
    git,
    commitIdentity: COMMIT_IDENTITY,
  });
  return { vfs, git, scm };
}

async function diffMatrixHarness(): Promise<ScmHarness> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(PROJECT_ROOT, { recursive: true });
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: PROJECT_ROOT });
  await git.init();
  await write(vfs, MODIFY_STAGED, MATRIX_BYTES.modifyStagedHead);
  await write(vfs, MODIFY_WORKING, MATRIX_BYTES.modifyWorkingHead);
  await write(vfs, DELETE_STAGED, MATRIX_BYTES.deleteStagedHead);
  await write(vfs, DELETE_WORKING, MATRIX_BYTES.deleteWorkingHead);
  for (const path of [MODIFY_STAGED, MODIFY_WORKING, DELETE_STAGED, DELETE_WORKING]) {
    await git.add(path.slice(1));
  }
  await git.commit({
    message: 'seed complete SCM diff matrix',
    author: COMMIT_IDENTITY,
    committer: COMMIT_IDENTITY,
  });

  await write(vfs, ADD_STAGED, MATRIX_BYTES.addStaged);
  await git.add(ADD_STAGED.slice(1));
  await write(vfs, ADD_WORKING, MATRIX_BYTES.addWorking);
  await write(vfs, MODIFY_STAGED, MATRIX_BYTES.modifyStagedIndex);
  await git.add(MODIFY_STAGED.slice(1));
  await write(vfs, MODIFY_WORKING, MATRIX_BYTES.modifyWorkingTree);
  await vfs.rm(ownerPath(DELETE_STAGED));
  await git.remove(DELETE_STAGED.slice(1));
  await vfs.rm(ownerPath(DELETE_WORKING));

  const scm = await createPlaygroundScmAdapter({
    projectRoot: PROJECT_ROOT,
    vfs,
    git,
    commitIdentity: COMMIT_IDENTITY,
  });
  return { vfs, git, scm };
}

const DIFF_MATRIX: readonly DiffMatrixCase[] = Object.freeze([
  {
    name: 'add staged',
    path: ADD_STAGED,
    code: 'A ',
    area: 'staged',
    original: { source: 'empty', bytes: new Uint8Array() },
    modified: { source: 'index', bytes: MATRIX_BYTES.addStaged },
  },
  {
    name: 'add working',
    path: ADD_WORKING,
    code: '??',
    area: 'working',
    original: { source: 'empty', bytes: new Uint8Array() },
    modified: { source: 'working', bytes: MATRIX_BYTES.addWorking },
  },
  {
    name: 'modify staged',
    path: MODIFY_STAGED,
    code: 'M ',
    area: 'staged',
    original: { source: 'head', bytes: MATRIX_BYTES.modifyStagedHead },
    modified: { source: 'index', bytes: MATRIX_BYTES.modifyStagedIndex },
  },
  {
    name: 'modify working',
    path: MODIFY_WORKING,
    code: ' M',
    area: 'working',
    original: { source: 'head', bytes: MATRIX_BYTES.modifyWorkingHead },
    modified: { source: 'working', bytes: MATRIX_BYTES.modifyWorkingTree },
  },
  {
    name: 'delete staged',
    path: DELETE_STAGED,
    code: 'D ',
    area: 'staged',
    original: { source: 'head', bytes: MATRIX_BYTES.deleteStagedHead },
    modified: { source: 'empty', bytes: new Uint8Array() },
  },
  {
    name: 'delete working',
    path: DELETE_WORKING,
    code: ' D',
    area: 'working',
    original: { source: 'head', bytes: MATRIX_BYTES.deleteWorkingHead },
    modified: { source: 'empty', bytes: new Uint8Array() },
  },
]);

function findChange(
  snapshot: PlaygroundScmSnapshot,
  path: string,
  area: PlaygroundScmChange['area'],
): PlaygroundScmChange {
  const change = snapshot.changes.find(
    (candidate) => candidate.path === path && candidate.area === area,
  );
  if (change === undefined) throw new Error(`Missing ${area} change ${path}`);
  return change;
}

function expectFrozenSnapshot(snapshot: PlaygroundScmSnapshot): void {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.history)).toBe(true);
  expect(Object.isFrozen(snapshot.changes)).toBe(true);
  for (const change of snapshot.changes) expect(Object.isFrozen(change)).toBe(true);
  for (const entry of snapshot.history) {
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.author)).toBe(true);
    expect(Object.isFrozen(entry.committer)).toBe(true);
    expect(Object.isFrozen(entry.parents)).toBe(true);
  }
}

async function expectExactSnapshot(
  h: ScmHarness,
  changes: readonly PlaygroundScmChange[],
): Promise<PlaygroundScmSnapshot> {
  const snapshot = h.scm.snapshot();
  expect(snapshot).toEqual({
    branch: 'main',
    history: await h.git.log(),
    changes,
  });
  expectFrozenSnapshot(snapshot);
  return snapshot;
}

function expectDiff(
  diff: PlaygroundScmDiff,
  expected: {
    readonly original: { readonly source: PlaygroundScmBlob['source']; readonly bytes: Uint8Array };
    readonly modified: { readonly source: PlaygroundScmBlob['source']; readonly bytes: Uint8Array };
  },
): void {
  expect(diff).toEqual(expected);
  expect(Object.isFrozen(diff)).toBe(true);
  expect(Object.isFrozen(diff.original)).toBe(true);
  expect(Object.isFrozen(diff.modified)).toBe(true);
}

describe('Playground SCM real-backend Contract+RED', () => {
  it('publishes one exact frozen project-rooted snapshot and replays the latest value', async () => {
    const h = await harness();
    const initial = await expectExactSnapshot(h, INITIAL_CHANGES);
    const publications: PlaygroundScmSnapshot[] = [];
    const unsubscribe = h.scm.subscribe((snapshot) => publications.push(snapshot));

    expect(Object.keys(h.scm).sort()).toEqual(PUBLIC_METHODS);
    expect(Object.isFrozen(h.scm)).toBe(true);
    expect('close' in h.scm).toBe(false);
    expect('dispose' in h.scm).toBe(false);
    expect(publications).toEqual([initial]);
    expect(publications[0]).toBe(initial);
    expect(JSON.stringify(initial)).not.toContain(PROJECT_ROOT);
    expect(JSON.stringify(initial)).not.toContain('.git');

    const refreshed = await h.scm.refresh();
    expect(refreshed).toEqual(initial);
    expect(h.scm.snapshot()).toBe(refreshed);
    expect(publications.at(-1)).toBe(refreshed);
    expectFrozenSnapshot(refreshed);

    expect(() => {
      (refreshed.changes as PlaygroundScmChange[]).push(
        expectedChange('/caller-mutation', '??', 'working'),
      );
    }).toThrow(TypeError);
    const firstHistory = refreshed.history[0];
    if (firstHistory === undefined) throw new Error('Expected seeded Git history');
    expect(() => {
      firstHistory.author.name = 'caller mutation';
    }).toThrow(TypeError);
    expect(() => {
      firstHistory.parents.push('caller-mutation');
    }).toThrow(TypeError);

    unsubscribe();
    const publicationCount = publications.length;
    await h.scm.refresh();
    expect(publications).toHaveLength(publicationCount);
  });

  it('returns byte-honest HEAD/index/working/empty blobs as defensive copies', async () => {
    const h = await harness();
    const snapshot = h.scm.snapshot();
    const staged = await h.scm.diff(findChange(snapshot, MIXED, 'staged'));
    const working = await h.scm.diff(findChange(snapshot, MIXED, 'working'));
    const untracked = await h.scm.diff(findChange(snapshot, UNTRACKED, 'working'));

    expectDiff(staged, {
      original: { source: 'head', bytes: INITIAL_MIXED },
      modified: { source: 'index', bytes: STAGED_MIXED },
    });
    expectDiff(working, {
      original: { source: 'index', bytes: STAGED_MIXED },
      modified: { source: 'working', bytes: WORKING_MIXED },
    });
    expectDiff(untracked, {
      original: { source: 'empty', bytes: new Uint8Array() },
      modified: { source: 'working', bytes: UNTRACKED_BYTES },
    });

    staged.original.bytes.fill(77);
    staged.modified.bytes.fill(78);
    working.original.bytes.fill(79);
    working.modified.bytes.fill(80);
    untracked.modified.bytes.fill(81);

    const stagedAgain = await h.scm.diff(findChange(h.scm.snapshot(), MIXED, 'staged'));
    const workingAgain = await h.scm.diff(findChange(h.scm.snapshot(), MIXED, 'working'));
    const untrackedAgain = await h.scm.diff(findChange(h.scm.snapshot(), UNTRACKED, 'working'));
    expectDiff(stagedAgain, {
      original: { source: 'head', bytes: INITIAL_MIXED },
      modified: { source: 'index', bytes: STAGED_MIXED },
    });
    expectDiff(workingAgain, {
      original: { source: 'index', bytes: STAGED_MIXED },
      modified: { source: 'working', bytes: WORKING_MIXED },
    });
    expectDiff(untrackedAgain, {
      original: { source: 'empty', bytes: new Uint8Array() },
      modified: { source: 'working', bytes: UNTRACKED_BYTES },
    });
    expect(stagedAgain.original.bytes).not.toBe(staged.original.bytes);
    expect(stagedAgain.modified.bytes).not.toBe(staged.modified.bytes);
    expect(workingAgain.original.bytes).not.toBe(working.original.bytes);
    expect(workingAgain.modified.bytes).not.toBe(working.modified.bytes);
    expect(await h.vfs.readFile(ownerPath(MIXED))).toEqual(WORKING_MIXED);
  });

  it('covers add/modify/delete across staged/working with real Git byte sources', async () => {
    const h = await diffMatrixHarness();
    const snapshot = h.scm.snapshot();

    expect(snapshot.changes).toHaveLength(DIFF_MATRIX.length);
    for (const testCase of DIFF_MATRIX) {
      const change = findChange(snapshot, testCase.path, testCase.area);
      expect(change).toEqual({
        path: testCase.path,
        code: testCase.code,
        area: testCase.area,
      });
      const first = await h.scm.diff(change);
      expectDiff(first, { original: testCase.original, modified: testCase.modified });

      first.original.bytes.fill(201);
      first.modified.bytes.fill(202);
      const second = await h.scm.diff(change);
      expectDiff(second, { original: testCase.original, modified: testCase.modified });
      expect(second.original.bytes).not.toBe(first.original.bytes);
      expect(second.modified.bytes).not.toBe(first.modified.bytes);
    }
  });

  it('stages, unstages, discards and commits through real Git before publishing refreshed state', async () => {
    const h = await harness();
    const publications: PlaygroundScmSnapshot[] = [];
    h.scm.subscribe((snapshot) => publications.push(snapshot));

    await h.scm.stage(DISCARD);
    const afterStage = await expectExactSnapshot(h, [
      expectedChange(DISCARD, 'M ', 'staged'),
      expectedChange(MIXED, 'MM', 'staged'),
      expectedChange(MIXED, 'MM', 'working'),
      expectedChange(UNTRACKED, '??', 'working'),
    ]);
    expect(publications.at(-1)).toBe(afterStage);

    await h.scm.unstage(MIXED);
    const afterUnstage = await expectExactSnapshot(h, [
      expectedChange(DISCARD, 'M ', 'staged'),
      expectedChange(MIXED, ' M', 'working'),
      expectedChange(UNTRACKED, '??', 'working'),
    ]);
    expect(publications.at(-1)).toBe(afterUnstage);

    await h.scm.discard(MIXED);
    const afterDiscard = await expectExactSnapshot(h, [
      expectedChange(DISCARD, 'M ', 'staged'),
      expectedChange(UNTRACKED, '??', 'working'),
    ]);
    expect(publications.at(-1)).toBe(afterDiscard);
    expect(await h.vfs.readFile(ownerPath(MIXED))).toEqual(INITIAL_MIXED);

    const oid = await h.scm.commit('SCM contract commit');
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    expect(oid).toBe(await h.git.resolveRef('HEAD'));
    const afterCommit = await expectExactSnapshot(h, [expectedChange(UNTRACKED, '??', 'working')]);
    expect(publications.at(-1)).toBe(afterCommit);
    expect(afterCommit.history).toHaveLength(2);
    expect(afterCommit.history[0]).toMatchObject({
      oid,
      message: 'SCM contract commit\n',
      author: COMMIT_IDENTITY,
      committer: COMMIT_IDENTITY,
    });
  });

  it('rejects untracked discard loudly before changing either worktree or Git metadata', async () => {
    const h = await harness();
    const treeBefore = await treeSnapshot(h.vfs);
    const statusBefore = await statusSnapshot(h.git);
    const snapshotBefore = h.scm.snapshot();

    await expect(h.scm.discard(UNTRACKED)).rejects.toThrow(/untracked/i);

    expect(await treeSnapshot(h.vfs)).toEqual(treeBefore);
    expect(await statusSnapshot(h.git)).toEqual(statusBefore);
    expect(h.scm.snapshot()).toBe(snapshotBefore);
  });

  it('rejects physical-owner, foreign, non-normalized and .git paths before any effect', async () => {
    const h = await harness();
    const treeBefore = await treeSnapshot(h.vfs);
    const statusBefore = await statusSnapshot(h.git);
    const snapshotBefore = h.scm.snapshot();
    const invalidPaths = [
      ownerPath(MIXED),
      FOREIGN_OWNER_FILE,
      '/src/../mixed.bin',
      '/.git/config',
    ] as const;

    for (const path of invalidPaths) {
      const forged = expectedChange(path, 'MM', 'working');
      await expect(h.scm.diff(forged)).rejects.toBeInstanceOf(TypeError);
      await expect(h.scm.stage(path)).rejects.toBeInstanceOf(TypeError);
      await expect(h.scm.unstage(path)).rejects.toBeInstanceOf(TypeError);
      await expect(h.scm.discard(path)).rejects.toBeInstanceOf(TypeError);
    }

    expect(await treeSnapshot(h.vfs)).toEqual(treeBefore);
    expect(await statusSnapshot(h.git)).toEqual(statusBefore);
    expect(h.scm.snapshot()).toBe(snapshotBefore);
  });
});
