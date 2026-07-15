import { describe, expect, it } from 'vitest';
import type { HostCommitRequest } from '../glue/owner-vfs-protocol.ts';
import type { VfsSnapshotFrame } from '../glue/vfs-snapshot-port.ts';
import { ProjectFileOperationError } from './errors.ts';
import { createProjectContentTransport } from './project-content-transport.ts';
import type { OwnerProjectVfsFrame, PageProjectVfsFrame } from './project-vfs-protocol.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const OWNER = 'owner-a';
const encoder = new TextEncoder();

function snapshot(
  revision: number,
  text = 'initial',
  ownerEpoch = OWNER,
  root = ROOT,
): VfsSnapshotFrame {
  const content = encoder.encode(text);
  return {
    type: 'snapshot',
    root,
    ownerEpoch,
    treeRevision: revision,
    nodeModulesPresent: false,
    entries: [
      { path: `${root}/src`, kind: 'dir', size: 0, version: `dir-v${revision}` },
      {
        path: `${root}/src/main.ts`,
        kind: 'file',
        size: content.byteLength,
        content,
        version: `file-v${revision}`,
      },
    ],
  };
}

function harness() {
  const sent: PageProjectVfsFrame[] = [];
  let alive = true;
  let sequence = 0;
  const transport = createProjectContentTransport({
    projectRoot: ROOT,
    send(frame) {
      sent.push(structuredClone(frame));
      return true;
    },
    isAlive: () => alive,
    generateRequestId: () => `transport-${String(++sequence)}`,
    commitTimeoutMs: 1_000,
  });
  return {
    transport,
    sent,
    setAlive(value: boolean) {
      alive = value;
    },
    acceptSnapshot(frame = snapshot(1)) {
      transport.accept({ type: 'workbench:project-vfs-snapshot', frame });
    },
  };
}

function commitFrame(sent: readonly PageProjectVfsFrame[]) {
  const frame = sent.find(
    (
      candidate,
    ): candidate is Extract<PageProjectVfsFrame, { readonly type: 'rifty:owner-vfs-commit' }> =>
      candidate.type === 'rifty:owner-vfs-commit',
  );
  if (frame === undefined) throw new Error('missing commit frame');
  return frame;
}

describe('ProjectContentTransport', () => {
  it('requests and awaits the first exact snapshot, then ignores stale owner frames', async () => {
    const h = harness();
    expect(h.sent).toEqual([{ type: 'workbench:project-vfs-snapshot-request' }]);
    let ready = false;
    void h.transport.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    h.acceptSnapshot();
    const content = await h.transport.ready;
    const initial = content.files.snapshot();
    expect(initial).toMatchObject({
      excludedDirectoryNames: ['node_modules', '.git', '.vite', 'dist'],
      entries: [
        { path: '/src', kind: 'dir', size: 0 },
        { path: '/src/main.ts', kind: 'file', size: 7 },
      ],
    });
    const initialFile = initial.entries.find((entry) => entry.path === '/src/main.ts');
    if (initialFile === undefined) throw new Error('initial file version missing');
    expect(initialFile.version).not.toBe('file-v1');
    expect(initialFile.version).not.toContain(OWNER);

    h.acceptSnapshot(snapshot(99, 'stale', 'retired-owner'));
    expect(content.files.snapshot().entries).toContainEqual({
      path: '/src/main.ts',
      kind: 'file',
      size: 7,
      version: initialFile.version,
    });
  });

  it('correlates atomic reads by request, path, owner, and revision without public leakage', async () => {
    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;

    const reading = content.files.readFile('/src/main.ts');
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:project-vfs-read-file',
      requestId: 'transport-1',
      path: `${ROOT}/src/main.ts`,
    });
    h.transport.accept({
      type: 'workbench:project-vfs-read-file-result',
      requestId: 'transport-1',
      ok: true,
      ownerEpoch: OWNER,
      treeRevision: 1,
      entry: {
        path: `${ROOT}/src/main.ts`,
        kind: 'file',
        size: 6,
        content: encoder.encode('atomic'),
        version: 'atomic-v1',
      },
    });
    const read = await reading;
    expect(read).toMatchObject({ path: '/src/main.ts', bytes: encoder.encode('atomic') });
    expect(read.version).not.toBe('atomic-v1');
    expect(read.version).not.toContain(OWNER);

    const mismatched = content.files.readFile('/src/main.ts');
    expect(() =>
      h.transport.accept({
        type: 'workbench:project-vfs-read-file-result',
        requestId: 'transport-2',
        ok: true,
        ownerEpoch: OWNER,
        treeRevision: 2,
        entry: {
          path: `${ROOT}/src/other.ts`,
          kind: 'file',
          size: 5,
          content: encoder.encode('wrong'),
          version: 'other-v2',
        },
      }),
    ).toThrow('Project VFS read-file result did not match its request');
    await expect(mismatched).rejects.toBeInstanceOf(ProjectFileOperationError);
    await expect(mismatched).rejects.not.toHaveProperty('ownerEpoch');
  });

  it('reuses the exact client/coordinator path through ACK, reflection, and durability', async () => {
    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;
    const expectedVersion = content.files
      .snapshot()
      .entries.find((entry) => entry.path === '/src/main.ts')?.version;
    if (expectedVersion === undefined) throw new Error('initial file version missing');
    const writing = content.files.writeFile('/src/main.ts', encoder.encode('next'), {
      expectedVersion,
    });
    const commit = commitFrame(h.sent);
    const request = commit.request as Extract<HostCommitRequest, { readonly kind: 'write' }>;
    expect(request).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      expectedVersion: 'file-v1',
    });
    const ack = {
      operationId: request.operationId,
      ownerEpoch: OWNER,
      treeRevision: 2,
      versions: [{ path: request.path, version: 'file-v2' }],
    } as const;
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack,
    } as const;
    h.transport.accept(terminal);
    expect(h.sent.at(-1)).toEqual({
      type: 'rifty:owner-vfs-commit-received',
      terminal,
    });
    h.transport.accept({ type: 'rifty:owner-vfs-commit-released', terminal });
    h.acceptSnapshot(snapshot(2, 'next'));
    await Promise.resolve();
    expect(h.sent.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'transport-1',
      ownerEpoch: OWNER,
      treeRevision: 2,
    });
    h.transport.accept({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'transport-1',
      ok: true,
      receipt: { ownerEpoch: OWNER, treeRevision: 2, durability: 'durable' },
    });
    const result = await writing;
    expect(result.path).toBe('/src/main.ts');
    expect(result.version).not.toBe('file-v2');
    expect(result.version).not.toContain(OWNER);
    expect(content.files.snapshot().entries).toContainEqual({
      path: '/src/main.ts',
      kind: 'file',
      size: 4,
      version: result.version,
    });
  });

  it('drains an admitted commit through durability before content close resolves', async () => {
    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;
    const expectedVersion = content.files
      .snapshot()
      .entries.find((entry) => entry.path === '/src/main.ts')?.version;
    if (expectedVersion === undefined) throw new Error('initial file version missing');
    const writing = content.files.writeFile('/src/main.ts', encoder.encode('next'), {
      expectedVersion,
    });
    const commit = commitFrame(h.sent);
    const request = commit.request as Extract<HostCommitRequest, { readonly kind: 'write' }>;
    const closing = content.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);

    const terminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack: {
        operationId: request.operationId,
        ownerEpoch: OWNER,
        treeRevision: 2,
        versions: [{ path: request.path, version: 'file-v2' }],
      },
    } as const;
    h.transport.accept(terminal);
    h.transport.accept({ type: 'rifty:owner-vfs-commit-released', terminal });
    h.acceptSnapshot(snapshot(2, 'next'));
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(h.sent.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'transport-1',
      ownerEpoch: OWNER,
      treeRevision: 2,
    });

    h.transport.accept({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'transport-1',
      ok: true,
      receipt: { ownerEpoch: OWNER, treeRevision: 2, durability: 'durable' },
    });
    const result = await writing;
    expect(result.path).toBe('/src/main.ts');
    expect(result.version).not.toBe('file-v2');
    expect(result.version).not.toContain(OWNER);
    await expect(closing).resolves.toBeUndefined();
    expect(closed).toBe(true);
  });

  it('disconnect rejects readiness and pending reads, fences the client, and clears the mirror', async () => {
    const unopened = harness();
    unopened.setAlive(false);
    unopened.transport.disconnect();
    await expect(unopened.transport.ready).rejects.toThrow('Project content transport is closed');

    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;
    const reading = content.files.readFile('/src/main.ts');
    h.setAlive(false);
    h.transport.disconnect();
    await expect(reading).rejects.toBeInstanceOf(ProjectFileOperationError);
    expect(content.files.snapshot().entries).toEqual([]);
    await expect(content.files.mkdir('/later', { expectedVersion: null })).rejects.toBeInstanceOf(
      ProjectFileOperationError,
    );
  });

  it('rejects a snapshot for another root before binding readiness', async () => {
    const h = harness();
    const wrong: OwnerProjectVfsFrame = {
      type: 'workbench:project-vfs-snapshot',
      frame: snapshot(1, 'wrong', OWNER, '/other/project'),
    };
    expect(() => h.transport.accept(wrong)).toThrow('Project VFS snapshot root mismatch');
  });
});
