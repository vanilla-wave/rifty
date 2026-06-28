import { basename, dirname, extname, joinPath } from '@riftydev/vfs';
import type { FsOpsTarget } from './fs-ops.ts';

export interface DragMoveAction {
  readonly kind: 'rename';
  readonly from: string;
  readonly to: string;
}

export interface UploadFilePlanInput {
  readonly name: string;
  readonly webkitRelativePath?: string;
}

export interface UploadPlanEntry {
  readonly name: string;
  readonly to: string;
}

export interface UploadWriteEntry {
  readonly path: string;
  readonly data: Uint8Array;
  readonly recursive?: boolean;
}

export interface UploadBatchOptions {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export function isSelfOrSubtreePath(source: string, target: string): boolean {
  return source === target || target.startsWith(`${source}/`);
}

function copyName(name: string, n: number): string {
  const ext = extname(name);
  const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;
  return `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`;
}

function availablePath(
  fs: Pick<FsOpsTarget, 'existsSync'>,
  parent: string,
  name: string,
  reserved: ReadonlySet<string>,
): string {
  const direct = joinPath(parent, name);
  if (!fs.existsSync(direct) && !reserved.has(direct)) return direct;
  for (let n = 1; n < Number.MAX_SAFE_INTEGER; n += 1) {
    const candidate = joinPath(parent, copyName(name, n));
    if (!fs.existsSync(candidate) && !reserved.has(candidate)) return candidate;
  }
  throw new Error(`could not allocate a copy name for "${direct}"`);
}

export function planDragMove(
  fs: Pick<FsOpsTarget, 'existsSync'>,
  sources: readonly string[],
  targetDir: string,
): readonly DragMoveAction[] {
  const reserved = new Set<string>();
  const actions: DragMoveAction[] = [];
  for (const source of sources) {
    if (dirname(source) === targetDir) continue;
    if (isSelfOrSubtreePath(source, targetDir)) {
      throw new Error(`cannot move "${source}" into itself at "${targetDir}"`);
    }
    const to = availablePath(fs, targetDir, basename(source), reserved);
    reserved.add(to);
    actions.push({ kind: 'rename', from: source, to });
  }
  return actions;
}

export function planUploadFiles(
  fs: Pick<FsOpsTarget, 'existsSync'>,
  files: readonly UploadFilePlanInput[],
  targetDir: string,
): readonly UploadPlanEntry[] {
  const reserved = new Set<string>();
  const out: UploadPlanEntry[] = [];
  for (const file of files) {
    if (file.name.includes('/') || (file.webkitRelativePath ?? '').includes('/')) {
      throw new Error('folder drops are unsupported; drop files instead');
    }
    const to = availablePath(fs, targetDir, file.name, reserved);
    reserved.add(to);
    out.push({ name: file.name, to });
  }
  return out;
}

export function batchUploadWrites(
  entries: readonly UploadWriteEntry[],
  opts: UploadBatchOptions,
): readonly (readonly UploadWriteEntry[])[] {
  if (opts.maxFiles < 1) throw new Error('maxFiles must be at least 1');
  if (opts.maxBytes < 1) throw new Error('maxBytes must be at least 1');
  const batches: UploadWriteEntry[][] = [];
  let current: UploadWriteEntry[] = [];
  let currentBytes = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentBytes = 0;
  };
  for (const entry of entries) {
    const size = entry.data.byteLength;
    if (
      current.length > 0 &&
      (current.length >= opts.maxFiles || currentBytes + size > opts.maxBytes)
    ) {
      flush();
    }
    current.push(entry);
    currentBytes += size;
    if (size >= opts.maxBytes) flush();
  }
  flush();
  return batches;
}
