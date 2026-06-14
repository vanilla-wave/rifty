/**
 * Real-vite explorer VFS — the writable file-manager surface in dev mode
 * (ADR-0076). READS the read-only worker snapshot (so the tree reflects the
 * worker), WRITES the page mirror AND propagates each mutation to the worker
 * over the write port. Real `syncMirror()` + real `SnapshotFs` — no mocks.
 */
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { beforeEach, describe, expect, it } from 'vitest';
import { RealViteExplorerVfs } from './real-vite-explorer-vfs.ts';
import { SnapshotFs } from './snapshot-fs.ts';
import type { VfsSnapshotFrame } from './vfs-snapshot-port.ts';
import type { VfsWriteFrame } from './vfs-write-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

beforeEach(() => {
  resetSyncMirror();
});

function snapshotWith(entries: VfsSnapshotFrame['entries']): SnapshotFs {
  const fs = new SnapshotFs('/workspace');
  fs.update({ type: 'snapshot', root: '/workspace', nodeModulesPresent: false, entries });
  return fs;
}

describe('RealViteExplorerVfs', () => {
  it('is writable and reads from the snapshot view', () => {
    const snap = snapshotWith([
      { path: '/workspace/index.html', kind: 'file', size: 6, content: enc.encode('<html>') },
    ]);
    const fs = new RealViteExplorerVfs(snap, syncMirror(), () => {});

    expect(fs.readOnly).toBe(false);
    expect(fs.existsSync('/workspace/index.html')).toBe(true);
    expect(dec.decode(fs.readFileBytesSync('/workspace/index.html'))).toBe('<html>');
    expect(fs.readdirSync('/workspace').map((d) => d.name)).toEqual(['index.html']);
  });

  it('writeFileSync lands in the page mirror AND emits a write frame to the worker', () => {
    const frames: VfsWriteFrame[] = [];
    const mirror = syncMirror();
    const fs = new RealViteExplorerVfs(snapshotWith([]), mirror, (f) => frames.push(f));

    fs.mkdirSync('/workspace/src', { recursive: true });
    fs.writeFileSync('/workspace/src/new.js', enc.encode('ok'));

    expect(dec.decode(mirror.readFileBytesSync('/workspace/src/new.js'))).toBe('ok');
    expect(frames.map((f) => f.type)).toEqual(['mkdir', 'write']);
    const write = frames.find((f) => f.type === 'write');
    expect(write?.path).toBe('/workspace/src/new.js');
  });

  it('rmSync removes from the page mirror AND emits an rm frame to the worker', () => {
    const frames: VfsWriteFrame[] = [];
    const mirror = syncMirror();
    const fs = new RealViteExplorerVfs(snapshotWith([]), mirror, (f) => frames.push(f));

    fs.mkdirSync('/workspace/src', { recursive: true });
    fs.writeFileSync('/workspace/src/gone.js', enc.encode('x'));
    fs.rmSync('/workspace/src/gone.js', { recursive: false, force: true });

    expect(mirror.existsSync('/workspace/src/gone.js')).toBe(false);
    const rm = frames.find((f) => f.type === 'rm');
    expect(rm).toMatchObject({ type: 'rm', path: '/workspace/src/gone.js', force: true });
  });
});
