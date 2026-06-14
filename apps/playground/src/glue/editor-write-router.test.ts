/**
 * Editor write routing in real-vite (dev-server) mode — regression for the
 * read-only-snapshot write throw (ADR-0076 §Decision-4, corrected from view-only).
 *
 * Bug: a preset tab opened while the dev server was stopped (writable page
 * mirror) kept a write path; once Vite booted, the editor's READ view flipped
 * to the read-only `SnapshotFs`, so the flushed write hit
 * `SnapshotFs.writeFileSync` and threw `"…is read-only — it lives in the Vite
 * worker realm"`. The fix splits the editor's READ view (snapshot in dev) from
 * its WRITE target (the always-writable page mirror); the host then propagates
 * the write to the worker over the write port (ADR-0043), so it is not a silent
 * fake. Real `syncMirror()` + real `SnapshotFs` — no mocks.
 */
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { SnapshotFs, type VfsSnapshotFrame } from '@riftydev/workbench';
import { beforeEach, describe, expect, it } from 'vitest';
import { isEditorPathWritable, writeEditorFile } from './editor-write-router.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SEEDED = '/workspace/src/project-summary.js';

beforeEach(() => {
  resetSyncMirror();
});

/** The read view the editor shows in real-vite mode: a read-only worker mirror
 *  holding `path` with `content`. */
function workerMirror(path: string, content: string): SnapshotFs {
  const fs = new SnapshotFs('/workspace');
  const frame: VfsSnapshotFrame = {
    type: 'snapshot',
    root: '/workspace',
    nodeModulesPresent: true,
    entries: [
      { path: '/workspace/src', kind: 'dir', size: 0 },
      { path, kind: 'file', size: content.length, content: enc.encode(content) },
    ],
  };
  fs.update(frame);
  return fs;
}

describe('editor write routing (real-vite dev-server mode)', () => {
  it('keeps a page-owned seeded file editable even though the read view is the read-only snapshot', () => {
    const writeVfs = syncMirror();
    writeEditorFile(writeVfs, SEEDED, 'export const a = 1;'); // page seeded it
    const readView = workerMirror(SEEDED, 'export const a = 1;'); // worker mirror (read-only)

    expect(readView.readOnly).toBe(true); // sanity: the read view is read-only
    expect(isEditorPathWritable(writeVfs, SEEDED)).toBe(true);
  });

  it('routes the flush to the writable page mirror, never the read-only snapshot (no throw)', () => {
    const writeVfs = syncMirror();
    writeEditorFile(writeVfs, SEEDED, 'old');
    const readView = workerMirror(SEEDED, 'old');

    // Editing the open tab while the dev server runs must NOT throw and must land
    // in the writable mirror (where syncWorkspaceFileToWorker reads it for the port).
    expect(() => writeEditorFile(writeVfs, SEEDED, 'edited')).not.toThrow();
    expect(dec.decode(writeVfs.readFileBytesSync(SEEDED))).toBe('edited');

    // The read-only snapshot is never the write target — writing to it is the
    // exact user-facing failure the routing prevents.
    expect(() => readView.writeFileSync(SEEDED, enc.encode('x'))).toThrow(
      /read-only — it lives in the Vite worker realm/,
    );
  });

  it('keeps a worker-only file (absent from the page mirror) read-only — ADR-0076 honesty for worker-owned files', () => {
    const writeVfs = syncMirror();
    // A worker-generated file: present in the snapshot view, absent from the page mirror.
    const readView = workerMirror('/workspace/dist/bundle.js', 'built');

    expect(readView.existsSync('/workspace/dist/bundle.js')).toBe(true);
    expect(isEditorPathWritable(writeVfs, '/workspace/dist/bundle.js')).toBe(false);
  });
});
