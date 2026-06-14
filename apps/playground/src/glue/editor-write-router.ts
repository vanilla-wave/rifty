/**
 * Editor read/write split for real-vite mode (ADR-0076 §Decision-4, corrected
 * 2026-06-14 from view-only).
 *
 * In real-vite mode the editor READS from a read-only view of the worker tree
 * (the `SnapshotFs` behind `activeVfs()`), but it must WRITE back through the
 * always-writable page mirror (`syncMirror()`). The host then propagates the
 * write to the worker over the page→worker write port (ADR-0043 / D4) so Vite's
 * watcher picks it up — the edit reaches the worker, so it is NOT the silent
 * fake ADR-0076 rejected.
 *
 * A path is editable iff the page mirror owns it: page-seeded source files stay
 * editable; worker-only files (node_modules, worker-generated — present in the
 * snapshot view, absent from the page mirror) have no clean write-back and stay
 * read-only, preserving ADR-0076's honesty for worker-owned files.
 */
import { dirname } from '@riftydev/vfs';
import type { FsOpsTarget } from '@riftydev/workbench';

const enc = new TextEncoder();

/** True when the page mirror owns `path` — the editor may write it back. */
export function isEditorPathWritable(
  writeVfs: Pick<FsOpsTarget, 'existsSync'>,
  path: string,
): boolean {
  return writeVfs.existsSync(path);
}

/** Persist the editor buffer `text` for `path` through the writable page mirror.
 *  `mkdir -p`s the parent first — the sync mirror's `writeFileSync` ENOENTs on a
 *  missing parent (matches {@link ./fs-ops.ts | writeText}). */
export function writeEditorFile(
  writeVfs: Pick<FsOpsTarget, 'writeFileSync' | 'mkdirSync'>,
  path: string,
  text: string,
): void {
  writeVfs.mkdirSync(dirname(path), { recursive: true });
  writeVfs.writeFileSync(path, enc.encode(text));
}
