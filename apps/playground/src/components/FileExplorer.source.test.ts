import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./FileExplorer.tsx', import.meta.url)), 'utf8');

describe('FileExplorer owner-routed CRUD source guards', () => {
  it('exposes keyboard rename/delete affordances on mutable rows', () => {
    expect(source).toContain("e.key === 'F2'");
    expect(source).toContain("e.key === 'Delete'");
    expect(source).toContain('beginRename(row)');
    expect(source).toContain('void deleteRow(row)');
  });

  it('stops inline edit and action-button key events from bubbling into row handlers', () => {
    expect(source).toContain('e.stopPropagation();');
    expect(source).toContain('function stopButtonKeyPropagation(e: KeyboardEvent): void');
    expect(source).toContain('onKeyDown={stopButtonKeyPropagation}');
  });

  it('keeps node_modules rows out of owner mutation affordances', () => {
    expect(source).toContain('function canMutateRow(row: Row): row is MutableRow');
    expect(source).toContain('!isUnderNodeModules(row.path)');
    expect(source).toContain('canMutateRow(row)');
  });

  it('tracks active root changes instead of capturing the boot root forever', () => {
    expect(source).toContain('const [rootValue, setRootValue] = createSignal(props.root)');
    expect(source).toContain('rootNow = nextRoot');
    expect(source).not.toContain('const root = props.root;');
  });

  it('offers single-file download without a folder fake', () => {
    expect(source).toContain('onDownloadFile?(path: string): void;');
    expect(source).toContain('function canDownloadRow(row: Row)');
    expect(source).toContain("row.kind === 'file' && props.onDownloadFile !== undefined");
    expect(source).toContain("e.key.toLowerCase() === 's'");
    expect(source).toContain('downloadRow(row)');
    expect(source).toContain('onContextMenu={(e) => openContextMenu(e, row)}');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('file-arrow-down');
  });

  it('routes clipboard copy/cut/paste/duplicate through owner copy and rename mutations', () => {
    expect(source).toContain('planClipboardPaste(vfs, state, targetDir)');
    expect(source).toContain('await mutations.copyTree(action.from, action.to)');
    expect(source).toContain('await mutations.renamePath(action.from, action.to)');
    expect(source).toContain("setClipboard({ paths: selectedMutablePathsFor(row), mode: 'copy' })");
    expect(source).toContain("setClipboard({ paths: selectedMutablePathsFor(row), mode: 'cut' })");
    expect(source).toContain("if (key === 'c')");
    expect(source).toContain("if (key === 'x')");
    expect(source).toContain("if (key === 'v')");
    expect(source).toContain('Duplicate');
    expect(source).toContain('data-cut={cutSource(row.path)}');
    expect(source).toContain('setClipboard(null);');
  });

  it('omits clipboard mutation menu items entirely for download-only rows', () => {
    expect(source).toContain('<Show when={menu().mutable}>');
    expect(source).not.toContain('disabled={!menu().mutable || busy()}');
    expect(source).not.toContain('disabled={!menu().mutable || clipboard() === null || busy()}');
  });

  it('routes drag-move and OS file upload through coalesced owner frames', () => {
    expect(source).toContain("setData('application/x-rifty-paths'");
    expect(source).toContain('planDragMove(vfs, paths, targetDir)');
    expect(source).toContain('await mutations.renameMany(');
    expect(source).toContain('planUploadFiles(vfs, files, targetDir)');
    expect(source).toContain('new Uint8Array(await file.arrayBuffer())');
    expect(source).toContain(
      "if (root() !== startRoot) throw new Error('workspace root changed during upload');",
    );
    expect(source).toMatch(
      /for \(const batch of batchUploadWrites\([\s\S]*?\) \{[\s\S]*?if \(root\(\) !== startRoot\) throw new Error\('workspace root changed during upload'\);[\s\S]*?await mutations\.writeFiles\(batch\);[\s\S]*?\}/,
    );
    expect(source).toContain('Folder drops are unsupported; drop files instead');
    expect(source).toContain('workspace root changed during upload');
    expect(source).toContain('cannot move non-mutable path');
    expect(source).toContain('Cannot drop on ${row.name}');
    expect(source).toContain('onDragStart={(e) => startRowDrag(e, row)}');
    expect(source).toContain('onDrop={(e) => void dropOnTarget(e, root())}');
    expect(source).toContain('void dropOnTarget(e, dropTargetForRow(row), row);');
  });

  it('offers Copy Path and blob-vs-blob compare without raw diff text', () => {
    expect(source).toContain("import { copyToClipboard } from '../glue/clipboard.ts';");
    expect(source).toContain('Copy Path');
    expect(source).toContain('Copy Relative Path');
    expect(source).toContain('Compare Selected');
    expect(source).toContain('Compare with HEAD');
    expect(source).toContain('props.onCompareFiles?.(selected[0]!, selected[1]!)');
    expect(source).toContain('props.onCompareWithHead?.(path)');
    expect(source).not.toContain('git.diff(');
  });
});
