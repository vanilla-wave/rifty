import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { VfsVersionConflictError } from '../glue/owner-vfs-protocol.ts';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';

const encoder = new TextEncoder();

describe('owner VFS authority faults', () => {
  it('does not publish a revision when the real backend rejects before mutation', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const before = authority.snapshot();

    expect(() => authority.writeFileSync('/missing/file.txt', encoder.encode('x'))).toThrow();
    expect(authority.snapshot()).toEqual(before);
  });

  it('records each real partial cp mutation before propagating the later failure', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    authority.mkdirSync('/source/b', { recursive: true });
    authority.writeFileSync('/source/a.txt', encoder.encode('copied-before-fault'));
    authority.writeFileSync('/source/b/child.txt', encoder.encode('blocked'));
    authority.mkdirSync('/target', { recursive: false });
    authority.writeFileSync('/target/b', encoder.encode('kind-conflict'));
    const beforeRevision = authority.treeRevision;

    expect(() => authority.cpSync('/source', '/target', { recursive: true })).toThrow();

    expect(authority.treeRevision).toBe(beforeRevision + 1);
    expect(authority.readFileBytesSync('/target/a.txt')).toEqual(
      encoder.encode('copied-before-fault'),
    );
    expect(authority.readFileBytesSync('/target/b')).toEqual(encoder.encode('kind-conflict'));
    expect(authority.snapshot().treeRevision).toBe(authority.treeRevision);
  });

  it('keeps both source and target intact when either rename CAS is stale', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    authority.writeFileSync('/source.txt', encoder.encode('source'));
    authority.writeFileSync('/target.txt', encoder.encode('target'));
    const sourceVersion = authority.versionOf('/source.txt');
    const targetVersion = authority.versionOf('/target.txt');
    if (sourceVersion === null || targetVersion === null) throw new Error('seed missing');
    const before = authority.snapshot();

    expect(() =>
      authority.applyHostCommit({
        kind: 'rename',
        operationId: 'stale-source',
        sourcePath: '/source.txt',
        targetPath: '/target.txt',
        expectedSourceVersion: 'stale',
        expectedTargetVersion: targetVersion,
      }),
    ).toThrow(VfsVersionConflictError);
    expect(authority.snapshot()).toEqual(before);

    expect(() =>
      authority.applyHostCommit({
        kind: 'rename',
        operationId: 'stale-target',
        sourcePath: '/source.txt',
        targetPath: '/target.txt',
        expectedSourceVersion: sourceVersion,
        expectedTargetVersion: 'stale',
      }),
    ).toThrow(VfsVersionConflictError);
    expect(authority.snapshot()).toEqual(before);
  });

  it('keeps the tree intact for stale mkdir and remove CAS', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    authority.mkdirSync('/dir', { recursive: false });
    authority.writeFileSync('/dir/file.txt', encoder.encode('keep'));
    const before = authority.snapshot();

    expect(() =>
      authority.applyHostCommit({
        kind: 'mkdir',
        operationId: 'mkdir-existing',
        path: '/dir',
        expectedVersion: null,
      }),
    ).toThrow(VfsVersionConflictError);
    expect(authority.snapshot()).toEqual(before);

    expect(() =>
      authority.applyHostCommit({
        kind: 'remove',
        operationId: 'remove-stale',
        path: '/dir/file.txt',
        expectedVersion: 'stale',
      }),
    ).toThrow(VfsVersionConflictError);
    expect(authority.snapshot()).toEqual(before);
    expect(authority.readFileBytesSync('/dir/file.txt')).toEqual(encoder.encode('keep'));
  });
});
