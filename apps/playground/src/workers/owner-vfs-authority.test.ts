import {
  type FsSync,
  OpfsFsSync,
  type VfsMutationIntent,
  asyncVfs,
  syncMirror,
} from '@riftydev/vfs';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStampPath } from '../glue/install-stamp.ts';
import {
  OperationIdReuseError,
  type OwnerVfsSnapshot,
  type OwnerVfsSnapshotEntry,
  VfsVersionConflictError,
} from '../glue/owner-vfs-protocol.ts';
import { ScopedFsSync, scopeActiveVfsToWorkspace, workspaceVfsPrefix } from '../glue/scoped-vfs.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { PathVersion } from '../workbench/project-vfs-contract.ts';
import {
  type OwnerVfsAuthority,
  type OwnerVfsAuthorityOptions,
  createOwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';

const encoder = new TextEncoder();

/** OPFS is the external boundary; the real OpfsFsSync mirror is under test. */
function stubRoot(): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: '',
    isSameEntry: () => Promise.resolve(false),
    getFileHandle: () => Promise.reject(new Error('stub OPFS')),
    getDirectoryHandle: () => Promise.reject(new Error('stub OPFS')),
    removeEntry: () => Promise.reject(new Error('stub OPFS')),
    resolve: () => Promise.resolve([]),
    entries: () => {
      throw new Error('stub OPFS');
    },
  } as unknown as FileSystemDirectoryHandle;
}

const backends: ReadonlyArray<readonly [string, () => FsSync]> = [
  ['MemoryFsSync', () => new MemoryFsSync()],
  ['OpfsFsSync', () => new OpfsFsSync(stubRoot())],
];

function entry(snapshot: OwnerVfsSnapshot, path: string): OwnerVfsSnapshotEntry {
  const found = snapshot.entries.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`missing snapshot entry: ${path}`);
  return found;
}

function version(authority: OwnerVfsAuthority, path: string): PathVersion {
  const found = authority.versionOf(path);
  if (found === null) throw new Error(`missing version: ${path}`);
  return found;
}

describe.each(backends)('%s owner VFS revision authority', (_name, makeFs) => {
  beforeEach(() => {
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function make(): OwnerVfsAuthority {
    return createOwnerVfsAuthority(makeFs(), { ownerEpoch: 'owner-test-epoch' });
  }

  it('snapshots every entry with epoch, revision, opaque version, and uncapped bytes', () => {
    const authority = make();
    const large = new Uint8Array(192 * 1024 + 7);
    large.fill(0xa5);

    authority.mkdirSync('/src', { recursive: false });
    authority.writeFileSync('/src/large.bin', large);

    const snapshot = authority.snapshot();
    expect(snapshot.ownerEpoch).toBe('owner-test-epoch');
    expect(snapshot.treeRevision).toBe(2);
    expect(snapshot.entries.map((item) => item.path)).toEqual(['/', '/src', '/src/large.bin']);
    expect(entry(snapshot, '/').version).not.toBe(entry(snapshot, '/src').version);
    expect(entry(snapshot, '/src/large.bin')).toMatchObject({
      kind: 'file',
      size: large.byteLength,
    });
    const file = entry(snapshot, '/src/large.bin');
    if (file.kind !== 'file') throw new Error('large snapshot entry is not a file');
    expect(file.content).toEqual(large);
    expect(file.content).not.toBe(large);
  });

  it('gives same-content writes a new file and ancestor-subtree version', () => {
    const authority = make();
    authority.mkdirSync('/src', { recursive: false });
    authority.mkdirSync('/other', { recursive: false });
    authority.writeFileSync('/src/value.txt', encoder.encode('same'));
    authority.writeFileSync('/other/stable.txt', encoder.encode('stable'));
    const before = authority.snapshot();

    authority.writeFileSync('/src/value.txt', encoder.encode('same'));
    const after = authority.snapshot();

    expect(after.treeRevision).toBe(before.treeRevision + 1);
    expect(entry(after, '/src/value.txt').version).not.toBe(
      entry(before, '/src/value.txt').version,
    );
    expect(entry(after, '/src').version).not.toBe(entry(before, '/src').version);
    expect(entry(after, '/').version).not.toBe(entry(before, '/').version);
    expect(entry(after, '/other').version).toBe(entry(before, '/other').version);
    expect(entry(after, '/other/stable.txt').version).toBe(
      entry(before, '/other/stable.txt').version,
    );
  });

  it('owns written bytes and never exposes a mutable read alias', () => {
    const authority = make();
    const input = encoder.encode('owner bytes');

    authority.writeFileSync('/value.txt', input);
    const committed = authority.snapshot();
    input.fill(0x78);

    expect(authority.readFileBytesSync('/value.txt')).toEqual(encoder.encode('owner bytes'));
    expect(authority.snapshot()).toEqual(committed);

    const read = authority.readFileBytesSync('/value.txt');
    read.fill(0x79);

    expect(authority.readFileBytesSync('/value.txt')).toEqual(encoder.encode('owner bytes'));
    expect(authority.snapshot()).toEqual(committed);
  });

  it('never exposes mutable directory-entry aliases', () => {
    const authority = make();
    authority.mkdirSync('/dir', { recursive: false });
    authority.writeFileSync('/dir/value.txt', encoder.encode('value'));
    const committed = authority.snapshot();
    const first = authority.readdirSync('/dir');
    const exposed = first[0] as { name: string; isFile: boolean; isDirectory: boolean };

    exposed.name = 'forged.txt';
    exposed.isFile = false;
    exposed.isDirectory = true;

    expect(authority.readdirSync('/dir')).toEqual([
      { name: 'value.txt', isFile: true, isDirectory: false },
    ]);
    expect(authority.snapshot()).toEqual(committed);
  });

  it('covers every FsSync mutator through one revision-owning adapter', () => {
    const authority: FsSync & OwnerVfsAuthority = make();

    authority.mkdirSync('/source/nested', { recursive: true });
    const afterMkdir = authority.treeRevision;
    authority.writeFileSync('/source/nested/a.txt', encoder.encode('a'));
    authority.utimes('/source/nested/a.txt', 10, 20);
    authority.copyFileSync('/source/nested/a.txt', '/source/copied.txt');
    authority.cpSync('/source', '/tree', { recursive: true });
    authority.renameSync('/tree/copied.txt', '/tree/moved.txt');
    authority.rmSync('/tree/nested', { recursive: true });

    expect(afterMkdir).toBe(1);
    expect(authority.treeRevision).toBeGreaterThan(afterMkdir + 5);
    expect(authority.existsSync('/tree/moved.txt')).toBe(true);
    expect(authority.existsSync('/tree/nested')).toBe(false);
    expect(version(authority, '/tree')).toBeTruthy();
  });

  it.each([
    [
      'write',
      (authority: OwnerVfsAuthority, stamp: string) =>
        authority.writeFileSync(stamp, encoder.encode('forged')),
    ],
    [
      'mkdir',
      (authority: OwnerVfsAuthority, stamp: string) =>
        authority.mkdirSync(stamp, { recursive: false }),
    ],
    [
      'remove',
      (authority: OwnerVfsAuthority, stamp: string) => authority.rmSync(stamp, { force: true }),
    ],
    ['utimes', (authority: OwnerVfsAuthority, stamp: string) => authority.utimes(stamp, 10, 20)],
    [
      'copy source',
      (authority: OwnerVfsAuthority, stamp: string) =>
        authority.copyFileSync(stamp, '/saved-stamp.json'),
    ],
    [
      'copy target',
      (authority: OwnerVfsAuthority, stamp: string) =>
        authority.copyFileSync('/ordinary.txt', stamp),
    ],
    [
      'rename source',
      (authority: OwnerVfsAuthority, stamp: string) =>
        authority.renameSync(stamp, '/saved-stamp.json'),
    ],
    [
      'rename target',
      (authority: OwnerVfsAuthority, stamp: string) => authority.renameSync('/ordinary.txt', stamp),
    ],
  ] as const)('rejects direct reserved-claim %s before any mutation', (_operation, mutate) => {
    const raw = makeFs();
    const stamp = installStampPath('/project');
    raw.mkdirSync('/project/node_modules', { recursive: true });
    raw.writeFileSync(stamp, encoder.encode('authority claim'));
    raw.writeFileSync('/ordinary.txt', encoder.encode('ordinary'));
    const authority = createOwnerVfsAuthority(raw, { ownerEpoch: 'reserved-owner' });
    const before = authority.snapshot();

    expect(() => mutate(authority, stamp)).toThrowError(/EPERM/);

    expect(authority.snapshot()).toEqual(before);
    expect(authority.readFileBytesSync(stamp)).toEqual(encoder.encode('authority claim'));
    expect(authority.readFileBytesSync('/ordinary.txt')).toEqual(encoder.encode('ordinary'));
    expect(authority.existsSync('/saved-stamp.json')).toBe(false);
  });

  it('preflights every exact batch target before mutation', () => {
    const authority = make();
    authority.writeFileSync('/ordinary.txt', encoder.encode('ordinary'));
    const before = authority.snapshot();

    expect(() =>
      authority.assertPortablePaths([
        '/target/first.txt',
        installStampPath('/target/project'),
        '/target/last.txt',
      ]),
    ).toThrowError(/EPERM/);

    expect(authority.snapshot()).toEqual(before);
  });

  it('rejects ancestor removal carrying a nested claim before deleting any bytes', () => {
    const raw = makeFs();
    const nestedStamp = installStampPath('/project/node_modules/pkg');
    raw.mkdirSync('/project/node_modules/pkg/node_modules', { recursive: true });
    raw.writeFileSync('/project/main.ts', encoder.encode('main'));
    raw.writeFileSync(nestedStamp, encoder.encode('nested claim'));
    const authority = createOwnerVfsAuthority(raw, { ownerEpoch: 'remove-owner' });
    const before = authority.snapshot();

    expect(() => authority.rmSync('/project', { recursive: true })).toThrowError(/EPERM/);

    expect(authority.snapshot()).toEqual(before);
    expect(authority.readFileBytesSync('/project/main.ts')).toEqual(encoder.encode('main'));
    expect(authority.readFileBytesSync(nestedStamp)).toEqual(encoder.encode('nested claim'));
  });

  it('omits top-level and nested claims from recursive cp while retaining ordinary bytes', () => {
    const raw = makeFs();
    const topStamp = installStampPath('/source/project');
    const nestedStamp = installStampPath('/source/project/node_modules/pkg');
    raw.mkdirSync('/source/project/node_modules/pkg/node_modules', { recursive: true });
    raw.writeFileSync('/source/project/main.ts', encoder.encode('main'));
    raw.writeFileSync('/source/project/node_modules/pkg/index.js', encoder.encode('pkg'));
    raw.writeFileSync(topStamp, encoder.encode('top claim'));
    raw.writeFileSync(nestedStamp, encoder.encode('nested claim'));
    const authority = createOwnerVfsAuthority(raw, { ownerEpoch: 'copy-owner' });

    authority.cpSync('/source', '/target', { recursive: true });

    expect(authority.readFileBytesSync('/target/project/main.ts')).toEqual(encoder.encode('main'));
    expect(authority.readFileBytesSync('/target/project/node_modules/pkg/index.js')).toEqual(
      encoder.encode('pkg'),
    );
    expect(authority.existsSync(installStampPath('/target/project'))).toBe(false);
    expect(authority.existsSync(installStampPath('/target/project/node_modules/pkg'))).toBe(false);
    expect(authority.readFileBytesSync(topStamp)).toEqual(encoder.encode('top claim'));
    expect(authority.readFileBytesSync(nestedStamp)).toEqual(encoder.encode('nested claim'));
  });

  it('rejects a recursive cp whose ordinary source maps onto a reserved claim', () => {
    const raw = makeFs();
    raw.mkdirSync('/source', { recursive: true });
    raw.mkdirSync('/project', { recursive: true });
    raw.writeFileSync('/source/first.txt', encoder.encode('first'));
    raw.writeFileSync('/source/.rifty-install-stamp.json', encoder.encode('ordinary source'));
    const authority = createOwnerVfsAuthority(raw, { ownerEpoch: 'mapped-copy-owner' });
    const before = authority.snapshot();

    expect(() => authority.cpSync('/source', '/project/node_modules', { recursive: true })).toThrow(
      /EPERM/,
    );

    expect(authority.snapshot()).toEqual(before);
    expect(authority.readFileBytesSync('/source/.rifty-install-stamp.json')).toEqual(
      encoder.encode('ordinary source'),
    );
    expect(authority.existsSync('/project/node_modules')).toBe(false);
  });

  it('rejects a subtree rename carrying a claim before moving any bytes', () => {
    const raw = makeFs();
    raw.mkdirSync('/source/project/node_modules', { recursive: true });
    raw.writeFileSync('/source/project/main.ts', encoder.encode('main'));
    raw.writeFileSync(installStampPath('/source/project'), encoder.encode('claim'));
    const authority = createOwnerVfsAuthority(raw, { ownerEpoch: 'rename-owner' });
    const before = authority.snapshot();

    expect(() => authority.renameSync('/source', '/target')).toThrowError(/EPERM/);

    expect(authority.snapshot()).toEqual(before);
    expect(authority.existsSync('/source/project/main.ts')).toBe(true);
    expect(authority.existsSync('/target')).toBe(false);
  });

  it('rejects a subtree rename whose mapped target would become a claim', () => {
    const raw = makeFs();
    raw.mkdirSync('/source', { recursive: true });
    raw.mkdirSync('/project', { recursive: true });
    raw.writeFileSync('/source/.rifty-install-stamp.json', encoder.encode('ordinary source'));
    const authority = createOwnerVfsAuthority(raw, { ownerEpoch: 'mapped-rename-owner' });
    const before = authority.snapshot();

    expect(() => authority.renameSync('/source', '/project/node_modules')).toThrowError(/EPERM/);

    expect(authority.snapshot()).toEqual(before);
    expect(authority.readFileBytesSync('/source/.rifty-install-stamp.json')).toEqual(
      encoder.encode('ordinary source'),
    );
    expect(authority.existsSync('/project/node_modules')).toBe(false);
  });

  it('validates exact write CAS before mutation and preserves >128 KiB same-size guest bytes', () => {
    const authority = make();
    authority.mkdirSync('/src', { recursive: false });
    const opened = new Uint8Array(192 * 1024 + 7);
    opened.fill(0x11);
    const guest = new Uint8Array(opened.byteLength);
    guest.fill(0x22);
    const page = new Uint8Array(opened.byteLength);
    page.fill(0x33);
    const created = authority.applyHostCommit({
      kind: 'write',
      operationId: 'write-create',
      path: '/src/value.txt',
      data: opened,
      expectedVersion: null,
    });
    const openedVersion = created.versions[0]?.version;
    if (openedVersion === null || openedVersion === undefined) {
      throw new Error('write ACK omitted the file version');
    }

    authority.writeFileSync('/src/value.txt', guest);
    const beforeConflict = authority.snapshot();
    let conflict: VfsVersionConflictError | null = null;
    try {
      authority.applyHostCommit({
        kind: 'write',
        operationId: 'stale-save',
        path: '/src/value.txt',
        data: page,
        expectedVersion: openedVersion,
      });
    } catch (error) {
      if (error instanceof VfsVersionConflictError) conflict = error;
      else throw error;
    }

    expect(conflict).not.toBeNull();
    expect(conflict).toMatchObject({
      path: '/src/value.txt',
      expectedVersion: openedVersion,
      actualVersion: entry(beforeConflict, '/src/value.txt').version,
      ownerEpoch: 'owner-test-epoch',
      treeRevision: beforeConflict.treeRevision,
    });
    expect(conflict?.actualBytes).toEqual(guest);
    expect(conflict?.actualBytes).not.toBe(guest);
    expect(authority.snapshot()).toEqual(beforeConflict);
    expect(authority.readFileBytesSync('/src/value.txt')).toEqual(guest);
  });

  it('atomically validates both rename paths and returns exact post-commit versions', () => {
    const authority = make();
    authority.writeFileSync('/source.txt', encoder.encode('source'));
    authority.writeFileSync('/target.txt', encoder.encode('target'));
    const before = authority.snapshot();

    expect(() =>
      authority.applyHostCommit({
        kind: 'rename',
        operationId: 'rename-stale-target',
        sourcePath: '/source.txt',
        targetPath: '/target.txt',
        expectedSourceVersion: entry(before, '/source.txt').version,
        expectedTargetVersion: null,
      }),
    ).toThrow(VfsVersionConflictError);
    expect(authority.snapshot()).toEqual(before);

    const ack = authority.applyHostCommit({
      kind: 'rename',
      operationId: 'rename-exact',
      sourcePath: '/source.txt',
      targetPath: '/target.txt',
      expectedSourceVersion: entry(before, '/source.txt').version,
      expectedTargetVersion: entry(before, '/target.txt').version,
    });
    expect(ack).toMatchObject({
      operationId: 'rename-exact',
      ownerEpoch: 'owner-test-epoch',
      treeRevision: before.treeRevision + 1,
      versions: [{ path: '/source.txt', version: null }, { path: '/target.txt' }],
    });
    expect(authority.existsSync('/source.txt')).toBe(false);
    expect(authority.readFileBytesSync('/target.txt')).toEqual(encoder.encode('source'));
    expect(ack.versions[1]?.version).toBe(version(authority, '/target.txt'));
  });

  it('ACKs an identical operation idempotently and rejects divergent id reuse loudly', () => {
    const authority = make();
    const request = {
      kind: 'write' as const,
      operationId: 'stable-operation',
      path: '/value.txt',
      data: encoder.encode('one'),
      expectedVersion: null,
    };
    const first = authority.applyHostCommit(request);
    const revision = authority.treeRevision;

    const replay = authority.applyHostCommit({ ...request, data: request.data.slice() });
    expect(replay).toEqual(first);
    expect(authority.treeRevision).toBe(revision);

    expect(() => authority.applyHostCommit({ ...request, data: encoder.encode('two') })).toThrow(
      OperationIdReuseError,
    );
    expect(authority.treeRevision).toBe(revision);
    expect(authority.readFileBytesSync('/value.txt')).toEqual(encoder.encode('one'));
  });

  it('supports exact mkdir, remove, and nullable-target rename host commits', () => {
    const authority = make();
    const mkdir = authority.applyHostCommit({
      kind: 'mkdir',
      operationId: 'mkdir',
      path: '/dir',
      expectedVersion: null,
    });
    const dirVersion = mkdir.versions[0]?.version;
    if (dirVersion === null || dirVersion === undefined) throw new Error('mkdir omitted version');

    const write = authority.applyHostCommit({
      kind: 'write',
      operationId: 'write',
      path: '/dir/file.txt',
      data: encoder.encode('x'),
      expectedVersion: null,
    });
    const fileVersion = write.versions[0]?.version;
    if (fileVersion === null || fileVersion === undefined) throw new Error('write omitted version');

    const rename = authority.applyHostCommit({
      kind: 'rename',
      operationId: 'rename',
      sourcePath: '/dir/file.txt',
      targetPath: '/dir/moved.txt',
      expectedSourceVersion: fileVersion,
      expectedTargetVersion: null,
    });
    const movedVersion = rename.versions[1]?.version;
    if (movedVersion === null || movedVersion === undefined)
      throw new Error('rename omitted version');

    const removed = authority.applyHostCommit({
      kind: 'remove',
      operationId: 'remove',
      path: '/dir/moved.txt',
      expectedVersion: movedVersion,
    });
    expect(removed.versions).toEqual([{ path: '/dir/moved.txt', version: null }]);
    expect(authority.versionOf('/dir/moved.txt')).toBeNull();
    expect(authority.versionOf('/dir')).not.toBe(dirVersion);
  });
});

describe('owner VFS applied mutation journal', () => {
  it('owns one immutable cursor and wakes or rejects its waiter on publication or close', async () => {
    const { authority, appliedMutations } = createOwnerVfsAuthorityComposition(new MemoryFsSync(), {
      ownerEpoch: 'cursor-owner',
    });
    const cursor = appliedMutations.openCursor();

    expect('recordOrdinaryRevision' in appliedMutations).toBe(false);
    expect(() => appliedMutations.openCursor()).toThrow(/cursor.*open/i);
    const publication = cursor.wait();
    authority.writeFileSync('/value.txt', encoder.encode('value'));
    await expect(publication).resolves.toBeUndefined();

    const records = cursor.peek();
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(Object.isFrozen(records[0]?.mutations)).toBe(true);
    cursor.acknowledge(1);

    const closed = cursor.wait();
    cursor.close();
    await expect(closed).rejects.toThrow(/cursor.*closed/i);

    const replacement = appliedMutations.openCursor();
    expect(replacement.peek()).toEqual([]);
    replacement.close();
  });

  it('records a non-structural write revision for Files reflection', () => {
    const { authority, appliedMutations } = createOwnerVfsAuthorityComposition(new MemoryFsSync(), {
      ownerEpoch: 'write-owner',
    });
    const cursor = appliedMutations.openCursor();

    try {
      authority.writeFileSync('/terminal.txt', encoder.encode('from terminal'));

      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'write-owner',
          treeRevision: 1,
          mutations: [],
        },
      ]);
      cursor.acknowledge(1);
      expect(cursor.peek()).toEqual([]);
    } finally {
      cursor.close();
    }
  });

  it('records exact post-apply rename/remove facts and no additional fact for no-op or replay', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/source', { recursive: false });
    fs.writeFileSync('/source/nested.txt', encoder.encode('moved'));
    fs.mkdirSync('/remove', { recursive: false });
    fs.writeFileSync('/remove/nested.txt', encoder.encode('removed'));
    fs.writeFileSync('/same.txt', encoder.encode('same'));
    fs.writeFileSync('/replay.txt', encoder.encode('replay'));
    const { authority, appliedMutations } = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'applied-owner',
    });
    const cursor = appliedMutations.openCursor();

    try {
      authority.renameSync('/source', '/moved');

      expect(authority.existsSync('/source')).toBe(false);
      expect(authority.readFileBytesSync('/moved/nested.txt')).toEqual(encoder.encode('moved'));
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'applied-owner',
          treeRevision: 1,
          mutations: [{ kind: 'rename', sourcePath: '/source', targetPath: '/moved' }],
        },
      ]);
      cursor.acknowledge(1);

      authority.rmSync('/remove', { recursive: true });

      expect(authority.existsSync('/remove')).toBe(false);
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'applied-owner',
          treeRevision: 2,
          mutations: [{ kind: 'remove', path: '/remove', recursive: true }],
        },
      ]);
      cursor.acknowledge(2);

      authority.renameSync('/same.txt', '/same.txt');
      authority.rmSync('/missing', { force: true });
      expect(authority.treeRevision).toBe(2);
      expect(cursor.peek()).toEqual([]);

      const replayVersion = version(authority, '/replay.txt');
      const request = {
        kind: 'rename' as const,
        operationId: 'journal-replay',
        sourcePath: '/replay.txt',
        targetPath: '/replayed.txt',
        expectedSourceVersion: replayVersion,
        expectedTargetVersion: null,
      };
      const first = authority.applyHostCommit(request);
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'applied-owner',
          treeRevision: 3,
          mutations: [
            {
              kind: 'rename',
              sourcePath: '/replay.txt',
              targetPath: '/replayed.txt',
            },
          ],
        },
      ]);
      cursor.acknowledge(3);

      expect(authority.applyHostCommit(request)).toEqual(first);
      expect(authority.treeRevision).toBe(3);
      expect(cursor.peek()).toEqual([]);
    } finally {
      cursor.close();
    }
  });

  it('derives remove recursion from the removed entry instead of the request flag', () => {
    const fs = new MemoryFsSync();
    fs.writeFileSync('/file.txt', encoder.encode('file'));
    fs.mkdirSync('/empty', { recursive: false });
    const { authority, appliedMutations } = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'remove-shape-owner',
    });
    const cursor = appliedMutations.openCursor();

    try {
      authority.rmSync('/file.txt', { recursive: true });
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'remove-shape-owner',
          treeRevision: 1,
          mutations: [{ kind: 'remove', path: '/file.txt', recursive: false }],
        },
      ]);
      cursor.acknowledge(1);

      authority.rmSync('/empty', { recursive: false });
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'remove-shape-owner',
          treeRevision: 2,
          mutations: [{ kind: 'remove', path: '/empty', recursive: true }],
        },
      ]);
    } finally {
      cursor.close();
    }
  });

  it('coalesces reset scopes, including claim-only, no-op, overlap, and partial failure', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules', { recursive: true });
    const { authority, installStampClaims, appliedMutations } = createOwnerVfsAuthorityComposition(
      fs,
      { ownerEpoch: 'reset-owner' },
    );
    const cursor = appliedMutations.openCursor();
    const claim = encoder.encode('claim');

    try {
      await expect(
        appliedMutations.withStructuralReset('project', () => undefined),
      ).rejects.toThrow(/absolute/);
      await expect(
        appliedMutations.withStructuralReset('/project/.', () => undefined),
      ).rejects.toThrow(/canonical/);

      installStampClaims.write('/project', claim, { mkdirTree: false });
      expect(cursor.peek()).toEqual([
        { ownerEpoch: 'reset-owner', treeRevision: 1, mutations: [] },
      ]);
      cursor.acknowledge(1);

      const resetPublication = cursor.wait();
      await expect(
        appliedMutations.withStructuralReset('/project', async () => {
          authority.writeFileSync('/project/a.txt', encoder.encode('a'));
          authority.writeFileSync('/project/b.txt', encoder.encode('b'));
          expect(cursor.peek()).toEqual([]);
          return 'applied';
        }),
      ).resolves.toBe('applied');
      await expect(resetPublication).resolves.toBeUndefined();
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'reset-owner',
          treeRevision: 3,
          mutations: [{ kind: 'reset', rootPath: '/project' }],
        },
      ]);
      cursor.acknowledge(3);

      await appliedMutations.withStructuralReset('/project', () => {
        installStampClaims.write('/project', claim, { mkdirTree: false });
      });
      expect(cursor.peek()).toEqual([
        { ownerEpoch: 'reset-owner', treeRevision: 4, mutations: [] },
      ]);
      cursor.acknowledge(4);

      await appliedMutations.withStructuralReset('/project', () => undefined);
      expect(cursor.peek()).toEqual([]);

      const partial = new Error('partial reset failed');
      await expect(
        appliedMutations.withStructuralReset('/project', () => {
          authority.writeFileSync('/project/partial.txt', encoder.encode('partial'));
          throw partial;
        }),
      ).rejects.toBe(partial);
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'reset-owner',
          treeRevision: 5,
          mutations: [{ kind: 'reset', rootPath: '/project' }],
        },
      ]);
      cursor.acknowledge(5);

      await appliedMutations.withStructuralReset('/project', async () => {
        await expect(
          appliedMutations.withStructuralReset('/project', () => undefined),
        ).rejects.toThrow(/reset.*active/i);
      });
      expect(cursor.peek()).toEqual([]);
    } finally {
      cursor.close();
    }
  });

  it('derives semantic resets only from exact applied content-write evidence', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/.git', { recursive: true });
    const { authority, installStampClaims, appliedMutations } = createOwnerVfsAuthorityComposition(
      fs,
      { ownerEpoch: 'semantic-reset-owner' },
    );
    const cursor = appliedMutations.openCursor();
    const intents = [
      { kind: 'replace', path: '/project' },
      { kind: 'write', path: '/project/.git' },
      { kind: 'write', path: '/project/src/ordinary.ts' },
    ] satisfies readonly VfsMutationIntent[];

    try {
      await appliedMutations.withSemanticReplacements(intents, async () => {
        authority.writeFileSync('/project/.git/index', encoder.encode('metadata'));
        authority.mkdirSync('/project/src', { recursive: true });
        authority.writeFileSync('/project/src/replaced.ts', encoder.encode('first'));
        authority.writeFileSync('/project/src/replaced.ts', encoder.encode('second'));
        authority.writeFileSync('/project/src/ordinary.ts', encoder.encode('ordinary'));
        expect(cursor.peek()).toEqual([]);
      });

      expect(cursor.peek()).toEqual([
        { ownerEpoch: 'semantic-reset-owner', treeRevision: 1, mutations: [] },
        { ownerEpoch: 'semantic-reset-owner', treeRevision: 2, mutations: [] },
        { ownerEpoch: 'semantic-reset-owner', treeRevision: 3, mutations: [] },
        {
          ownerEpoch: 'semantic-reset-owner',
          treeRevision: 4,
          mutations: [{ kind: 'reset', rootPath: '/project/src/replaced.ts' }],
        },
        { ownerEpoch: 'semantic-reset-owner', treeRevision: 5, mutations: [] },
      ]);
      cursor.acknowledge(authority.treeRevision);

      const beforeClaim = authority.treeRevision;
      await appliedMutations.withSemanticReplacements(intents, () => {
        installStampClaims.write('/project', encoder.encode('claim'), { mkdirTree: true });
      });
      expect(authority.treeRevision).toBeGreaterThan(beforeClaim);
      expect(cursor.peek()).toEqual([
        { ownerEpoch: 'semantic-reset-owner', treeRevision: 6, mutations: [] },
        { ownerEpoch: 'semantic-reset-owner', treeRevision: 7, mutations: [] },
      ]);
      cursor.acknowledge(authority.treeRevision);

      const partial = new Error('semantic replacement partially failed');
      await expect(
        appliedMutations.withSemanticReplacements(intents, () => {
          authority.writeFileSync('/project/src/partial.ts', encoder.encode('partial'));
          throw partial;
        }),
      ).rejects.toBe(partial);
      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'semantic-reset-owner',
          treeRevision: authority.treeRevision,
          mutations: [{ kind: 'reset', rootPath: '/project/src/partial.ts' }],
        },
      ]);
      cursor.acknowledge(authority.treeRevision);

      await expect(
        appliedMutations.withSemanticReplacements(
          [
            { kind: 'write', path: '/project/src/conflict.ts' },
            { kind: 'replace', path: '/project/src/conflict.ts' },
          ],
          () => {
            throw new Error('must not apply an ambiguous semantic scope');
          },
        ),
      ).rejects.toThrow(/conflicting.*semantic/i);
      expect(cursor.peek()).toEqual([]);
    } finally {
      cursor.close();
    }
  });

  it('keeps each buffered structural fact on its exact applied revision', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/source.ts', encoder.encode('source'));
    const { authority, appliedMutations } = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'semantic-revision-owner',
    });
    const cursor = appliedMutations.openCursor();

    try {
      await appliedMutations.withSemanticReplacements(
        [{ kind: 'replace', path: '/project' }],
        () => {
          authority.renameSync('/project/source.ts', '/project/target.ts');
          authority.writeFileSync('/project/target.ts', encoder.encode('replaced'));
        },
      );

      expect(cursor.peek()).toEqual([
        {
          ownerEpoch: 'semantic-revision-owner',
          treeRevision: 1,
          mutations: [
            {
              kind: 'rename',
              sourcePath: '/project/source.ts',
              targetPath: '/project/target.ts',
            },
          ],
        },
        {
          ownerEpoch: 'semantic-revision-owner',
          treeRevision: 2,
          mutations: [{ kind: 'reset', rootPath: '/project/target.ts' }],
        },
      ]);
    } finally {
      cursor.close();
    }
  });
});

describe('owner VFS composition capabilities', () => {
  it('keeps reserved claim privilege construction-local and revision-owned', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules', { recursive: true });
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'claim-owner',
    });
    const stamp = installStampPath('/project');
    const claim = encoder.encode('authority claim');
    const projectVersion = authority.versionOf('/project');

    expect('installStampClaims' in authority).toBe(false);
    expect(() => authority.writeFileSync(stamp, claim)).toThrowError(/EPERM/);

    const beforeWrite = authority.treeRevision;
    installStampClaims.write('/project', claim, { mkdirTree: true });
    expect(installStampClaims.read('/project')).toEqual(claim);
    expect(authority.readFileBytesSync(stamp)).toEqual(claim);
    expect(authority.treeRevision).toBeGreaterThan(beforeWrite);
    expect(authority.versionOf(stamp)).not.toBeNull();
    expect(authority.versionOf('/project')).toBe(projectVersion);
    expect(() => installStampClaims.write('/project/.', claim, { mkdirTree: true })).toThrowError(
      /must be canonical/,
    );

    const beforeRemove = authority.treeRevision;
    installStampClaims.remove('/project');
    expect(installStampClaims.read('/project')).toBeNull();
    expect(authority.treeRevision).toBe(beforeRemove + 1);
    expect(authority.versionOf(stamp)).toBeNull();
    expect(authority.versionOf('/project')).toBe(projectVersion);

    authority.rmSync('/project', { recursive: true });
    expect(authority.existsSync('/project')).toBe(false);
  });

  it('privileged revocation self-heals a malformed marker-shaped directory', () => {
    const fs = new MemoryFsSync();
    const stamp = installStampPath('/project');
    fs.mkdirSync(stamp, { recursive: true });
    fs.writeFileSync(`${stamp}/payload`, encoder.encode('forged'));
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'claim-directory-owner',
    });

    installStampClaims.remove('/project');

    expect(authority.existsSync(stamp)).toBe(false);
    expect(authority.versionOf(stamp)).toBeNull();
    expect(authority.versionOf(`${stamp}/payload`)).toBeNull();
  });

  it('forwards the underlying optional durability flush unchanged', async () => {
    const report = { failures: [], total: 0 } as const;
    const flush = vi.fn(() => Promise.resolve(report));
    const fs = Object.assign(new MemoryFsSync(), { flush });
    const authority = createOwnerVfsAuthority(fs, { ownerEpoch: 'flush-owner' });
    const authorityFlush = Reflect.get(authority, 'flush');

    expect(typeof authorityFlush).toBe('function');
    await expect(Reflect.apply(authorityFlush, authority, [])).resolves.toBe(report);
    expect(flush).toHaveBeenCalledOnce();
  });

  it.each(backends)(
    'routes the bootstrap-paired async surface through the %s revision authority',
    async (_name, makeFs) => {
      vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
      setSyncMirror(makeFs());
      scopeActiveVfsToWorkspace('owner-async-proof');
      // Exactly the bootstrap order: backend → workspace scope → authority.
      const authority = createOwnerVfsAuthority(syncMirror(), { ownerEpoch: 'async-owner' });
      setSyncMirror(authority, { async: new SyncMirrorVfs() });
      const vfs = asyncVfs();
      if (vfs === null) throw new Error('bootstrap async VFS was not installed');

      await vfs.mkdir('/async', { recursive: false });
      const directoryVersion = authority.versionOf('/async');
      await vfs.writeFile('/async/value.txt', encoder.encode('shared tree'));
      const writeVersion = authority.versionOf('/async/value.txt');
      await vfs.utimes('/async/value.txt', 10, 20);

      expect(authority.treeRevision).toBe(3);
      expect(directoryVersion).not.toBeNull();
      expect(writeVersion).not.toBeNull();
      expect(authority.versionOf('/async/value.txt')).not.toBe(writeVersion);
      expect(authority.readFileBytesSync('/async/value.txt')).toEqual(
        encoder.encode('shared tree'),
      );

      await vfs.rm('/async', { recursive: true, force: false });
      expect(authority.treeRevision).toBe(4);
      expect(authority.versionOf('/async/value.txt')).toBeNull();
      expect(authority.existsSync('/async')).toBe(false);
    },
  );

  it.each(backends)(
    'tracks the profile-wide /.rifty root hidden by the %s workspace scope',
    (_name, makeFs) => {
      vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
      const raw = makeFs();
      raw.mkdirSync('/workspaces/profile-proof', { recursive: true });
      raw.mkdirSync('/.rifty/cache', { recursive: true });
      raw.writeFileSync('/.rifty/cache/value.bin', encoder.encode('cached'));
      const scoped = new ScopedFsSync(raw, workspaceVfsPrefix('profile-proof'));
      const options: OwnerVfsAuthorityOptions & { readonly initialRoots: readonly string[] } = {
        ownerEpoch: 'profile-owner',
        initialRoots: ['/', '/.rifty'],
      };
      const authority = createOwnerVfsAuthority(scoped, options);
      const tracked = authority.versionOf('/.rifty/cache/value.bin');
      const before = authority.treeRevision;

      authority.rmSync('/.rifty/cache', { recursive: true, force: false });

      expect(tracked).not.toBeNull();
      expect(authority.treeRevision).toBe(before + 1);
      expect(authority.versionOf('/.rifty/cache/value.bin')).toBeNull();
      expect(raw.existsSync('/.rifty/cache')).toBe(false);
    },
  );

  it.each(backends)(
    'keeps the detached %s profile root versioned across a workspace-root reset',
    (_name, makeFs) => {
      vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
      const raw = makeFs();
      raw.mkdirSync('/workspaces/profile-reset/project', { recursive: true });
      raw.writeFileSync('/workspaces/profile-reset/project/main.ts', encoder.encode('project'));
      raw.mkdirSync('/.rifty/cache', { recursive: true });
      raw.writeFileSync('/.rifty/cache/value.bin', encoder.encode('profile'));
      const scoped = new ScopedFsSync(raw, workspaceVfsPrefix('profile-reset'));
      const authority = createOwnerVfsAuthority(scoped, {
        ownerEpoch: 'profile-reset-owner',
        initialRoots: ['/', '/.rifty'],
      });
      const profileVersion = authority.versionOf('/.rifty/cache/value.bin');
      if (profileVersion === null) throw new Error('profile file was not initially tracked');
      const beforeReset = authority.treeRevision;

      authority.rmSync('/', { recursive: true, force: false });

      expect(authority.treeRevision).toBe(beforeReset + 1);
      expect(raw.existsSync('/.rifty/cache/value.bin')).toBe(true);
      expect(authority.versionOf('/.rifty/cache/value.bin')).toBe(profileVersion);
      const beforeProfileRemove = authority.treeRevision;
      authority.rmSync('/.rifty/cache', { recursive: true, force: false });
      expect(authority.treeRevision).toBe(beforeProfileRemove + 1);
      expect(authority.versionOf('/.rifty/cache/value.bin')).toBeNull();
    },
  );

  it.each(backends)(
    'records removal and recreation of an empty %s scoped workspace root',
    (_name, makeFs) => {
      vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
      const raw = makeFs();
      raw.mkdirSync('/workspaces/empty-root', { recursive: true });
      const scoped = new ScopedFsSync(raw, workspaceVfsPrefix('empty-root'));
      const authority = createOwnerVfsAuthority(scoped, {
        ownerEpoch: 'empty-root-owner',
        initialRoots: ['/', '/.rifty'],
      });
      const initialVersion = authority.versionOf('/');
      const before = authority.treeRevision;

      authority.rmSync('/', { recursive: true, force: false });

      expect(initialVersion).not.toBeNull();
      expect(raw.existsSync('/workspaces/empty-root')).toBe(false);
      expect(authority.treeRevision).toBe(before + 1);
      expect(authority.versionOf('/')).toBeNull();

      authority.mkdirSync('/', { recursive: true });
      expect(authority.treeRevision).toBe(before + 2);
      expect(authority.versionOf('/')).not.toBeNull();
    },
  );

  it.each(backends)(
    'allows %s copies across detached mounts but rejects a real same-mount subtree copy',
    (_name, makeFs) => {
      vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
      const raw = makeFs();
      raw.mkdirSync('/workspaces/cross-mount/project', { recursive: true });
      raw.writeFileSync('/workspaces/cross-mount/project/main.ts', encoder.encode('source'));
      raw.mkdirSync('/.rifty', { recursive: true });
      const scoped = new ScopedFsSync(raw, workspaceVfsPrefix('cross-mount'));
      const authority = createOwnerVfsAuthority(scoped, {
        ownerEpoch: 'cross-mount-owner',
        initialRoots: ['/', '/.rifty'],
      });

      authority.cpSync('/', '/.rifty/backup', { recursive: true });

      expect(authority.readFileBytesSync('/.rifty/backup/project/main.ts')).toEqual(
        encoder.encode('source'),
      );
      expect(authority.versionOf('/.rifty/backup/project/main.ts')).not.toBeNull();
      expect(() =>
        authority.cpSync('/project', '/project/nested', { recursive: true }),
      ).toThrowError(/EINVAL/);
    },
  );

  afterEach(() => {
    resetSyncMirror();
    vi.restoreAllMocks();
  });
});
