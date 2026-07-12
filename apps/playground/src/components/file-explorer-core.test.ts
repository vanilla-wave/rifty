import { describe, expect, it, vi } from 'vitest';
import type { UploadWriteEntry } from '../glue/file-manager-dnd.ts';
import {
  DRAG_PATHS_MIME,
  type ExplorerRowCaps,
  UPLOAD_BATCH,
  type UploadSource,
  canOpenContextMenu,
  clampMenuPosition,
  contextMenuItems,
  dropTargetForRow,
  ensureMovablePaths,
  explorerPathText,
  isCutSource,
  parseDragPayload,
  pathsForRowAction,
  planCompareSelected,
  planDropReaction,
  planEditSubmit,
  rowActivation,
  rowKeyIntent,
  runClipboardActions,
  runUploadPlan,
} from './file-explorer-core.ts';

const MUTABLE = { mutable: true, downloadable: false };
const READ_ONLY = { mutable: false, downloadable: false };
const key = (k: string, mod = false) => ({ key: k, metaKey: mod, ctrlKey: false });

function caps(over: Partial<ExplorerRowCaps> = {}): ExplorerRowCaps {
  return {
    kind: 'file',
    mutable: false,
    downloadable: false,
    comparable: false,
    headComparable: false,
    ...over,
  };
}

function recordingMutations() {
  const calls: { readonly op: string; readonly args: unknown }[] = [];
  return {
    calls,
    renameMany: (entries: readonly { readonly from: string; readonly to: string }[]) => {
      calls.push({ op: 'renameMany', args: entries });
      return Promise.resolve();
    },
    copyTree: (from: string, to: string) => {
      calls.push({ op: 'copyTree', args: [from, to] });
      return Promise.resolve();
    },
  };
}

function srcFile(name: string, bytes: readonly number[]): UploadSource {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return { name, arrayBuffer: () => Promise.resolve(buffer) };
}

describe('FileExplorer keyboard intents', () => {
  it('F2 renames and Delete/Backspace delete — mutable rows only', () => {
    expect(rowKeyIntent(key('F2'), MUTABLE)).toEqual({ intent: 'rename', stopPropagation: false });
    expect(rowKeyIntent(key('Delete'), MUTABLE)?.intent).toBe('delete');
    expect(rowKeyIntent(key('Backspace'), MUTABLE)?.intent).toBe('delete');
    expect(rowKeyIntent(key('F2'), READ_ONLY)).toBeNull();
    expect(rowKeyIntent(key('Delete'), READ_ONLY)).toBeNull();
  });

  it('mod+C/X/V route clipboard ops on mutable rows and stop propagation into editor shortcuts', () => {
    expect(rowKeyIntent(key('c', true), MUTABLE)).toEqual({
      intent: 'copy',
      stopPropagation: true,
    });
    expect(rowKeyIntent(key('x', true), MUTABLE)?.intent).toBe('cut');
    expect(rowKeyIntent(key('v', true), MUTABLE)?.intent).toBe('paste');
    expect(rowKeyIntent({ key: 'C', metaKey: false, ctrlKey: true }, MUTABLE)?.intent).toBe('copy');
    expect(rowKeyIntent(key('c', false), MUTABLE)).toBeNull(); // no modifier = typing
    expect(rowKeyIntent(key('c', true), READ_ONLY)).toBeNull();
  });

  it('mod+S downloads — only rows with a download affordance', () => {
    const downloadable = { mutable: false, downloadable: true };
    expect(rowKeyIntent(key('s', true), downloadable)).toEqual({
      intent: 'download',
      stopPropagation: true,
    });
    expect(rowKeyIntent(key('s', true), MUTABLE)).toBeNull();
    expect(rowKeyIntent(key('s', false), downloadable)).toBeNull();
  });

  it('Enter/Space activate any row: dirs toggle, files open, synthetic rows do nothing', () => {
    expect(rowKeyIntent(key('Enter'), READ_ONLY)?.intent).toBe('activate');
    expect(rowKeyIntent(key(' '), MUTABLE)?.intent).toBe('activate');
    expect(rowKeyIntent(key('a'), MUTABLE)).toBeNull();
    expect(rowActivation('dir')).toBe('toggle-dir');
    expect(rowActivation('file')).toBe('open-file');
    expect(rowActivation('loading')).toBeNull();
    expect(rowActivation('error')).toBeNull();
  });
});

describe('FileExplorer context menu composition', () => {
  it('mutable dir menu offers creation, clipboard, rename and delete as first-class items (VS Code parity)', () => {
    const items = contextMenuItems(caps({ kind: 'dir', mutable: true }));
    expect(items.map((item) => item.id)).toEqual([
      'new-file',
      'new-folder',
      'copy',
      'cut',
      'paste',
      'duplicate',
      'rename',
      'delete',
      'copy-path',
      'copy-relative-path',
    ]);
    expect(items.map((item) => item.label)).toContain('New Folder');
    expect(items.find((item) => item.id === 'rename')?.label).toBe('Rename');
    expect(items.find((item) => item.id === 'delete')?.label).toBe('Delete');
  });

  it('mutable file menu omits folder creation but keeps duplicate', () => {
    const ids = contextMenuItems(caps({ mutable: true })).map((item) => item.id);
    expect(ids).not.toContain('new-file');
    expect(ids).not.toContain('new-folder');
    expect(ids).toContain('duplicate');
  });

  it('download-only rows get no clipboard mutation items at all — not grayed ones', () => {
    const items = contextMenuItems(caps({ downloadable: true }));
    expect(items.map((item) => item.id)).toEqual(['copy-path', 'copy-relative-path', 'download']);
    expect(items.find((item) => item.id === 'download')?.icon).toBe('file-arrow-down');
  });

  it('paste stays visible while the clipboard is empty, gated by the empty-clipboard rule', () => {
    const items = contextMenuItems(caps({ mutable: true }));
    expect(items.find((item) => item.id === 'paste')?.disabled).toBe('busy-or-empty-clipboard');
    expect(items.find((item) => item.id === 'copy')?.disabled).toBe('busy');
    expect(items.find((item) => item.id === 'copy-path')?.disabled).toBe('never');
  });

  it('compare items appear per capability; Compare Selected needs exactly two files', () => {
    const items = contextMenuItems(caps({ comparable: true, headComparable: true }));
    expect(items.map((item) => item.id)).toEqual([
      'copy-path',
      'copy-relative-path',
      'compare-selected',
      'compare-head',
    ]);
    expect(items.find((item) => item.id === 'compare-selected')?.disabled).toBe(
      'not-two-comparable',
    );
    expect(items.find((item) => item.id === 'compare-head')?.label).toBe('Compare with HEAD');
    expect(planCompareSelected(['/a', '/b'])).toEqual({ kind: 'compare', left: '/a', right: '/b' });
    expect(planCompareSelected(['/a'])).toEqual({
      kind: 'error',
      message: 'Select exactly two files to compare',
    });
  });

  it('rows with no affordances open no menu', () => {
    expect(canOpenContextMenu(caps())).toBe(false);
    expect(canOpenContextMenu(caps({ mutable: true }))).toBe(true);
    expect(canOpenContextMenu(caps({ downloadable: true }))).toBe(true);
    expect(canOpenContextMenu(caps({ headComparable: true }))).toBe(true);
  });
});

describe('FileExplorer context menu viewport clamp', () => {
  const viewport = { viewportWidth: 1280, viewportHeight: 720 };

  it.each([
    ['keeps an inside anchor', { x: 100, y: 100 }, { x: 100, y: 100 }],
    ['clamps the bottom edge', { x: 100, y: 700 }, { x: 100, y: 476 }],
    ['clamps the right edge', { x: 1270, y: 100 }, { x: 1108, y: 100 }],
    ['clamps both far edges', { x: 1270, y: 700 }, { x: 1108, y: 476 }],
    ['clamps negative anchors', { x: -20, y: -30 }, { x: 4, y: 4 }],
  ])('%s', (_name, anchor, expected) => {
    expect(clampMenuPosition({ ...anchor, menuWidth: 168, menuHeight: 240, ...viewport })).toEqual(
      expected,
    );
  });

  it('pins an oversized menu to the top-left margin', () => {
    expect(
      clampMenuPosition({ x: 50, y: 50, menuWidth: 2000, menuHeight: 2000, ...viewport }),
    ).toEqual({ x: 4, y: 4 });
  });
});

describe('FileExplorer edit-submit planning', () => {
  const renameState = {
    kind: 'rename',
    path: '/ws/a.ts',
    parent: '/ws',
    depth: 0,
    name: 'a.ts',
    rowKind: 'file',
  } as const;

  it('captures active-file reopen in the plan, before the async rename closes the old model', () => {
    expect(planEditSubmit(renameState, 'b.ts', '/ws/a.ts')).toEqual({
      kind: 'rename',
      from: '/ws/a.ts',
      to: '/ws/b.ts',
      reopenActive: true,
    });
    expect(planEditSubmit(renameState, 'b.ts', '/ws/other.ts')).toMatchObject({
      reopenActive: false,
    });
    expect(planEditSubmit({ ...renameState, rowKind: 'dir' }, 'b', '/ws/a.ts')).toMatchObject({
      reopenActive: false,
    });
  });

  it('creates resolve the trimmed typed name under the edit parent', () => {
    expect(
      planEditSubmit({ kind: 'create-file', parent: '/ws/src', depth: 1 }, ' notes.md ', undefined),
    ).toEqual({ kind: 'create-file', path: '/ws/src/notes.md' });
    expect(
      planEditSubmit({ kind: 'create-dir', parent: '/ws', depth: 0 }, 'lib', undefined),
    ).toEqual({ kind: 'create-dir', path: '/ws/lib' });
  });

  it('rejects empty and slash-containing names loudly', () => {
    expect(() => planEditSubmit(renameState, '   ', undefined)).toThrow('Name cannot be empty');
    expect(() => planEditSubmit(renameState, 'a/b', undefined)).toThrow('Name cannot contain "/"');
  });
});

describe('FileExplorer owner mutation routing', () => {
  it('cut pastes coalesce into ONE renameMany frame; copy pastes replay copyTree per action', async () => {
    const cut = recordingMutations();
    await runClipboardActions(cut, 'cut', [
      { from: '/ws/a', to: '/ws/dst/a' },
      { from: '/ws/b', to: '/ws/dst/b' },
    ]);
    expect(cut.calls).toEqual([
      {
        op: 'renameMany',
        args: [
          { from: '/ws/a', to: '/ws/dst/a' },
          { from: '/ws/b', to: '/ws/dst/b' },
        ],
      },
    ]);

    const copy = recordingMutations();
    await runClipboardActions(copy, 'copy', [
      { from: '/ws/a', to: '/ws/dst/a' },
      { from: '/ws/b', to: '/ws/dst/b' },
    ]);
    expect(copy.calls).toEqual([
      { op: 'copyTree', args: ['/ws/a', '/ws/dst/a'] },
      { op: 'copyTree', args: ['/ws/b', '/ws/dst/b'] },
    ]);
  });

  it('cut marks its sources for the data-cut affordance; copy does not', () => {
    expect(isCutSource({ paths: ['/ws/a'], mode: 'cut' }, '/ws/a')).toBe(true);
    expect(isCutSource({ paths: ['/ws/a'], mode: 'cut' }, '/ws/b')).toBe(false);
    expect(isCutSource({ paths: ['/ws/a'], mode: 'copy' }, '/ws/a')).toBe(false);
    expect(isCutSource(null, '/ws/a')).toBe(false);
  });

  it('row actions apply to the mutable multi-selection only when the row is part of it', () => {
    const mutable = ['/ws/a', '/ws/b'];
    expect(pathsForRowAction('/ws/c', new Set(['/ws/a']), mutable)).toEqual(['/ws/c']);
    expect(pathsForRowAction('/ws/a', new Set(['/ws/a', '/ws/b', '/ws/nm']), mutable)).toEqual([
      '/ws/a',
      '/ws/b',
    ]);
  });
});

describe('FileExplorer drag-move and OS upload', () => {
  it('drag payloads round-trip through the rifty MIME; foreign JSON yields nothing; empty falls back to drag state', () => {
    expect(DRAG_PATHS_MIME).toBe('application/x-rifty-paths');
    expect(parseDragPayload(JSON.stringify(['/ws/a', '/ws/b']), [])).toEqual(['/ws/a', '/ws/b']);
    expect(parseDragPayload('{"not":"paths"}', ['/fallback'])).toEqual([]);
    expect(parseDragPayload('][', ['/fallback'])).toEqual(['/fallback']);
    expect(parseDragPayload(undefined, ['/fallback'])).toEqual(['/fallback']);
    expect(parseDragPayload('', ['/fallback'])).toEqual(['/fallback']);
  });

  it('drops reject non-mutable targets and folder drops loudly; OS files upload; internal drags move', () => {
    expect(
      planDropReaction({
        rowName: 'node_modules',
        rowMutable: false,
        hasDirectory: false,
        fileCount: 0,
      }),
    ).toEqual({ kind: 'reject', message: 'Cannot drop on node_modules' });
    expect(
      planDropReaction({ rowName: null, rowMutable: true, hasDirectory: true, fileCount: 2 }),
    ).toEqual({ kind: 'reject', message: 'Folder drops are unsupported; drop files instead' });
    expect(
      planDropReaction({ rowName: 'src', rowMutable: true, hasDirectory: false, fileCount: 2 }),
    ).toEqual({ kind: 'upload' });
    expect(
      planDropReaction({ rowName: null, rowMutable: true, hasDirectory: false, fileCount: 0 }),
    ).toEqual({ kind: 'move' });
  });

  it('drop destination: dirs receive directly, files target their parent, synthetic rows and background the root', () => {
    expect(dropTargetForRow({ kind: 'dir', path: '/ws/src' }, '/ws')).toBe('/ws/src');
    expect(dropTargetForRow({ kind: 'file', path: '/ws/src/a.ts' }, '/ws')).toBe('/ws/src');
    expect(dropTargetForRow({ kind: 'loading', path: '/ws/nm#loading' }, '/ws')).toBe('/ws');
    expect(dropTargetForRow(undefined, '/ws')).toBe('/ws');
  });

  it('refuses drag-moves touching any non-mutable path', () => {
    const mutable = new Set(['/ws/a', '/ws/b']);
    expect(() => ensureMovablePaths(['/ws/a', '/ws/b'], mutable)).not.toThrow();
    expect(() => ensureMovablePaths(['/ws/a', '/ws/node_modules/x'], mutable)).toThrow(
      'cannot move non-mutable path "/ws/node_modules/x"',
    );
  });

  it('uploads write recursive entries through coalesced owner frames under the batch caps', async () => {
    const written: UploadWriteEntry[][] = [];
    await runUploadPlan({
      files: [srcFile('a.txt', [1]), srcFile('b.txt', [2, 2]), srcFile('c.txt', [3])],
      plan: [
        { name: 'a.txt', to: '/ws/a.txt' },
        { name: 'b.txt', to: '/ws/b.txt' },
        { name: 'c.txt', to: '/ws/c.txt' },
      ],
      startRoot: '/ws',
      currentRoot: () => '/ws',
      batch: { maxFiles: 2, maxBytes: 1024 },
      writeFiles: (entries) => {
        written.push([...entries]);
        return Promise.resolve();
      },
    });
    expect(written.map((batch) => batch.map((entry) => entry.path))).toEqual([
      ['/ws/a.txt', '/ws/b.txt'],
      ['/ws/c.txt'],
    ]);
    expect(written[0]?.[1]).toMatchObject({ recursive: true });
    expect([...(written[0]?.[1]?.data ?? [])]).toEqual([2, 2]);
  });

  it('aborts when the workspace root changes mid-read — nothing writes into the new root', async () => {
    let root = '/ws';
    const writeFiles = vi.fn(() => Promise.resolve());
    await expect(
      runUploadPlan({
        files: [
          {
            name: 'a.txt',
            arrayBuffer: () => {
              root = '/other';
              return Promise.resolve(new ArrayBuffer(1));
            },
          },
        ],
        plan: [{ name: 'a.txt', to: '/ws/a.txt' }],
        startRoot: '/ws',
        currentRoot: () => root,
        batch: UPLOAD_BATCH,
        writeFiles,
      }),
    ).rejects.toThrow('workspace root changed during upload');
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it('aborts between batches when the root changes — later batches never write', async () => {
    let root = '/ws';
    const written: string[][] = [];
    await expect(
      runUploadPlan({
        files: [srcFile('a', [1]), srcFile('b', [2])],
        plan: [
          { name: 'a', to: '/ws/a' },
          { name: 'b', to: '/ws/b' },
        ],
        startRoot: '/ws',
        currentRoot: () => root,
        batch: { maxFiles: 1, maxBytes: 1024 },
        writeFiles: (entries) => {
          written.push(entries.map((entry) => entry.path));
          root = '/other';
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('workspace root changed during upload');
    expect(written).toEqual([['/ws/a']]);
  });

  it('owner write frames stay bounded at 32 files / 4 MiB', () => {
    expect(UPLOAD_BATCH).toEqual({ maxFiles: 32, maxBytes: 4 * 1024 * 1024 });
  });
});

describe('FileExplorer copy path', () => {
  it('Copy Relative Path strips the workspace root; foreign paths stay absolute', () => {
    expect(explorerPathText('/ws/src/a.ts', '/ws', true)).toBe('src/a.ts');
    expect(explorerPathText('/other/a.ts', '/ws', true)).toBe('/other/a.ts');
    expect(explorerPathText('/ws/src/a.ts', '/ws', false)).toBe('/ws/src/a.ts');
  });
});
