import { describe, expect, it } from 'vitest';
import type { HostCommitRequest } from '../glue/owner-vfs-protocol.ts';
import { VfsCommitProtocolError } from '../glue/owner-vfs-protocol.ts';
import type { VfsSnapshotFrame } from '../glue/vfs-snapshot-port.ts';
import { ProjectFileOperationError } from './errors.ts';
import { createProjectContentTransport } from './project-content-transport.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
  ProjectVfsAppliedMutation,
} from './project-vfs-protocol.ts';

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
    acceptState(
      frame = snapshot(2, 'next'),
      fromTreeRevision = 1,
      mutations: readonly ProjectVfsAppliedMutation[] = [],
    ) {
      transport.accept({
        type: 'workbench:project-vfs-state',
        fromTreeRevision,
        mutations,
        frame,
      });
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
  it('requests and awaits the first exact snapshot', async () => {
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
    h.acceptState(snapshot(2, 'next'));
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
    h.acceptState(snapshot(2, 'next'));
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

  it('fatally rejects a snapshot for another root before binding readiness', async () => {
    const h = harness();
    let rejected = false;
    void h.transport.ready.catch(() => {
      rejected = true;
    });
    const wrong: OwnerProjectVfsFrame = {
      type: 'workbench:project-vfs-snapshot',
      frame: snapshot(1, 'wrong', OWNER, '/other/project'),
    };
    expect(() => h.transport.accept(wrong)).toThrow('Project VFS snapshot root mismatch');
    await Promise.resolve();
    expect(rejected).toBe(true);
  });

  it.each([
    { name: 'same owner', frame: snapshot(2, 'duplicate') },
    { name: 'foreign owner', frame: snapshot(2, 'foreign', 'retired-owner') },
  ])('fatally disconnects a duplicate initial snapshot from $name', async ({ frame }) => {
    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;

    expect(() => h.acceptSnapshot(frame)).toThrow(VfsCommitProtocolError);
    expect(content.files.snapshot().entries).toEqual([]);
    await expect(content.files.readFile('/src/main.ts')).rejects.toBeInstanceOf(
      ProjectFileOperationError,
    );
  });

  it.each([
    {
      name: 'skipped prior revision',
      fromTreeRevision: 0,
      frame: snapshot(2),
    },
    {
      name: 'foreign owner',
      fromTreeRevision: 1,
      frame: snapshot(2, 'foreign', 'retired-owner'),
    },
    {
      name: 'foreign root',
      fromTreeRevision: 1,
      frame: snapshot(2, 'foreign', OWNER, '/other/project'),
    },
    {
      name: 'final revision below prior revision',
      fromTreeRevision: 2,
      frame: snapshot(1),
    },
  ])(
    'fatally disconnects an invalid owner state with $name',
    async ({ frame, fromTreeRevision }) => {
      const h = harness();
      h.acceptSnapshot();
      const content = await h.transport.ready;

      expect(() => h.acceptState(frame, fromTreeRevision)).toThrow(VfsCommitProtocolError);
      expect(content.files.snapshot().entries).toEqual([]);
      await expect(content.files.readFile('/src/main.ts')).rejects.toBeInstanceOf(
        ProjectFileOperationError,
      );
    },
  );

  // Fault class: corrupt-input. A malformed state uses the same fatal fence as
  // a well-shaped but out-of-order state; the page never preserves a live mirror.
  it('fatally disconnects a malformed owner state before applying it', async () => {
    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;
    const malformed = {
      type: 'workbench:project-vfs-state',
      fromTreeRevision: 1,
      mutations: [
        {
          kind: 'remove',
          treeRevision: 2,
          path: `${ROOT}/src/main.ts`,
          recursive: 'yes',
        },
      ],
      frame: snapshot(2),
    } as unknown as OwnerProjectVfsFrame;

    expect(() => h.transport.accept(malformed)).toThrow(VfsCommitProtocolError);
    expect(content.files.snapshot().entries).toEqual([]);
    await expect(content.files.readFile('/src/main.ts')).rejects.toBeInstanceOf(
      ProjectFileOperationError,
    );
  });

  it('turns an owner fatal frame into a reset fence and transport disconnect', async () => {
    const h = harness();
    h.acceptSnapshot();
    const content = await h.transport.ready;
    const opening = content.documents.open('/src/main.ts');
    h.transport.accept({
      type: 'workbench:project-vfs-read-file-result',
      requestId: 'transport-1',
      ok: true,
      ownerEpoch: OWNER,
      treeRevision: 1,
      entry: {
        path: `${ROOT}/src/main.ts`,
        kind: 'file',
        size: 7,
        content: encoder.encode('initial'),
        version: 'file-v1',
      },
    });
    const document = await opening;

    h.transport.accept({
      type: 'workbench:project-vfs-fatal',
      error: { name: 'OwnerStateError', message: 'state delivery failed' },
    });

    expect(document.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });
    expect(content.files.snapshot().entries).toEqual([]);
    await expect(content.files.readFile('/src/main.ts')).rejects.toBeInstanceOf(
      ProjectFileOperationError,
    );
  });
});
