import { describe, expect, it } from 'vitest';
import type { VfsSnapshotFrame } from '../project-vfs-contract.ts';
import { SnapshotFs } from './snapshot-fs.ts';

const enc = new TextEncoder();

const FRAME: VfsSnapshotFrame = {
  type: 'snapshot',
  root: '/workspace',
  ownerEpoch: 'owner-a',
  treeRevision: 1,
  nodeModulesPresent: true,
  entries: [
    { path: '/workspace/src', kind: 'dir', size: 0, version: 'src-v1' },
    {
      path: '/workspace/src/main.js',
      kind: 'file',
      size: 14,
      version: 'main-v1',
      content: enc.encode('console.log(1)'),
    },
    {
      path: '/workspace/index.html',
      kind: 'file',
      size: 6,
      version: 'index-v1',
      content: enc.encode('<html>'),
    },
    {
      path: '/workspace/big.bin',
      kind: 'file',
      size: 9_000_000,
      version: 'big-v1',
      contentOmitted: 'size-cap',
    },
  ],
};

function stateFrame(ownerEpoch: string, treeRevision: number, text: string): VfsSnapshotFrame {
  return {
    type: 'snapshot',
    root: '/workspace',
    ownerEpoch,
    treeRevision,
    nodeModulesPresent: false,
    entries: [
      {
        path: '/workspace/state.txt',
        kind: 'file',
        size: enc.encode(text).byteLength,
        version: `${ownerEpoch}:v${treeRevision}`,
        content: enc.encode(text),
      },
    ],
  };
}

function boundSnapshotFs(ownerEpoch = 'owner-a'): SnapshotFs {
  const fs = new SnapshotFs('/workspace');
  fs.bindOwner(ownerEpoch);
  return fs;
}

describe('SnapshotFs', () => {
  it('advertises the snapshot view as read-only', () => {
    const fs = new SnapshotFs('/workspace');

    expect(fs.readOnly).toBe(true);
  });

  it('requires an explicit initial owner bind before accepting wire frames', () => {
    const fs = new SnapshotFs('/workspace');

    fs.update(FRAME);
    expect(fs.readdirSync('/workspace')).toEqual([]);

    fs.bindOwner('owner-a');
    fs.update(FRAME);
    expect(fs.existsSync('/workspace/src/main.js')).toBe(true);
  });

  it('renders the worker tree: exists / readdir (dirs first) / read / stat', () => {
    const fs = boundSnapshotFs();
    fs.update(FRAME);

    expect(fs.existsSync('/workspace/src/main.js')).toBe(true);
    expect(fs.existsSync('/workspace/missing')).toBe(false);

    const top = fs.readdirSync('/workspace').map((d) => `${d.isDirectory ? 'D' : 'F'} ${d.name}`);
    expect(top).toEqual(['D src', 'F big.bin', 'F index.html']);

    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/src/main.js'))).toBe(
      'console.log(1)',
    );
    expect(fs.statSync('/workspace/src').isDirectory).toBe(true);
    expect(fs.statSync('/workspace/index.html').size).toBe(6);
    expect(fs.nodeModulesPresent).toBe(true);
    expect(fs.readOnly).toBe(true);
  });

  it('throws (no silent stub) on any mutation', () => {
    const fs = boundSnapshotFs();
    fs.update(FRAME);
    expect(() => fs.writeFileSync('/workspace/x.js', enc.encode('y'))).toThrow(/read-only/);
    expect(() => fs.mkdirSync('/workspace/d', { recursive: true })).toThrow(/read-only/);
    expect(() => fs.rmSync('/workspace/index.html', { force: true })).toThrow(/read-only/);
  });

  it('reports a clear error for content-less (too-large) files', () => {
    const fs = boundSnapshotFs();
    fs.update(FRAME);
    expect(() => fs.readFileBytesSync('/workspace/big.bin')).toThrow(/too large/);
  });

  it('clear() empties and fences the view until an explicit owner rebind', () => {
    const fs = boundSnapshotFs();
    fs.update(FRAME);
    fs.clear();
    expect(fs.readdirSync('/workspace')).toEqual([]);
    expect(fs.existsSync('/workspace/src/main.js')).toBe(false);
    expect(fs.nodeModulesPresent).toBe(false);

    fs.update({ ...FRAME, treeRevision: 2 });
    expect(fs.readdirSync('/workspace')).toEqual([]);

    fs.bindOwner('owner-b');
    fs.update(stateFrame('owner-b', 1, 'rebound'));
    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('rebound');
  });

  it('notifies subscribers on every applied frame (the seeded-file retry event)', () => {
    const fs = boundSnapshotFs();
    const seen: boolean[] = [];
    // The seeded file is absent until the next frame lands (the publish race);
    // the subscriber retries on notify and finds it readable — no polling.
    const unsubscribe = fs.subscribe(() => seen.push(fs.existsSync('/workspace/src/seeded.js')));
    fs.update(FRAME);
    expect(seen).toEqual([false]); // first frame: still absent

    fs.update({
      ...FRAME,
      treeRevision: 2,
      entries: [
        ...FRAME.entries,
        {
          path: '/workspace/src/seeded.js',
          kind: 'file',
          size: 2,
          version: 'seeded-v1',
          content: enc.encode('ok'),
        },
      ],
    });
    expect(seen).toEqual([false, true]); // owner publish reflected the seed

    unsubscribe();
    fs.update(FRAME);
    expect(seen).toEqual([false, true]); // no further notifications after unsubscribe
  });

  it('a later frame fully replaces the previous tree', () => {
    const fs = boundSnapshotFs();
    fs.update(FRAME);
    fs.update({
      type: 'snapshot',
      root: '/workspace',
      ownerEpoch: 'owner-a',
      treeRevision: 3,
      nodeModulesPresent: false,
      entries: [
        {
          path: '/workspace/only.txt',
          kind: 'file',
          size: 2,
          version: 'only-v1',
          content: enc.encode('hi'),
        },
      ],
    });
    expect(fs.existsSync('/workspace/src/main.js')).toBe(false);
    expect(fs.readdirSync('/workspace').map((d) => d.name)).toEqual(['only.txt']);
  });

  it('publishes owner revision only after applying exact per-path versions', () => {
    const fs = boundSnapshotFs();
    const revisions: Array<{ ownerEpoch: string; treeRevision: number }> = [];
    const unsubscribe = fs.subscribeRevisions((frame) => {
      revisions.push({ ownerEpoch: frame.ownerEpoch, treeRevision: frame.treeRevision });
      expect(fs.entries().find((entry) => entry.path === '/workspace/src/main.js')?.version).toBe(
        'main-v1',
      );
    });

    fs.update(FRAME);

    expect(revisions).toEqual([{ ownerEpoch: 'owner-a', treeRevision: 1 }]);
    unsubscribe();
  });

  it.each([1, 2])(
    'rejects an ambiguous content omission at revision %s before replacing or certifying it',
    (treeRevision) => {
      const fs = boundSnapshotFs();
      const revisions: number[] = [];
      fs.subscribeRevisions((frame) => revisions.push(frame.treeRevision));
      fs.update(stateFrame('owner-a', 1, 'stable'));

      expect(() =>
        fs.update({
          type: 'snapshot',
          root: '/workspace',
          ownerEpoch: 'owner-a',
          treeRevision,
          nodeModulesPresent: true,
          entries: [
            {
              path: '/workspace/unreadable.txt',
              kind: 'file',
              size: 1,
              version: 'unreadable-v1',
            },
          ],
        }),
      ).toThrow(/content omission/);

      expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('stable');
      expect(fs.nodeModulesPresent).toBe(false);
      expect(revisions).toEqual([1]);
    },
  );

  it.each([
    {
      name: 'empty version',
      treeRevision: 1,
      entries: [
        {
          path: '/workspace/bad.txt',
          kind: 'file' as const,
          size: 3,
          version: '',
          content: enc.encode('bad'),
        },
      ],
    },
    {
      name: 'non-canonical path',
      treeRevision: 2,
      entries: [
        {
          path: '/workspace/dir/../bad.txt',
          kind: 'file' as const,
          size: 3,
          version: 'bad-v1',
          content: enc.encode('bad'),
        },
      ],
    },
    {
      name: 'path outside the bound root',
      treeRevision: 1,
      entries: [
        {
          path: '/outside.txt',
          kind: 'file' as const,
          size: 3,
          version: 'bad-v1',
          content: enc.encode('bad'),
        },
      ],
    },
    {
      name: 'duplicate path',
      treeRevision: 2,
      entries: [
        {
          path: '/workspace/bad.txt',
          kind: 'file' as const,
          size: 3,
          version: 'bad-v1',
          content: enc.encode('bad'),
        },
        {
          path: '/workspace/bad.txt',
          kind: 'file' as const,
          size: 5,
          version: 'bad-v2',
          content: enc.encode('worse'),
        },
      ],
    },
    {
      name: 'missing directory parent',
      treeRevision: 1,
      entries: [
        {
          path: '/workspace/missing/bad.txt',
          kind: 'file' as const,
          size: 3,
          version: 'bad-v1',
          content: enc.encode('bad'),
        },
      ],
    },
    {
      name: 'file parent',
      treeRevision: 2,
      entries: [
        {
          path: '/workspace/parent',
          kind: 'file' as const,
          size: 3,
          version: 'parent-v1',
          content: enc.encode('bad'),
        },
        {
          path: '/workspace/parent/child.txt',
          kind: 'file' as const,
          size: 3,
          version: 'child-v1',
          content: enc.encode('bad'),
        },
      ],
    },
  ])('rejects $name before replacing or certifying the frame', ({ treeRevision, entries }) => {
    const fs = boundSnapshotFs();
    const revisions: number[] = [];
    fs.subscribeRevisions((frame) => revisions.push(frame.treeRevision));
    fs.update(stateFrame('owner-a', 1, 'stable'));

    expect(() =>
      fs.update({
        type: 'snapshot',
        root: '/workspace',
        ownerEpoch: 'owner-a',
        treeRevision,
        nodeModulesPresent: true,
        entries,
      }),
    ).toThrow();

    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('stable');
    expect(fs.nodeModulesPresent).toBe(false);
    expect(revisions).toEqual([1]);
  });

  it('ignores a same-epoch revision rollback without replacing or notifying', () => {
    const fs = boundSnapshotFs();
    const revisions: number[] = [];
    fs.subscribeRevisions((frame) => revisions.push(frame.treeRevision));

    fs.update(stateFrame('owner-a', 10, 'new'));
    fs.update(stateFrame('owner-a', 9, 'old'));

    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('new');
    expect(fs.entries()[0]?.version).toBe('owner-a:v10');
    expect(revisions).toEqual([10]);
  });

  it('rejects a delayed prior-owner frame after an explicit owner rebind', () => {
    const fs = boundSnapshotFs();
    const revisions: string[] = [];
    fs.subscribeRevisions((frame) =>
      revisions.push(`${frame.ownerEpoch}:${String(frame.treeRevision)}`),
    );

    fs.update(stateFrame('owner-a', 10, 'owner-a'));
    fs.bindOwner('owner-b');
    fs.update(stateFrame('owner-b', 1, 'owner-b'));
    fs.update(stateFrame('owner-a', 11, 'delayed-owner-a'));

    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('owner-b');
    expect(fs.entries()[0]?.version).toBe('owner-b:v1');
    expect(revisions).toEqual(['owner-a:10', 'owner-b:1']);
  });

  it('ignores a same-owner frame for a root other than the explicit binding', () => {
    const fs = boundSnapshotFs();
    const revisions: number[] = [];
    fs.subscribeRevisions((frame) => revisions.push(frame.treeRevision));
    fs.update(stateFrame('owner-a', 1, 'bound-root'));

    fs.update({
      type: 'snapshot',
      root: '/other',
      ownerEpoch: 'owner-a',
      treeRevision: 2,
      nodeModulesPresent: false,
      entries: [
        {
          path: '/other/state.txt',
          kind: 'file',
          size: 10,
          version: 'owner-a:other',
          content: enc.encode('wrong-root'),
        },
      ],
    });

    expect(fs.root).toBe('/workspace');
    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe(
      'bound-root',
    );
    expect(revisions).toEqual([1]);
  });

  it('reflects an exact duplicate revision without replacing or re-notifying the view', () => {
    const fs = boundSnapshotFs();
    const snapshotNotifications: number[] = [];
    const revisionNotifications: number[] = [];
    fs.subscribe(() => snapshotNotifications.push(1));
    fs.subscribeRevisions((frame) => revisionNotifications.push(frame.treeRevision));
    const frame = stateFrame('owner-a', 10, 'stable');

    fs.update(frame);
    fs.update(frame);

    expect(snapshotNotifications).toEqual([1]);
    // A valid no-op owner commit may ACK at the existing revision. Its later
    // republish is the coordinator's post-send reflection event.
    expect(revisionNotifications).toEqual([10, 10]);
  });

  it.each(['bytes', 'version', 'nodeModulesPresent'] as const)(
    'rejects same-revision %s divergence without certifying it',
    (divergence) => {
      const fs = boundSnapshotFs();
      const revisions: number[] = [];
      fs.subscribeRevisions((frame) => revisions.push(frame.treeRevision));
      const stable = stateFrame('owner-a', 10, 'stable');
      fs.update(stable);

      const divergent: VfsSnapshotFrame =
        divergence === 'bytes'
          ? stateFrame('owner-a', 10, 'changed')
          : divergence === 'version'
            ? {
                ...stable,
                entries: stable.entries.map((entry) => ({
                  ...entry,
                  version: 'owner-a:other-version',
                })),
              }
            : { ...stable, nodeModulesPresent: true };

      expect(() => fs.update(divergent)).toThrow(/revision 10 changed content/);
      expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('stable');
      expect(fs.nodeModulesPresent).toBe(false);
      expect(revisions).toEqual([10]);
    },
  );

  it('isolates listener failures while preserving apply then snapshot then revision order', () => {
    const fs = boundSnapshotFs();
    const order: string[] = [];
    fs.subscribe(() => {
      order.push(
        `snapshot:${new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))}`,
      );
      throw new Error('broken snapshot listener');
    });
    fs.subscribe(() => order.push('snapshot-sibling'));
    fs.subscribeRevisions((frame) => order.push(`revision:${String(frame.treeRevision)}`));

    expect(() => fs.update(stateFrame('owner-a', 4, 'applied'))).toThrow(
      'broken snapshot listener',
    );
    expect(order).toEqual(['snapshot:applied', 'snapshot-sibling', 'revision:4']);
  });

  it('owns snapshot bytes across ingress, read, and entries aliases', () => {
    const fs = boundSnapshotFs();
    const sourceBytes = enc.encode('owner');
    const sourceEntry = {
      path: '/workspace/state.txt',
      kind: 'file' as const,
      size: sourceBytes.byteLength,
      version: 'owner-a:v1',
      content: sourceBytes,
    };
    fs.update({
      type: 'snapshot',
      root: '/workspace',
      ownerEpoch: 'owner-a',
      treeRevision: 1,
      nodeModulesPresent: false,
      entries: [sourceEntry],
    });

    sourceBytes[0] = 'X'.charCodeAt(0);
    sourceEntry.version = 'tampered-ingress';
    const readAlias = fs.readFileBytesSync('/workspace/state.txt');
    readAlias[1] = 'X'.charCodeAt(0);
    const entriesAlias = fs.entries()[0];
    if (!entriesAlias?.content) throw new Error('expected inline snapshot content');
    entriesAlias.content[2] = 'X'.charCodeAt(0);
    (entriesAlias as { version: string }).version = 'tampered-egress';
    const directoryAlias = fs.readdirSync('/workspace') as Array<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
    }>;
    const directoryEntryAlias = directoryAlias[0];
    if (!directoryEntryAlias) throw new Error('expected snapshot directory entry');
    directoryEntryAlias.name = 'tampered-name';
    directoryAlias.splice(0, 1);

    expect(new TextDecoder().decode(fs.readFileBytesSync('/workspace/state.txt'))).toBe('owner');
    expect(fs.entries()[0]?.version).toBe('owner-a:v1');
    expect(fs.readdirSync('/workspace').map((entry) => entry.name)).toEqual(['state.txt']);
  });
});
