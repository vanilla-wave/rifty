import { describe, expect, it } from 'vitest';
import { SnapshotFs } from './snapshot-fs.ts';
import type { VfsSnapshotFrame } from './vfs-snapshot-port.ts';

const enc = new TextEncoder();

const FRAME: VfsSnapshotFrame = {
  type: 'snapshot',
  root: '/workspace',
  nodeModulesPresent: true,
  entries: [
    { path: '/workspace/src', kind: 'dir', size: 0 },
    {
      path: '/workspace/src/main.js',
      kind: 'file',
      size: 14,
      content: enc.encode('console.log(1)'),
    },
    { path: '/workspace/index.html', kind: 'file', size: 6, content: enc.encode('<html>') },
    { path: '/workspace/big.bin', kind: 'file', size: 9_000_000 }, // no content (over cap at source)
  ],
};

describe('SnapshotFs', () => {
  it('renders the worker tree: exists / readdir (dirs first) / read / stat', () => {
    const fs = new SnapshotFs('/workspace');
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
    const fs = new SnapshotFs('/workspace');
    fs.update(FRAME);
    expect(() => fs.writeFileSync('/workspace/x.js', enc.encode('y'))).toThrow(/read-only/);
    expect(() => fs.mkdirSync('/workspace/d', { recursive: true })).toThrow(/read-only/);
    expect(() => fs.rmSync('/workspace/index.html', { force: true })).toThrow(/read-only/);
  });

  it('reports a clear error for content-less (too-large) files', () => {
    const fs = new SnapshotFs('/workspace');
    fs.update(FRAME);
    expect(() => fs.readFileBytesSync('/workspace/big.bin')).toThrow(/too large/);
  });

  it('clear() empties the view but keeps the root browsable', () => {
    const fs = new SnapshotFs('/workspace');
    fs.update(FRAME);
    fs.clear();
    expect(fs.readdirSync('/workspace')).toEqual([]);
    expect(fs.existsSync('/workspace/src/main.js')).toBe(false);
    expect(fs.nodeModulesPresent).toBe(false);
  });

  it('notifies subscribers on every applied frame (the seeded-file retry event)', () => {
    const fs = new SnapshotFs('/workspace');
    const seen: boolean[] = [];
    // The seeded file is absent until the next frame lands (the publish race);
    // the subscriber retries on notify and finds it readable — no polling.
    const unsubscribe = fs.subscribe(() => seen.push(fs.existsSync('/workspace/src/seeded.js')));
    fs.update(FRAME);
    expect(seen).toEqual([false]); // first frame: still absent

    fs.update({
      ...FRAME,
      entries: [
        ...FRAME.entries,
        { path: '/workspace/src/seeded.js', kind: 'file', size: 2, content: enc.encode('ok') },
      ],
    });
    expect(seen).toEqual([false, true]); // owner publish reflected the seed

    unsubscribe();
    fs.update(FRAME);
    expect(seen).toEqual([false, true]); // no further notifications after unsubscribe
  });

  it('a later frame fully replaces the previous tree', () => {
    const fs = new SnapshotFs('/workspace');
    fs.update(FRAME);
    fs.update({
      type: 'snapshot',
      root: '/workspace',
      nodeModulesPresent: false,
      entries: [{ path: '/workspace/only.txt', kind: 'file', size: 2, content: enc.encode('hi') }],
    });
    expect(fs.existsSync('/workspace/src/main.js')).toBe(false);
    expect(fs.readdirSync('/workspace').map((d) => d.name)).toEqual(['only.txt']);
  });
});
