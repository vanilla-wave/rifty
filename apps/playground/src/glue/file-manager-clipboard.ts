import { basename, dirname, extname, joinPath } from '@riftydev/vfs';
import type { FsOpsTarget } from '@riftydev/workbench';
import { isSelfOrSubtreePath } from './file-manager-dnd.ts';

export type FileManagerClipboardMode = 'copy' | 'cut';

export interface FileManagerClipboard {
  readonly paths: readonly string[];
  readonly mode: FileManagerClipboardMode;
}

export interface ClipboardPasteAction {
  readonly kind: 'copy' | 'rename';
  readonly from: string;
  readonly to: string;
}

export interface ClipboardPastePlan {
  readonly actions: readonly ClipboardPasteAction[];
  readonly clearAfter: boolean;
}

function copyName(name: string, n: number): string {
  const ext = extname(name);
  const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;
  return `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`;
}

function nextAvailableCopyPath(
  fs: Pick<FsOpsTarget, 'existsSync'>,
  parent: string,
  name: string,
  reserved: ReadonlySet<string>,
): string {
  for (let n = 1; n < Number.MAX_SAFE_INTEGER; n += 1) {
    const candidate = joinPath(parent, copyName(name, n));
    if (!fs.existsSync(candidate) && !reserved.has(candidate)) return candidate;
  }
  throw new Error(`could not allocate a copy name for "${joinPath(parent, name)}"`);
}

function destinationPath(
  fs: Pick<FsOpsTarget, 'existsSync'>,
  source: string,
  targetDir: string,
  mode: FileManagerClipboardMode,
  reserved: ReadonlySet<string>,
): string | null {
  const name = basename(source);
  const direct = joinPath(targetDir, name);
  if (mode === 'cut' && direct === source) return null;
  // A cut is an atomic rename; moving a folder into itself or a descendant is
  // EINVAL on the owner. Refuse proactively with the same message as drag-move,
  // not a raw owner error. (Copy into a subtree is fine — it duplicates.)
  if (mode === 'cut' && isSelfOrSubtreePath(source, targetDir)) {
    throw new Error(`cannot move "${source}" into itself at "${targetDir}"`);
  }
  if (!fs.existsSync(direct) && !reserved.has(direct)) return direct;
  return nextAvailableCopyPath(fs, targetDir, name, reserved);
}

export function targetDirectoryForExplorerRow(row: {
  readonly kind: 'file' | 'dir';
  readonly path: string;
}): string {
  return row.kind === 'dir' ? row.path : dirname(row.path);
}

export function planClipboardPaste(
  fs: Pick<FsOpsTarget, 'existsSync'>,
  clipboard: FileManagerClipboard,
  targetDir: string,
): ClipboardPastePlan {
  const reserved = new Set<string>();
  const actions: ClipboardPasteAction[] = [];
  for (const source of clipboard.paths) {
    const to = destinationPath(fs, source, targetDir, clipboard.mode, reserved);
    if (to === null) continue;
    reserved.add(to);
    actions.push({ kind: clipboard.mode === 'cut' ? 'rename' : 'copy', from: source, to });
  }
  return { actions, clearAfter: clipboard.mode === 'cut' };
}
