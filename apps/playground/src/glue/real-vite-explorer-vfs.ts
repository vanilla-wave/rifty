/**
 * Writable file-manager surface for the real-vite explorer (ADR-0076).
 *
 * The dev-mode explorer shows the worker's project tree (the read-only
 * `SnapshotFs`), but a sandbox you cannot touch is pointless — so file
 * management (new / rename / delete) must work too. This adapter gives
 * {@link ../components/FileExplorer.tsx | FileExplorer} one `FsOpsTarget` that:
 *
 * - READS from the snapshot view (so the tree reflects the worker, incl.
 *   worker-seeded files like `index.html`);
 * - WRITES (`writeFileSync`/`mkdirSync`/`rmSync`) to the always-writable page
 *   mirror AND propagates each mutation to the worker over the page→worker write
 *   port ({@link ./vfs-write-port.ts}). The worker applies it and republishes
 *   the snapshot, so the change shows up in the read view — same one-way model
 *   the editor uses for content edits.
 *
 * `readOnly = false`: the explorer shows its CRUD controls and no read-only
 * badge. The `fs-ops` helpers (recursive `copyTree` for rename, collision
 * guards) run unchanged on top of this.
 */
import type { VfsDirent } from '@riftydev/vfs';
import type { FsOpsTarget } from './fs-ops.ts';
import type { VfsWriteFrame } from './vfs-write-port.ts';

export class RealViteExplorerVfs implements FsOpsTarget {
  readonly readOnly = false;

  #read: FsOpsTarget;
  #mirror: FsOpsTarget;
  #propagate: (frame: VfsWriteFrame) => void;

  constructor(read: FsOpsTarget, mirror: FsOpsTarget, propagate: (frame: VfsWriteFrame) => void) {
    this.#read = read;
    this.#mirror = mirror;
    this.#propagate = propagate;
  }

  // — Reads: the worker snapshot (display source of truth). —
  existsSync(path: string): boolean {
    return this.#read.existsSync(path);
  }
  readFileBytesSync(path: string): Uint8Array {
    return this.#read.readFileBytesSync(path);
  }
  readdirSync(path: string): readonly VfsDirent[] {
    return this.#read.readdirSync(path);
  }
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    return this.#read.statSync(path);
  }

  // — Mutations: page mirror + one-way propagate to the worker. —
  writeFileSync(path: string, data: Uint8Array): void {
    this.#mirror.writeFileSync(path, data);
    this.#propagate({ type: 'write', path, data });
  }
  mkdirSync(path: string, options: { recursive?: boolean }): void {
    const recursive = options.recursive ?? false;
    this.#mirror.mkdirSync(path, { recursive });
    this.#propagate({ type: 'mkdir', path, recursive });
  }
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    const recursive = options.recursive ?? false;
    const force = options.force ?? false;
    this.#mirror.rmSync(path, { recursive, force });
    this.#propagate({ type: 'rm', path, recursive, force });
  }
}
