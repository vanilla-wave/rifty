/**
 * A `Vfs` (async interface) that delegates everything to `syncMirror()`.
 *
 * Why: `@riftydev/npm-client` writes installed package files via `vfs.writeFile`
 * (async), while Vite reads them via `fs.readFileSync` (sync, backed by
 * `syncMirror`). Without this bridge the installed tree would be invisible to
 * the runtime. Here writes land directly in the sync mirror so the very next
 * `fs.readFileSync` sees them.
 */
import type { Vfs, VfsDirent, VfsStat } from '@riftydev/vfs';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { assertReadWindow } from '@riftydev/vfs/internal';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SyncMirrorVfs implements Vfs {
  async readFile(path: string): Promise<Uint8Array> {
    return syncMirror().readFileBytesSync(normalizePath(path));
  }
  async readFileText(path: string): Promise<string> {
    return dec.decode(syncMirror().readFileBytesSync(normalizePath(path)));
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    // No auto-mkdir — Node `fs.writeFile` ENOENTs on a missing parent, and so
    // do the sibling Vfs impls (MemoryVfs, OpfsVfs): a lenient twin here let a
    // deleted tree be silently resurrected by a deferred write that was
    // proven no-mkdir only against the strict MemoryVfs (sibling-drift).
    // Callers own their mkdir (the npm-client linker already does).
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    syncMirror().writeFileSync(normalizePath(path), bytes);
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    syncMirror().mkdirSync(normalizePath(path), { recursive: options?.recursive ?? false });
  }
  async readdir(path: string): Promise<readonly VfsDirent[]> {
    return syncMirror().readdirSync(normalizePath(path));
  }
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    syncMirror().rmSync(normalizePath(path), {
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    });
  }
  async stat(path: string): Promise<VfsStat> {
    const st = syncMirror().statSync(normalizePath(path));
    return { ...st, size: st.size ?? 0, mtime: st.mtime ?? 0 };
  }
  async exists(path: string): Promise<boolean> {
    return syncMirror().existsSync(normalizePath(path));
  }
  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    syncMirror().utimes(normalizePath(path), atimeMs, mtimeMs);
  }
  async openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    assertReadWindow(opts);
    const start = opts?.start ?? 0;
    const end = Math.min(opts?.end ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    // ADR-0576: the window only, one snapshot at open (main's semantics), held as
    // the layer below returns it — no copy of our own.
    const data = syncMirror().readFileRangeSync(
      normalizePath(path),
      start,
      Math.max(0, end - start),
    );
    const chunkSize = opts?.chunkSize ?? 64 * 1024;
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= data.byteLength) {
          controller.close();
          return;
        }
        const next = Math.min(offset + chunkSize, data.byteLength);
        controller.enqueue(data.subarray(offset, next));
        offset = next;
      },
    });
  }
}
