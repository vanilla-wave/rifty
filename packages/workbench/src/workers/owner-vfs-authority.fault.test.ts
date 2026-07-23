import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type HostCommitAck,
  OperationIdReuseError,
  VfsVersionConflictError,
} from '../glue/owner-vfs-protocol.ts';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';

const encoder = new TextEncoder();

function successTerminal(ack: HostCommitAck) {
  return {
    type: 'rifty:owner-vfs-commit-ack' as const,
    operationId: ack.operationId,
    ok: true as const,
    ack,
  };
}

describe('owner VFS authority faults', () => {
  it.each([
    { first: 'NACK', late: 'success' },
    { first: 'success', late: 'NACK' },
  ] as const)(
    'gives exact duplicate async admissions one retained terminal: $first before late $late',
    async ({ first }) => {
      const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
        ownerEpoch: 'fault-owner',
      });
      const request = {
        kind: 'write' as const,
        operationId: `one-outcome-${first}`,
        path: '/value.txt',
        data: encoder.encode('exact'),
        expectedVersion: null,
      };
      let settleFirst: (() => void) | undefined;
      let rejectFirst: ((error: Error) => void) | undefined;
      const firstApply = vi.fn(async () => {
        await new Promise<void>((resolve, reject) => {
          settleFirst = resolve;
          rejectFirst = reject;
        });
        return authority.applyHostCommit(request);
      });
      const lateApply = vi.fn(() => {
        if (first === 'NACK') return authority.applyHostCommit(request);
        throw new Error('late NACK must not replace success');
      });
      const firstPublish = vi.fn();
      const firstOutcome = authority.admitHostCommit(request, firstApply, firstPublish);
      const duplicateOutcome = authority.admitHostCommit(
        { ...request, data: request.data.slice() },
        lateApply,
        vi.fn(),
      );

      expect(firstApply).toHaveBeenCalledTimes(1);
      expect(lateApply).not.toHaveBeenCalled();
      expect(duplicateOutcome).toBe(firstOutcome);

      if (first === 'NACK') rejectFirst?.(new Error('first admission rejected'));
      else settleFirst?.();

      const terminal = await firstOutcome;
      await expect(duplicateOutcome).resolves.toEqual(terminal);
      expect(terminal.ok).toBe(first === 'success');
      expect(firstPublish).toHaveBeenCalledTimes(first === 'success' ? 1 : 0);
      expect(authority.existsSync(request.path)).toBe(first === 'success');
      expect(authority.retainedHostCommitTerminal(request.operationId)).toEqual(terminal);
      authority.cleanupHostCommitTerminal(terminal);
      expect(authority.retainedHostCommitTerminal(request.operationId)).toBeNull();
    },
  );

  it('rejects divergent bytes without admitting a second async operation', async () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'divergent-in-flight',
      path: '/value.txt',
      data: encoder.encode('original'),
      expectedVersion: null,
    };
    let settle: (() => void) | undefined;
    const firstApply = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      return authority.applyHostCommit(request);
    });
    const divergentApply = vi.fn();
    const exactOutcome = authority.admitHostCommit(request, firstApply, vi.fn());
    const divergentOutcome = authority.admitHostCommit(
      { ...request, data: encoder.encode('divergent') },
      divergentApply,
      vi.fn(),
    );

    expect(divergentApply).not.toHaveBeenCalled();
    await expect(divergentOutcome).resolves.toMatchObject({
      operationId: request.operationId,
      ok: false,
      error: { kind: 'operation-id-reuse', operationId: request.operationId },
    });
    settle?.();
    await expect(exactOutcome).resolves.toMatchObject({ ok: true });
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
      async (candidate) => {
        authority.applyHostCommit(candidate);
        throw new Error('executor failed after apply');
      },
      vi.fn(),
    );

    expect(terminal).toMatchObject({
      ok: false,
      error: { message: 'executor failed after apply' },
      applied: { operationId: request.operationId, treeRevision: 1 },
    });
    expect(authority.retainedHostCommitTerminal(request.operationId)).toEqual(terminal);
  });

  it('NACKs forged executor success with the authority-owned applied ACK', async () => {
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
      async (candidate) => {
        const applied = authority.applyHostCommit(candidate);
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

  it('releases retained commit bytes only after exact terminal cleanup', () => {
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
    const ack = authority.applyHostCommit(request);
    const terminal = successTerminal(ack);
    authority.retainHostCommitTerminal(terminal);
    authority.cleanupHostCommitTerminal(terminal);

    // Once the terminal response is received, a late request enters normal CAS
    // validation instead of replaying an owner-held copy of the large payload.
    expect(() => authority.applyHostCommit(request)).toThrow(VfsVersionConflictError);
  });

  it('keeps the original replay record through divergent request and cleanup reuse', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'exact-replay',
      path: '/value.txt',
      data: encoder.encode('original'),
      expectedVersion: null,
    };
    const ack = authority.applyHostCommit(request);
    const terminal = successTerminal(ack);
    authority.retainHostCommitTerminal(terminal);

    expect(() =>
      authority.applyHostCommit({ ...request, data: encoder.encode('divergent') }),
    ).toThrow(OperationIdReuseError);
    expect(() =>
      authority.cleanupHostCommitTerminal({
        ...terminal,
        ack: { ...ack, treeRevision: ack.treeRevision + 1 },
      }),
    ).toThrow(OperationIdReuseError);
    expect(authority.applyHostCommit({ ...request, data: request.data.slice() })).toEqual(ack);
  });

  it('recovers the retained exact terminal after divergent cleanup without releasing it', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'receipt-recovery',
      path: '/value.txt',
      data: encoder.encode('original'),
      expectedVersion: null,
    };
    const ack = authority.applyHostCommit(request);
    const terminal = successTerminal(ack);
    authority.retainHostCommitTerminal(terminal);

    expect(() =>
      authority.cleanupHostCommitTerminal({
        ...terminal,
        ack: { ...ack, treeRevision: ack.treeRevision + 1 },
      }),
    ).toThrow(OperationIdReuseError);
    expect(authority.retainedHostCommitTerminal(request.operationId)).toEqual(terminal);

    authority.cleanupHostCommitTerminal(terminal);
    expect(authority.retainedHostCommitTerminal(request.operationId)).toBeNull();
  });

  it('retains the full terminal until idempotent final cleanup after one apply', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'fault-owner',
    });
    const request = {
      kind: 'write' as const,
      operationId: 'full-terminal-cleanup',
      path: '/value.txt',
      data: encoder.encode('original'),
      expectedVersion: null,
    };
    const ack = authority.applyHostCommit(request);
    const terminal = successTerminal(ack);
    const cleanupAuthority: OwnerVfsAuthority = authority;

    cleanupAuthority.retainHostCommitTerminal(terminal);
    expect(cleanupAuthority.retainedHostCommitTerminal(request.operationId)).toEqual(terminal);
    expect(authority.applyHostCommit(request)).toEqual(ack);

    cleanupAuthority.cleanupHostCommitTerminal(terminal);
    expect(cleanupAuthority.retainedHostCommitTerminal(request.operationId)).toBeNull();
    expect(() => cleanupAuthority.cleanupHostCommitTerminal(terminal)).not.toThrow();
    expect(
      authority.snapshot().entries.filter((entry) => entry.path === request.path),
    ).toHaveLength(1);
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
