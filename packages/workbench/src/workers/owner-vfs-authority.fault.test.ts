import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { VfsCommitAppliedError, VfsVersionConflictError } from '../glue/owner-vfs-protocol.ts';
import {
  createOwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';

const encoder = new TextEncoder();

describe('owner VFS authority faults', () => {
  it('retains no duplicate admission ledger: CAS alone orders two independently admitted frames', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'duplicate-in-flight',
      path: '/value.txt',
      data: encoder.encode('original'),
      expectedVersion: null,
    };
    let settle: (() => void) | undefined;
    const firstApply = vi.fn(async (candidate, apply) => {
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      return apply(candidate);
    });
    const secondApply = vi.fn((candidate, apply) => apply(candidate));
    const firstOutcome = authority.admitHostCommit(request, firstApply, vi.fn());
    const secondOutcome = authority.admitHostCommit(
      { ...request, data: request.data.slice() },
      secondApply,
      vi.fn(),
    );

    expect(secondOutcome).not.toBe(firstOutcome);
    await expect(secondOutcome).resolves.toMatchObject({ ok: true });
    expect(secondApply).toHaveBeenCalledTimes(1);
    settle?.();
    await expect(firstOutcome).resolves.toMatchObject({
      ok: false,
      error: { kind: 'version-conflict' },
    });
    expect(authority.readFileBytesSync(request.path)).toEqual(request.data);
  });

  it('retains applied evidence when the admitted executor fails after mutation', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'post-apply-failure',
      path: '/value.txt',
      data: encoder.encode('applied'),
      expectedVersion: null,
    };

    const terminal = await authority.admitHostCommit(
      request,
      async (candidate, apply) => {
        const applied = apply(candidate);
        throw new VfsCommitAppliedError(applied, new Error('executor failed after apply'));
      },
      vi.fn(),
    );

    expect(terminal).toMatchObject({
      ok: false,
      error: { message: 'executor failed after apply' },
      applied: { operationId: request.operationId, treeRevision: 1 },
    });
  });

  it('NACKs forged executor success with the admission-scoped applied evidence', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'forged-executor-ack',
      path: '/value.txt',
      data: encoder.encode('applied'),
      expectedVersion: null,
    };
    const publish = vi.fn();

    const terminal = await authority.admitHostCommit(
      request,
      async (candidate, apply) => {
        const applied = apply(candidate);
        return { ...applied, treeRevision: applied.treeRevision + 1 };
      },
      publish,
    );

    expect(terminal).toMatchObject({
      ok: false,
      error: { name: 'VfsCommitProtocolError' },
      applied: { operationId: request.operationId, treeRevision: 1 },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not let an executor mutate the admitted request object or write bytes before apply', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'mutated-execution-candidate',
      path: '/intended.txt',
      data: encoder.encode('intended'),
      expectedVersion: null,
    };

    const terminal = await authority.admitHostCommit(
      request,
      (candidate, apply) => {
        const mutable = candidate as {
          path: string;
          data: Uint8Array;
        };
        mutable.path = '/forged.txt';
        mutable.data.fill(0x78);
        return apply(candidate);
      },
      vi.fn(),
    );

    expect(terminal).toMatchObject({
      ok: false,
      error: { name: 'VfsCommitProtocolError' },
    });
    expect(authority.existsSync('/intended.txt')).toBe(false);
    expect(authority.existsSync('/forged.txt')).toBe(false);
  });

  it('keeps terminal correlation on the admitted id when the caller mutates its object later', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'admitted-id',
      path: '/value.txt',
      data: encoder.encode('value'),
      expectedVersion: null,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcome = authority.admitHostCommit(
      request,
      async (candidate, apply) => {
        await gate;
        return apply(candidate);
      },
      vi.fn(),
    );

    (request as { operationId: string }).operationId = 'mutated-id';
    release();

    await expect(outcome).resolves.toMatchObject({
      ok: true,
      operationId: 'admitted-id',
      ack: { operationId: 'admitted-id' },
    });
  });

  it('releases admission identity immediately after its exact terminal is emitted', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'bounded-replay',
      path: '/large.bin',
      data: new Uint8Array(512 * 1024),
      expectedVersion: null,
    };
    const terminal = await authority.admitHostCommit(
      request,
      (candidate, apply) => apply(candidate),
      vi.fn(),
    );
    expect(terminal.ok).toBe(true);

    // A late duplicate is a fresh CAS attempt; no request/terminal ledger exists.
    expect(() => authority.applyHostCommit(request)).toThrow(VfsVersionConflictError);
  });

  it('does not publish a revision when the real backend rejects before mutation', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const before = authority.snapshot();

    expect(() => authority.writeFileSync('/missing/file.txt', encoder.encode('x'))).toThrow();
    expect(authority.snapshot()).toEqual(before);
  });

  it('does not journal a failed raw rename or failed rename CAS', () => {
    class FailingRenameFs extends MemoryFsSync {
      failRename = false;

      override renameSync(sourcePath: string, targetPath: string): void {
        if (this.failRename) throw new Error('raw rename failed');
        super.renameSync(sourcePath, targetPath);
      }
    }

    const fs = new FailingRenameFs();
    fs.writeFileSync('/source.txt', encoder.encode('source'));
    fs.writeFileSync('/target.txt', encoder.encode('target'));
    const { authority, appliedMutations } = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'fault-owner',
    });
    const cursor = appliedMutations.openCursor();
    const before = authority.snapshot();

    try {
      fs.failRename = true;
      expect(() => authority.renameSync('/source.txt', '/moved.txt')).toThrow('raw rename failed');
      expect(authority.snapshot()).toEqual(before);
      expect(cursor.peek()).toEqual([]);

      fs.failRename = false;
      const sourceVersion = authority.versionOf('/source.txt');
      if (sourceVersion === null) throw new Error('source version missing after raw failure');
      expect(() =>
        authority.applyHostCommit({
          kind: 'rename',
          operationId: 'stale-journal-rename',
          sourcePath: '/source.txt',
          targetPath: '/target.txt',
          expectedSourceVersion: sourceVersion,
          expectedTargetVersion: null,
        }),
      ).toThrow(VfsVersionConflictError);
      expect(authority.snapshot()).toEqual(before);
      expect(cursor.peek()).toEqual([]);
    } finally {
      cursor.close();
    }
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
